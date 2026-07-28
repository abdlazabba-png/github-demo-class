import { useCallback, useEffect, useMemo, useState } from 'react';
import { savePhoto, getPhotoObjectUrl } from '../sync/photoStore.js';
import { runOcr } from '../ocr/runOcr.js';
import { getGps } from '../geo/getGps.js';
import { lgasList, wardsForLga, pollingUnitsForWard, findPollingUnit } from '../referenceData/gombe.js';

const PARTIES = ['APC', 'PDP', 'LP', 'NNPP'];

function emptyVotes() {
  return PARTIES.reduce((acc, p) => ({ ...acc, [p]: '' }), {});
}

export default function CaptureForm({ onCapture }) {
  const [agentId, setAgentId] = useState('agent-demo');
  const [lgaCode, setLgaCode] = useState('');
  const [wardCode, setWardCode] = useState('');
  const [puCode, setPuCode] = useState('');

  const [photoId, setPhotoId] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [ocrStatus, setOcrStatus] = useState('idle'); // idle | running | done | error
  const [ocrResult, setOcrResult] = useState(null);

  const [votes, setVotes] = useState(emptyVotes());
  const [submitting, setSubmitting] = useState(false);
  const [lastCaptured, setLastCaptured] = useState(null);

  const wards = useMemo(() => (lgaCode ? wardsForLga(lgaCode) : []), [lgaCode]);
  const pollingUnits = useMemo(() => (wardCode ? pollingUnitsForWard(wardCode) : []), [wardCode]);
  const selectedPu = useMemo(() => (puCode ? findPollingUnit(puCode) : null), [puCode]);

  // Revoke the thumbnail's object URL when it's replaced/unmounted so we
  // don't leak blob URLs across repeated captures in a long agent session.
  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  }, [photoPreviewUrl]);

  const handleLgaChange = (e) => {
    setLgaCode(e.target.value);
    setWardCode('');
    setPuCode('');
  };

  const handleWardChange = (e) => {
    setWardCode(e.target.value);
    setPuCode('');
  };

  const handlePhotoChange = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const id = crypto.randomUUID();
    await savePhoto(id, file);
    setPhotoId(id);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setVotes(emptyVotes());
    setOcrResult(null);
    setOcrStatus('running');
    try {
      const result = await runOcr(file, PARTIES);
      setOcrResult(result);
      setOcrStatus('done');
      if (result.suggestedVotes) {
        setVotes(
          Object.fromEntries(PARTIES.map((p) => [p, String(result.suggestedVotes[p] ?? '')]))
        );
      }
    } catch (err) {
      setOcrStatus('error');
    }
  }, []);

  const handleRetakePhoto = () => {
    setPhotoId(null);
    setPhotoPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setOcrStatus('idle');
    setOcrResult(null);
    setVotes(emptyVotes());
  };

  const updateVote = (party, value) => setVotes((v) => ({ ...v, [party]: value }));

  const canSubmit = Boolean(puCode) && Boolean(photoId) && !submitting;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const partyVotes = Object.fromEntries(PARTIES.map((p) => [p, Number(votes[p]) || 0]));
      const gps = await getGps(); // fresh fix at submit time; resolves to null if unavailable, never blocks
      const payload = {
        agentId,
        puCode,
        wardCode,
        lgaCode,
        partyVotes,
        // The agent-confirmed values above are what's authoritative.
        // ocrVotes is kept separately, exactly as the OCR pass produced it
        // (or {} if it couldn't make a confident per-party guess), so a
        // later OCR-vs-manual mismatch check has something to compare
        // against instead of comparing a value to itself.
        ocrVotes: ocrResult?.suggestedVotes || {},
        photoUrl: `local-photo://${photoId}`,
        gps,
        timestamp: Date.now(),
        deviceId: 'demo-device',
      };
      await onCapture(payload);
      setLastCaptured(puCode);
      handleRetakePhoto();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="capture-form" onSubmit={handleSubmit}>
      <h2>Capture result sheet (EC8A)</h2>

      <div className="form-row">
        <label>
          Agent ID
          <input value={agentId} onChange={(e) => setAgentId(e.target.value)} />
        </label>
      </div>

      <div className="form-row">
        <label>
          LGA
          <select value={lgaCode} onChange={handleLgaChange} required>
            <option value="" disabled>
              Select LGA…
            </option>
            {lgasList().map((l) => (
              <option key={l.lgaCode} value={l.lgaCode}>
                {l.lgaName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ward
          <select value={wardCode} onChange={handleWardChange} disabled={!lgaCode} required>
            <option value="" disabled>
              Select ward…
            </option>
            {wards.map((w) => (
              <option key={w.wardCode} value={w.wardCode}>
                {w.wardName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Polling Unit
          <select value={puCode} onChange={(e) => setPuCode(e.target.value)} disabled={!wardCode} required>
            <option value="" disabled>
              Select PU…
            </option>
            {pollingUnits.map((p) => (
              <option key={p.puCode} value={p.puCode}>
                {p.puName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {selectedPu && (
        <p className="hint">
          {selectedPu.puCode} · {selectedPu.registeredVoters.toLocaleString()} registered voters
        </p>
      )}

      <div className="photo-capture">
        <label className="photo-input-label">
          {photoPreviewUrl ? 'Replace photo' : 'Photograph result sheet'}
          <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} />
        </label>
        {photoPreviewUrl && (
          <div className="photo-preview">
            <img src={photoPreviewUrl} alt="Captured result sheet" />
            <button type="button" onClick={handleRetakePhoto}>
              Retake
            </button>
          </div>
        )}
        {ocrStatus === 'running' && <p className="hint">Reading sheet on-device…</p>}
        {ocrStatus === 'error' && (
          <p className="hint warn">OCR couldn't run — enter figures manually below.</p>
        )}
        {ocrStatus === 'done' && ocrResult && (
          <p className="hint">
            OCR detected on the sheet: {ocrResult.numbers.length ? ocrResult.numbers.map((n) => n.value).join(', ') : 'no clear numbers'}
            {ocrResult.suggestedVotes ? ' — pre-filled below, confirm each value.' : ' — enter figures manually below.'}
          </p>
        )}
      </div>

      <fieldset className="votes">
        <legend>Party votes (confirm every value — OCR is only a suggestion)</legend>
        {PARTIES.map((party) => (
          <label key={party}>
            {party}
            <input
              type="number"
              min="0"
              inputMode="numeric"
              value={votes[party]}
              onChange={(e) => updateVote(party, e.target.value)}
            />
          </label>
        ))}
      </fieldset>

      <button type="submit" disabled={!canSubmit}>
        {submitting ? 'Saving…' : 'Capture (works offline)'}
      </button>
      {!photoId && <p className="hint">Photograph the result sheet to continue.</p>}
      {lastCaptured && (
        <p className="hint">Saved locally: {lastCaptured}. It will sync automatically once online.</p>
      )}
    </form>
  );
}
