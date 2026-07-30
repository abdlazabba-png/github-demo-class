import { useEffect, useRef, useState, useCallback } from 'react';
import { SyncQueue } from './sync/syncQueue.js';
import * as amplifyServer from './sync/amplifyClient.js';
import { useMyPartyClients } from './auth/usePartyClientGroups.js';
import CaptureForm from './ui/CaptureForm.jsx';
import QueueStatus from './ui/QueueStatus.jsx';
import PartyDashboard from './ui/dashboard/PartyDashboard.jsx';

export default function App({ signOut, user }) {
  const [records, setRecords] = useState([]);
  const [ready, setReady] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  // In reality the field-agent app and the party dashboard are separate
  // clients entirely (different devices, different auth). They're two tabs
  // of one demo here purely so both are reachable without standing up a
  // second app — real isolation comes from Cognito group membership
  // (amplify/auth/resource.ts), not this toggle.
  const [view, setView] = useState('agent');
  // Bumped on every sync-loop touch so the dashboard's views (which read
  // AppSync directly, not through React state) know to re-fetch.
  const [refreshToken, setRefreshToken] = useState(0);

  const { loading: groupsLoading, partyClients: myPartyClients } = useMyPartyClients();

  const effectiveOnline = browserOnline && !simulateOffline;
  const effectiveOnlineRef = useRef(effectiveOnline);
  effectiveOnlineRef.current = effectiveOnline;

  const queueRef = useRef(null);

  const refresh = useCallback(async () => {
    const queue = queueRef.current;
    if (!queue) return;
    setRecords(await queue.all());
    setRefreshToken((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const queue = await new SyncQueue({
        // Reads live state via ref so a stale closure never pins the queue
        // to whatever "online" was at construction time.
        isOnline: () => effectiveOnlineRef.current,
        transport: (record) => amplifyServer.createSubmission(record),
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
        <div className="app-header-row">
          <div>
            <h1>Election Result Verification — Phase 5</h1>
            <p className="subtitle">
              Gombe/Adamawa pilot · offline-first capture · real AWS backend (AppSync/Cognito/S3)
            </p>
          </div>
          <div className="account-panel">
            <span>{user?.signInDetails?.loginId || 'Signed in'}</span>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
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

      {groupsLoading ? (
        <p>Checking your account's party-client membership…</p>
      ) : myPartyClients.length === 0 ? (
        <p className="hint warn">
          Your account isn't assigned to a party client yet. An administrator needs to add you to
          the matching Cognito group (see amplify/auth/resource.ts) before you can capture or view
          anything.
        </p>
      ) : view === 'agent' ? (
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

          {ready ? (
            <CaptureForm onCapture={handleCapture} myPartyClients={myPartyClients} />
          ) : (
            <p>Opening local outbox…</p>
          )}

          <QueueStatus records={records} />
        </>
      ) : (
        <PartyDashboard
          server={amplifyServer}
          refreshToken={refreshToken}
          myPartyClients={myPartyClients}
          user={user}
        />
      )}
    </div>
  );
}
