import { useState } from 'react';

// The reviewer/edit flow's one write-action surface (CLAUDE.md: "edits go
// through a logged reviewer flow only"). Inline expand/collapse rather than
// a modal — no modal pattern exists anywhere in this codebase, so this
// doesn't introduce one. Gated by Reviewer role membership (within this
// party) at the call site (src/ui/dashboard/DiscrepancyQueue.jsx), not
// internally — but unlike the earlier custom:role gate this replaced,
// that's now backed by real server-side enforcement:
// amplify/functions/create-role-checked-record/handler.ts (invoked via
// the fileCorrection mutation) independently rejects the call for anyone
// not a real member of `${partyClientId}__Reviewer`, checked against the
// caller's actual verified Cognito session — not a client-supplied field
// — regardless of what this component renders.
//
// reviewerId is a prop, not a field in this form — it comes from the
// caller's own signed-in session (user.signInDetails.loginId, threaded
// down via PartyDashboard.jsx), never typed, so a correction is always
// genuinely session-attributed.
export default function CorrectionForm({ server, submission, reviewerId, onFiled }) {
  const [open, setOpen] = useState(false);
  const [votes, setVotes] = useState(() => ({ ...submission.effectivePartyVotes }));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const parties = Object.keys(submission.effectivePartyVotes);

  function updateVote(party, value) {
    setVotes((prev) => ({ ...prev, [party]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const correctedPartyVotes = Object.fromEntries(parties.map((p) => [p, Number(votes[p]) || 0]));
      await server.createCorrection({
        submissionId: submission.id,
        partyClientId: submission.payload.partyClientId,
        stateCode: submission.payload.stateCode,
        puCode: submission.payload.puCode,
        previousPartyVotes: submission.effectivePartyVotes,
        correctedPartyVotes,
        reviewerId,
        reviewerNote: reason.trim(),
      });
      setReason('');
      setOpen(false);
      onFiled?.();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="correction-toggle" onClick={() => setOpen(true)}>
        Request Correction
      </button>
    );
  }

  return (
    <form className="correction-form" onSubmit={handleSubmit}>
      <fieldset className="votes">
        <legend>Corrected party votes</legend>
        {parties.map((party) => (
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

      <label className="correction-reason">
        Reason for this correction (required)
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>

      {error && <p className="hint warn">Couldn't file correction: {error}</p>}

      <div className="correction-actions">
        <button type="submit" disabled={submitting || !reason.trim()}>
          {submitting ? 'Filing…' : 'File correction'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
