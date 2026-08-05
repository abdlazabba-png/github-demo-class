import { useEffect, useState } from 'react';
import CorrectionForm from './CorrectionForm.jsx';
import CorrectionHistory from './CorrectionHistory.jsx';
import FlagHistory from './FlagHistory.jsx';
import FlagIssueForm from './FlagIssueForm.jsx';

// The reviewer/edit flow's primary surface (CLAUDE.md: "edits go through a
// logged reviewer flow only") — this is where a reviewer is already
// looking at a flagged problem, so "Request Correction" lives here rather
// than duplicated across every view. An item with a correction stays
// listed regardless (never disappears): the original flagged discrepancy
// against the original data is itself part of the audit trail, so it's
// only ever visually marked "corrected," never hidden.
//
// Also the Coordinator flow's SECOND surface for "Flag Issue" (the first
// is EvidenceView.jsx, which is where a Coordinator catches something the
// automated checks missed in the first place) — once something's already
// here, whether from an algorithmic check or an earlier flag, a
// Coordinator can still add another flag with more context for the
// Reviewer, same append-only "never collapse, never replace" reasoning as
// corrections.
export default function DiscrepancyQueue({ server, partyClientId, stateCode, refreshToken, reviewerId, coordinatorId, myRoles }) {
  const [discrepancies, setDiscrepancies] = useState([]);
  const [error, setError] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    server
      .getDiscrepanciesForClient(partyClientId, stateCode)
      .then((result) => {
        if (!cancelled) setDiscrepancies(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [server, partyClientId, stateCode, refreshToken, localRefresh]);

  return (
    <section className="dashboard-view discrepancy-queue">
      <h3>Discrepancy queue</h3>
      {error && <p className="hint warn">Couldn't load discrepancies: {error}</p>}
      {discrepancies.length === 0 && !error && (
        <p className="hint">No open discrepancies for this party client.</p>
      )}
      <ul className="discrepancy-list">
        {discrepancies.map((d) => (
          <li
            key={d.id}
            className={`discrepancy-item severity-${d.validation.overallSeverity}${
              d.flags.length > 0 ? ' has-flag' : ''
            }`}
          >
            <div className="discrepancy-head">
              <strong>{d.payload.puCode}</strong>
              <span className={`check check-${d.validation.overallSeverity}`}>
                {d.validation.overallSeverity}
              </span>
              {d.flags.length > 0 && <span className="badge flagged">Flagged</span>}
              {d.corrections.length > 0 && <span className="badge corrected">Corrected</span>}
            </div>
            <ul className="discrepancy-reasons">
              {d.validation.checks
                .filter((c) => c.severity === 'warning' || c.severity === 'error')
                .map((c) => (
                  <li key={c.type}>{c.message}</li>
                ))}
            </ul>
            <FlagHistory flags={d.flags} />
            <CorrectionHistory corrections={d.corrections} />
            {myRoles.includes('Coordinator') && (
              <FlagIssueForm
                server={server}
                submission={d}
                coordinatorId={coordinatorId}
                onFiled={() => setLocalRefresh((t) => t + 1)}
              />
            )}
            {myRoles.includes('Reviewer') && (
              <CorrectionForm
                server={server}
                submission={d}
                reviewerId={reviewerId}
                onFiled={() => setLocalRefresh((t) => t + 1)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
