import { useState } from 'react';

// The Coordinator flow's one write-action surface (CLAUDE.md: Coordinator
// can "flag issues; cannot edit vote figures directly") — mirrors
// CorrectionForm.jsx's shape (inline expand/collapse, mandatory reason)
// but deliberately has no vote-value fields at all: a flag is a signal for
// a Reviewer to look, never a value change itself. Gated by Coordinator
// role membership (within this party) at the call site
// (EvidenceView.jsx/DiscrepancyQueue.jsx), not internally — but that's a
// real access-control boundary, not just a hidden button:
// amplify/functions/create-role-checked-record/handler.ts independently
// rejects the call for anyone not a real member of
// `${partyClientId}__Coordinator`, checked against the caller's actual
// verified Cognito session.
//
// coordinatorId is a prop, not a field in this form — it comes from the
// caller's own signed-in session (user.signInDetails.loginId, threaded
// down via PartyDashboard.jsx), never typed, so a flag is always genuinely
// session-attributed, same as CorrectionForm.jsx's reviewerId.
export default function FlagIssueForm({ server, submission, coordinatorId, onFiled }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await server.createFlag({
        submissionId: submission.id,
        partyClientId: submission.payload.partyClientId,
        stateCode: submission.payload.stateCode,
        puCode: submission.payload.puCode,
        coordinatorId,
        note: note.trim(),
      });
      setNote('');
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
      <button type="button" className="flag-toggle" onClick={() => setOpen(true)}>
        Flag Issue
      </button>
    );
  }

  return (
    <form className="flag-form" onSubmit={handleSubmit}>
      <label className="flag-reason">
        What's the issue? (required)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} required />
      </label>

      {error && <p className="hint warn">Couldn't file flag: {error}</p>}

      <div className="flag-actions">
        <button type="submit" disabled={submitting || !note.trim()}>
          {submitting ? 'Filing…' : 'File flag'}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
