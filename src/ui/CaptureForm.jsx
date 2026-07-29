import { useCallback, useEffect, useMemo, useState } from 'react';
import { savePhoto } from '../sync/photoStore.js';
import { runOcr } from '../ocr/runOcr.js';
import { getGps } from '../geo/getGps.js';
import {
  statesList,
  lgasListForState,
  wardsForLgaInState,
  pollingUnitsForWardInState,
  findPollingUnitInState,
} from '../referenceData/states/index.js';
import { checkOcrMismatch, checkPlausibility, worstSeverity } from '../validation/validate.js';

const PARTIES = ['APC', 'PDP', 'LP', 'NNPP'];

function emptyVotes() {
  return PARTIES.reduce((acc, p) => ({ ...acc, [p]: '' }), {});
}

// myPartyClients: the party clients the signed-in user's Cognito groups
// actually grant access to (see src/auth/usePartyClientGroups.js) — never
// a free choice. App.jsx only renders this component once that list is
// non-empty.
export default function CaptureForm({ onCapture, myPartyClients }) {
  const [agentId, setAgentId] = useState('agent-demo');
  const [partyClientId, setPartyClientId] = useState(myPartyClients[0].id);
  // Same provisioning logic as partyClientId: a real device is set up for
  // one state's pilot, not left to pick from every state in the country.
  const [stateCode, setStateCode] = useState(statesList()[0].code);
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
  const [overrideAck, setOverrideAck] = useState(false);

  const wards = useMemo(() => (lgaCode ? wardsForLgaInState(stateCode, lgaCode) : []), [stateCode, lgaCode]);
  const pollingUnits = useMemo(
    () => (wardCode ? pollingUnitsForWardInState(stateCode, wardCode) : []),
    [stateCode, wardCode]
  );
  const selectedPu = useMemo(
    () => (puCode ? findPollingUnitInState(stateCode, puCode) : null),
    [stateCode, puCode]
  );

  const partyVotes = useMemo(
    () => Object.fromEntries(PARTIES.map((p) => [p, Number(votes[p]) || 0])),
    [votes]
  );

  // Duplicate-submission detection isn't run here: it needs visibility
  // across all submissions, which an offline agent's device doesn't
  // reliably have. That check runs server-side in mockServer.js and feeds
  // the (future) discrepancy queue instead.
  const validationChecks = useMemo(() => {
    const ocrMismatch = checkOcrMismatch(partyVotes, ocrResult?.suggestedVotes || {});
    const plausibility = selectedPu
      ? checkPlausibility(partyVotes, selectedPu.registeredVoters)
      : { type: 'plausibility', severity: 'unknown', message: 'Select a polling unit to check plausibility.' };
    return [ocrMismatch, plausibility];
  }, [partyVotes, ocrResult, selectedPu]);
  const validationSeverity = worstSeverity(validationChecks);
  const requiresOverride = validationSeverity === 'error';

  // Force a fresh acknowledgment any time the figures or PU change, so a
  // stale checkbox from an earlier (different) warning can't wave through
  // whatever the agent has since edited.
  useEffect(() => {
    setOverrideAck(false);
  }, [partyVotes, puCode, ocrResult]);

  // Revoke the thumbnail's object URL when it's replaced/unmounted so we
  // don't leak blob URLs across repeated captures in a long agent session.
  useEffect(() => () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  }, [photoPreviewUrl]);

  const handleStateChange = (e) => {
    setStateCode(e.target.value);
    setLgaCode('');
    setWardCode('');
    setPuCode('');
  };

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

  const canSubmit =
    Boolean(puCode) && Boolean(photoId) && !submitting && (!requiresOverride || overrideAck);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const gps = await getGps(); // fresh fix at submit time; resolves to null if unavailable, never blocks
      const payload = {
        agentId,
        partyClientId,
        stateCode,
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
        <label>
          Party Client
          <select value={partyClientId} onChange={(e) => setPartyClientId(e.target.value)}>
            {myPartyClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          State
          <select value={stateCode} onChange={handleStateChange}>
            {statesList().map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="form-row">
        <label>
          LGA
          <select value={lgaCode} onChange={handleLgaChange} required>
            <option value="" disabled>
              Select LGA…
            </option>
            {lgasListForState(stateCode).map((l) => (
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

      <ul className="validation-checks">
        {validationChecks.map((check) => (
          <li key={check.type} className={`check check-${check.severity}`}>
            {check.message}
          </li>
        ))}
      </ul>

      {requiresOverride && (
        <label className="override-ack">
          <input type="checkbox" checked={overrideAck} onChange={(e) => setOverrideAck(e.target.checked)} />
          I've checked this against the paper sheet and confirm it's correct as entered.
        </label>
      )}

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
