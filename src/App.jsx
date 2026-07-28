import { useEffect, useRef, useState, useCallback } from 'react';
import { SyncQueue } from './sync/syncQueue.js';
import { createMockServer } from './sync/mockServer.js';
import CaptureForm from './ui/CaptureForm.jsx';
import QueueStatus from './ui/QueueStatus.jsx';
import PartyDashboard from './ui/dashboard/PartyDashboard.jsx';

// Stands in for the future AppSync ingestion endpoint (CLAUDE.md: mock
// backend first for Phase 1). One instance for the tab's lifetime.
const server = createMockServer({ latencyMs: 400 });

export default function App() {
  const [records, setRecords] = useState([]);
  const [serverCount, setServerCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  // In reality the field-agent app and the party dashboard are separate
  // clients entirely (different devices, different auth). They're two tabs
  // of one demo here purely so both are reachable without standing up a
  // second app; the dashboard's tenant scoping (see mockServer.js) is what
  // actually matters, not this toggle.
  const [view, setView] = useState('agent');
  // Bumped whenever the sync loop touches the mock server, so the
  // dashboard's views (which read the server's internal state directly,
  // not through React state) know to re-fetch.
  const [refreshToken, setRefreshToken] = useState(0);

  const effectiveOnline = browserOnline && !simulateOffline;
  const effectiveOnlineRef = useRef(effectiveOnline);
  effectiveOnlineRef.current = effectiveOnline;

  const queueRef = useRef(null);

  const refresh = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue) return;
    setRecords(await queue.all());
    setServerCount(server.count());
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const queue = await new SyncQueue({
        // Reads live state via ref so a stale closure never pins the queue
        // to whatever "online" was at construction time.
        isOnline: () => effectiveOnlineRef.current,
        transport: async (record) => {
          await server.ingest({
            id: record.id,
            payload: record.payload,
            submissionHash: record.submissionHash,
          });
        },
      }).init();
      if (cancelled) return;
      queueRef.current = queue;
      queue.onChange(refresh);
      setReady(true);
      await refresh();
      await queue.flush();
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const goOnline = () => setBrowserOnline(true);
    const goOffline = () => setBrowserOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (effectiveOnline && queueRef.current) {
      queueRef.current.flush().then(refresh);
    }
  }, [effectiveOnline, refresh]);

  const handleCapture = useCallback(
    async (payload) => {
      if (!queueRef.current) return;
      await queueRef.current.enqueue(payload);
      await refresh();
      if (effectiveOnlineRef.current) {
        await queueRef.current.flush();
        await refresh();
      }
    },
    [refresh]
  );

  const handleSyncNow = useCallback(async () => {
    if (!queueRef.current) return;
    await queueRef.current.flush();
    await refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Election Result Verification — Phase 2 PoC</h1>
        <p className="subtitle">
          Gombe State pilot · offline-first capture · mock ingestion endpoint (no AWS backend yet)
        </p>
      </header>

      <nav className="app-view-toggle">
        <button type="button" className={view === 'agent' ? 'active' : ''} onClick={() => setView('agent')}>
          Field Agent
        </button>
        <button
          type="button"
          className={view === 'dashboard' ? 'active' : ''}
          onClick={() => setView('dashboard')}
        >
          Party Dashboard
        </button>
      </nav>

      {view === 'agent' ? (
        <>
          <section className="network-panel">
            <div className="network-status">
              <span className={`dot ${effectiveOnline ? 'online' : 'offline'}`} />
              {effectiveOnline ? 'Online — will sync automatically' : 'Offline — captures are queued locally'}
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={simulateOffline}
                onChange={(e) => setSimulateOffline(e.target.checked)}
              />
              Simulate airplane mode
            </label>
            <button type="button" onClick={handleSyncNow} disabled={!effectiveOnline}>
              Sync now
            </button>
          </section>

          {ready ? <CaptureForm onCapture={handleCapture} /> : <p>Opening local outbox…</p>}

          <QueueStatus records={records} serverCount={serverCount} />
        </>
      ) : (
        <PartyDashboard server={server} refreshToken={refreshToken} />
      )}
    </div>
  );
}
