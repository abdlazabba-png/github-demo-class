// Read-only flag history, shared by EvidenceView.jsx and
// DiscrepancyQueue.jsx, mirroring CorrectionHistory.jsx's shape — a flag
// never changes a value, so there's no diff to show, just who flagged it,
// when, and why. Multiple flags on one submission (from one or several
// Coordinators) all stay visible, oldest first, never collapsed into one.
export default function FlagHistory({ flags }) {
  if (!flags || flags.length === 0) return null;

  return (
    <ul className="flag-history">
      {flags.map((f) => (
        <li key={f.id} className="flag-item">
          <div className="flag-item-head">
            <span className="badge flagged">Flagged</span>
            <span>{new Date(f.createdAt).toLocaleString()}</span>
            <span>by {f.coordinatorId}</span>
          </div>
          <p className="flag-note">"{f.note}"</p>
        </li>
      ))}
    </ul>
  );
}
