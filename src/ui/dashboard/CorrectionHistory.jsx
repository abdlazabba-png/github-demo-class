// Read-only correction history, shared by DiscrepancyQueue.jsx and
// EvidenceView.jsx so both render the same old->new/reviewer/reason/time
// shape rather than duplicating it. Never hides the original values —
// each entry shows exactly what changed and why, oldest first.
export default function CorrectionHistory({ corrections }) {
  if (!corrections || corrections.length === 0) return null;

  return (
    <ul className="correction-history">
      {corrections.map((c) => (
        <li key={c.id} className="correction-item">
          <div className="correction-item-head">
            <span className="badge corrected">Corrected</span>
            <span>{new Date(c.createdAt).toLocaleString()}</span>
            <span>by {c.reviewerId}</span>
          </div>
          <p className="correction-note">"{c.reviewerNote}"</p>
          <ul className="correction-diff">
            {Object.keys(c.correctedPartyVotes).map((party) => (
              <li key={party}>
                {party}: {c.previousPartyVotes[party] ?? '—'} → {c.correctedPartyVotes[party]}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
