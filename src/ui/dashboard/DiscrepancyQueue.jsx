import { useEffect, useState } from 'react';

export default function DiscrepancyQueue({ server, partyClientId, stateCode, refreshToken }) {
  const [discrepancies, setDiscrepancies] = useState([]);
  const [error, setError] = useState(null);

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
  }, [server, partyClientId, stateCode, refreshToken]);

  return (
    <section className="dashboard-view discrepancy-queue">
      <h3>Discrepancy queue</h3>
      {error && <p className="hint warn">Couldn't load discrepancies: {error}</p>}
      {discrepancies.length === 0 && !error && (
        <p className="hint">No open discrepancies for this party client.</p>
      )}
      <ul className="discrepancy-list">
        {discrepancies.map((d) => (
          <li key={d.id} className={`discrepancy-item severity-${d.validation.overallSeverity}`}>
            <div className="discrepancy-head">
              <strong>{d.payload.puCode}</strong>
              <span className={`check check-${d.validation.overallSeverity}`}>
                {d.validation.overallSeverity}
              </span>
            </div>
            <ul className="discrepancy-reasons">
              {d.validation.checks
                .filter((c) => c.severity === 'warning' || c.severity === 'error')
                .map((c) => (
                  <li key={c.type}>{c.message}</li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
