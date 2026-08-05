import { useEffect, useState } from 'react';

export default function AuditLogView({ server, partyClientId, stateCode, refreshToken }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    server
      .getAuditLogForClient(partyClientId, stateCode)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message || err));
      });
    return () => {
      cancelled = true;
    };
  }, [server, partyClientId, stateCode, refreshToken]);

  return (
    <section className="dashboard-view audit-log-view">
      <h3>Audit log</h3>
      <p className="hint">
        Append-only record of submissions received, corrections filed, and issues flagged for this
        party client — entries are never edited or removed. A correction never changes the original
        submission row; it only adds a new, attributed, reasoned entry here. A flag never changes a
        submission at all — it's a signal for a reviewer to look, not a value change.
      </p>
      {error && <p className="hint warn">Couldn't load audit log: {error}</p>}
      {entries.length === 0 && !error && <p className="hint">No activity yet.</p>}
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>PU</th>
            <th>Attributed to</th>
            <th>Detail</th>
            <th>Validation</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.type}-${e.id}`} className={`audit-row audit-row-${e.type}`}>
              <td>{new Date(e.at).toLocaleString()}</td>
              <td>{e.type === 'correction' ? 'Correction' : e.type === 'flag' ? 'Flag' : 'Submission'}</td>
              <td>{e.type === 'submission' ? e.puCode : ''}</td>
              <td>{e.type === 'submission' ? e.agentId : e.type === 'flag' ? e.coordinatorId : e.reviewerId}</td>
              <td>
                {e.type === 'correction'
                  ? Object.keys(e.correctedPartyVotes)
                      .map((p) => `${p}: ${e.previousPartyVotes[p] ?? '—'} → ${e.correctedPartyVotes[p]}`)
                      .join(', ') + ` (${e.reviewerNote})`
                  : e.type === 'flag'
                    ? e.note
                    : ''}
              </td>
              <td>
                {e.type !== 'flag' && (
                  <span className={`check check-${e.validationSeverity}`}>{e.validationSeverity}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
