import { useEffect, useState } from 'react';

export default function DiscrepancyQueue({ server, partyClientId, refreshToken }) {
  const [discrepancies, setDiscrepancies] = useState([]);

  useEffect(() => {
    setDiscrepancies(server.getDiscrepanciesForClient(partyClientId));
  }, [server, partyClientId, refreshToken]);

  return (
    <section className="dashboard-view discrepancy-queue">
      <h3>Discrepancy queue</h3>
      {discrepancies.length === 0 && <p className="hint">No open discrepancies for this party client.</p>}
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
