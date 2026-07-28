import { useState } from 'react';

const PARTIES = ['APC', 'PDP', 'LP', 'NNPP'];

function emptyVotes() {
  return PARTIES.reduce((acc, p) => ({ ...acc, [p]: '' }), {});
}

export default function CaptureForm({ onCapture }) {
  const [agentId, setAgentId] = useState('agent-demo');
  const [puCode, setPuCode] = useState('');
  const [wardCode, setWardCode] = useState('');
  const [lgaCode, setLgaCode] = useState('');
  const [votes, setVotes] = useState(emptyVotes());
  const [submitting, setSubmitting] = useState(false);
  const [lastCaptured, setLastCaptured] = useState(null);

  const updateVote = (party, value) => setVotes((v) => ({ ...v, [party]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!puCode.trim()) return;
    setSubmitting(true);
    try {
      const partyVotes = Object.fromEntries(PARTIES.map((p) => [p, Number(votes[p]) || 0]));
      const payload = {
        agentId,
        puCode: puCode.trim(),
        wardCode: wardCode.trim(),
        lgaCode: lgaCode.trim(),
        partyVotes,
        // On-device OCR is out of scope for this PoC; manual entry stands
        // in for "OCR pre-fill, always confirmed by the agent" (CLAUDE.md).
        ocrVotes: partyVotes,
        photoUrl: null,
        gps: null,
        timestamp: Date.now(),
        deviceId: 'demo-device',
      };
      await onCapture(payload);
      setLastCaptured(puCode.trim());
      setPuCode('');
      setVotes(emptyVotes());
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
          Polling Unit code
          <input
            value={puCode}
            onChange={(e) => setPuCode(e.target.value)}
            placeholder="GM/AK/001"
            required
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Ward code
          <input value={wardCode} onChange={(e) => setWardCode(e.target.value)} placeholder="GM/AK" />
        </label>
        <label>
          LGA code
          <input value={lgaCode} onChange={(e) => setLgaCode(e.target.value)} placeholder="GM" />
        </label>
      </div>
      <fieldset className="votes">
        <legend>Party votes</legend>
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
      <button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Capture (works offline)'}
      </button>
      {lastCaptured && (
        <p className="hint">Saved locally: {lastCaptured}. It will sync automatically once online.</p>
      )}
    </form>
  );
}
