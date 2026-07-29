const STATUS_LABEL = {
  pending: 'Queued',
  syncing: 'Syncing…',
  synced: 'Synced',
  failed: 'Failed',
};

export default function QueueStatus({ records }) {
  const counts = records.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});

  return (
    <section className="queue-status">
      <h2>Local outbox</h2>
      <div className="counts">
        <span>Pending: {counts.pending || 0}</span>
        <span>Syncing: {counts.syncing || 0}</span>
        <span>Synced: {counts.synced || 0}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>PU code</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Captured</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td>{r.payload.puCode}</td>
              <td>
                <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status] || r.status}</span>
              </td>
              <td>{r.attempts}</td>
              <td>{new Date(r.createdAt).toLocaleTimeString()}</td>
              <td className="error-cell">{r.lastError || ''}</td>
            </tr>
          ))}
          {records.length === 0 && (
            <tr>
              <td colSpan={5}>No captures yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
