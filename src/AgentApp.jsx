import { useEffect, useRef, useState, useCallback } from 'react';
import { SyncQueue } from './sync/syncQueue.js';
import * as amplifyServer from './sync/amplifyClient.js';
import { useMyPartyClients } from './auth/usePartyClientGroups.js';
import { useMyRoleGroups } from './auth/useMyRoleGroups.js';
import CaptureForm from './ui/CaptureForm.jsx';
import QueueStatus from './ui/QueueStatus.jsx';

// The field-agent entry bundle (dashboard/index.html + DashboardApp.jsx is
// the other one) — this used to be one combined App.jsx with an in-app
// Field Agent / Party Dashboard toggle; the two are now genuinely separate
// entry bundles (see vite.config.js / vite.dashboard.config.js) so this
// bundle never ships PartyDashboard's code, CSS classes it needs, or —
// critically — the dashboard's complete absence of an offline/install
// requirement doesn't accidentally inherit this bundle's PWA/service
// worker/OCR weight.
export default function AgentApp({ signOut, user }) {
  const [records, setRecords] = useState([]);
  const [ready, setReady] = useState(false);
  const [simulateOffline, setSimulateOffline] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  // Bumped on every sync-loop touch — unused by anything in this bundle
  // today (QueueStatus reads `records` directly), kept because
  // amplifyServer.createSubmission's transport() call doesn't need it but
  // a future agent-side view might; cheap to keep, not worth threading
  // out only to re-add later.
  const [refreshToken, setRefreshToken] = useState(0);

  const { loading: groupsLoading, partyClients: myPartyClients } = useMyPartyClients();
  // Role is party-scoped and every user belongs to exactly one party
  // (CLAUDE.md's role matrix), so myPartyClients[0] is the only party a
  // signed-in user could ever have a role in — same pattern
  // PartyDashboard.jsx uses for its initial "Viewing as" selection.
  const { roles: myRoles } = useMyRoleGroups(myPartyClients[0]?.id);
  const isFieldAgent = myRoles.includes('FieldAgent');

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
            <h1>VerifiVote — Field Agent</h1>
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

      {groupsLoading ? (
        <p>Checking your account's party-client membership…</p>
      ) : myPartyClients.length === 0 ? (
        <p className="hint warn">
          Your account isn't assigned to a party client yet. An administrator needs to add you to
          the matching Cognito group (see amplify/auth/resource.ts) before you can capture or view
          anything.
        </p>
      ) : !isFieldAgent ? (
        // Real enforcement is server-side regardless (fileSubmission's
        // Lambda check rejects a non-FieldAgent's submission no matter
        // what this bundle shows) — this is purely wayfinding: the two
        // apps used to be one combined page with a toggle, so a
        // Coordinator/Reviewer/PartyAdmin account bookmarking or
        // installing the old combined URL would otherwise land on a form
        // they can't use and get no explanation why.
        <div className="wrong-app-banner">
          <h2>This app is for field agents</h2>
          <p>
            Your account is signed in as {myRoles.join(', ') || 'a non-FieldAgent role'} for{' '}
            {myPartyClients[0]?.name}. Result capture is only available to the FieldAgent role —
            head to the party dashboard instead.
          </p>
          <a className="dashboard-link" href="/dashboard/">
            Go to the dashboard →
          </a>
        </div>
      ) : (
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
      )}
    </div>
  );
}
