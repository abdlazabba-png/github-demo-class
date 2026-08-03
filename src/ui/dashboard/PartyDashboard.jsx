import { useState } from 'react';
import { statesList } from '../../referenceData/states/index.js';
import { useMyRoleGroups } from '../../auth/useMyRoleGroups.js';
import CoverageView from './CoverageView.jsx';
import EvidenceView from './EvidenceView.jsx';
import DiscrepancyQueue from './DiscrepancyQueue.jsx';
import AuditLogView from './AuditLogView.jsx';

const TABS = [
  { key: 'coverage', label: 'Coverage' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'discrepancies', label: 'Discrepancies' },
  { key: 'audit', label: 'Audit Log' },
];

// server: src/sync/amplifyClient.js's exports (see App.jsx), which query
// AppSync directly. refreshToken bumps whenever the sync loop touches the
// backend so these views know to re-fetch. myPartyClients: the party
// clients the signed-in user's Cognito groups actually grant access to
// (src/auth/usePartyClientGroups.js) — never a free choice; AppSync itself
// would reject a query for any other partyClientId regardless of what this
// UI showed, but the picker only offering real options is better UX than
// letting someone select an option that's guaranteed to fail.
export default function PartyDashboard({ server, refreshToken, myPartyClients, user }) {
  const [partyClientId, setPartyClientId] = useState(myPartyClients[0].id);
  // Phase 4: coverage is only meaningful against one state's own PU count
  // (mixing two states' totals into one "N of N" would misrepresent both),
  // so the dashboard scopes by state alongside party client.
  const [stateCode, setStateCode] = useState(statesList()[0].code);
  const [activeTab, setActiveTab] = useState('coverage');

  // The reviewer/edit flow (CorrectionForm.jsx) needs both of these:
  // myRoles gates whether "Request Correction" is shown at all (Reviewer
  // role WITHIN partyClientId, see useMyRoleGroups.js — role is party-
  // scoped, so this hook takes partyClientId and re-checks whenever the
  // "Viewing as" selector changes. This UI gate mirrors a real
  // access-control boundary now enforced server-side by
  // amplify/data/resource.ts's groupDefinedIn('requiredCreatorGroup')
  // rule, not just a hidden button), and reviewerId is what actually gets
  // written onto a correction, always the signed-in user's own email,
  // never a typed field.
  const { roles: myRoles } = useMyRoleGroups(partyClientId);
  const reviewerId = user?.signInDetails?.loginId;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <label>
          Viewing as
          <select value={partyClientId} onChange={(e) => setPartyClientId(e.target.value)}>
            {myPartyClients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          State
          <select value={stateCode} onChange={(e) => setStateCode(e.target.value)}>
            {statesList().map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          Every query below is scoped to this client and this state by real Cognito group
          membership — AppSync itself has no way to return another client's data, or to mix two
          states' coverage together (CLAUDE.md: isolation enforced at the access-control layer,
          not the UI).
        </p>
      </div>

      <nav className="dashboard-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? 'active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'coverage' && (
        <CoverageView server={server} partyClientId={partyClientId} stateCode={stateCode} refreshToken={refreshToken} />
      )}
      {activeTab === 'evidence' && (
        <EvidenceView server={server} partyClientId={partyClientId} stateCode={stateCode} refreshToken={refreshToken} />
      )}
      {activeTab === 'discrepancies' && (
        <DiscrepancyQueue
          server={server}
          partyClientId={partyClientId}
          stateCode={stateCode}
          refreshToken={refreshToken}
          reviewerId={reviewerId}
          myRoles={myRoles}
        />
      )}
      {activeTab === 'audit' && (
        <AuditLogView server={server} partyClientId={partyClientId} stateCode={stateCode} refreshToken={refreshToken} />
      )}
    </div>
  );
}
