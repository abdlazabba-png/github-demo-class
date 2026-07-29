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
        Append-only record of submissions received for this party client — entries are never
        edited or removed. A future reviewer/edit flow (CLAUDE.md: edits are never silent) will
        log its actions here too.
      </p>
      {error && <p className="hint warn">Couldn't load audit log: {error}</p>}
      {entries.length === 0 && !error && <p className="hint">No activity yet.</p>}
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>PU</th>
            <th>Agent</th>
            <th>Validation</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.receivedAt).toLocaleString()}</td>
              <td>{e.puCode}</td>
              <td>{e.agentId}</td>
              <td>
                <span className={`check check-${e.validationSeverity}`}>{e.validationSeverity}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
