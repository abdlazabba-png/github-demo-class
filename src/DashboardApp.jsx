import { useState } from 'react';
import * as amplifyServer from './sync/amplifyClient.js';
import { useMyPartyClients } from './auth/usePartyClientGroups.js';
import PartyDashboard from './ui/dashboard/PartyDashboard.jsx';

// The dashboard entry bundle (AgentApp.jsx + index.html is the other
// one) — see AgentApp.jsx's own comment for why these are now separate
// bundles rather than one combined App.jsx with a toggle. No offline
// queue, no CaptureForm, no Tesseract/OCR/GPS/service-worker weight —
// this bundle's whole point is not carrying any of that.
//
// refreshToken existed in the combined App.jsx to bump PartyDashboard's
// views whenever the agent-side sync loop touched the backend. There's no
// sync loop in this bundle at all, so it's a static 0 — PartyDashboard's
// own views already re-fetch on their own actions (filing a correction/
// flag/assignment), refreshToken was only ever about cross-bundle
// freshness that can no longer happen from here anyway.
export default function DashboardApp({ signOut, user }) {
  const [refreshToken] = useState(0);
  const { loading: groupsLoading, partyClients: myPartyClients } = useMyPartyClients();

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>VerifiVote — Party Dashboard</h1>
            <p className="subtitle">
              Gombe/Adamawa pilot · coverage, evidence, discrepancies, and audit — real AWS backend
              (AppSync/Cognito/S3)
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
          the matching Cognito group (see amplify/auth/resource.ts) before you can view anything.
        </p>
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
