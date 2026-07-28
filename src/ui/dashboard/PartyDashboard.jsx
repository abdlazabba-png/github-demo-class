import { useState } from 'react';
import { PARTY_CLIENTS } from '../../referenceData/partyClients.js';
import { statesList } from '../../referenceData/states/index.js';
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

// server: the shared mockServer instance (see App.jsx). refreshToken: bumps
// whenever App.jsx's sync loop touches the server, so these views know to
// re-read — the mock server mutates its own internal Map outside React
// state, so there's nothing else to subscribe to yet.
export default function PartyDashboard({ server, refreshToken }) {
  const [partyClientId, setPartyClientId] = useState(PARTY_CLIENTS[0].id);
  // Phase 4: coverage is only meaningful against one state's own PU count
  // (mixing two states' totals into one "N of N" would misrepresent both),
  // so the dashboard scopes by state alongside party client.
  const [stateCode, setStateCode] = useState(statesList()[0].code);
  const [activeTab, setActiveTab] = useState('coverage');

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <label>
          Viewing as
          <select value={partyClientId} onChange={(e) => setPartyClientId(e.target.value)}>
            {PARTY_CLIENTS.map((c) => (
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
          Simulates a party-client login until real auth exists. Every query below is scoped to
          this client and this state — the dashboard's data layer has no function capable of
          returning another client's data, or of mixing two states' coverage together (CLAUDE.md:
          isolation enforced at the access-control layer, not the UI).
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
        <DiscrepancyQueue server={server} partyClientId={partyClientId} stateCode={stateCode} refreshToken={refreshToken} />
      )}
      {activeTab === 'audit' && (
        <AuditLogView server={server} partyClientId={partyClientId} stateCode={stateCode} refreshToken={refreshToken} />
      )}
    </div>
  );
}
