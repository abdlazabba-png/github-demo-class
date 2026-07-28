import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../src/sync/mockServer.js';
import { findPollingUnitInState } from '../src/referenceData/states/index.js';

const PU_A = findPollingUnitInState('GM', 'GM-A/W1/001'); // 412 registered voters
const PU_B = findPollingUnitInState('GM', 'GM-A/W1/002'); // 355 registered voters
const AD_PU = findPollingUnitInState('AD', 'AD-A/W1/001'); // 388 registered voters

function makeRecord(id, partyClientId, puCode, overrides = {}) {
  return {
    id,
    submissionHash: `hash-${id}`,
    payload: {
      agentId: `agent-${partyClientId}`,
      partyClientId,
      stateCode: 'GM',
      puCode,
      wardCode: 'GM-A/W1',
      lgaCode: 'GM-A',
      partyVotes: { APC: 50, PDP: 50 },
      ocrVotes: { APC: 50, PDP: 50 },
      photoUrl: 'local-photo://x',
      gps: null,
      timestamp: Date.now(),
      deviceId: 'device-1',
      ...overrides,
    },
  };
}

// CLAUDE.md, non-negotiable: "Strict data isolation between party clients.
// One party's client must never be able to query, see, or infer another
// party's data. Enforce this at the access-control layer, not just the
// UI." These tests exercise exactly that: every party-dashboard-facing
// query on mockServer.js is scoped by partyClientId (and, since Phase 4,
// stateCode) and structurally cannot return another client's — or another
// state's — rows.
describe('tenant isolation between party clients', () => {
  it('getSubmissionsForClient only returns that client\'s own submissions', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode));
    await server.ingest(makeRecord('b1', 'party-beta', PU_B.puCode));

    const alphaView = server.getSubmissionsForClient('party-alpha', 'GM');
    const betaView = server.getSubmissionsForClient('party-beta', 'GM');

    assert.strictEqual(alphaView.length, 1);
    assert.strictEqual(alphaView[0].id, 'a1');
    assert.strictEqual(betaView.length, 1);
    assert.strictEqual(betaView[0].id, 'b1');
  });

  it('two party clients independently reporting the same PU is NOT flagged as a duplicate', async () => {
    // This is the important nuance: duplicate detection must be scoped per
    // client, because both clients legitimately monitor the same PUs.
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode));
    await server.ingest(makeRecord('b1', 'party-beta', PU_A.puCode)); // same PU, different client

    assert.strictEqual(server.getDiscrepanciesForClient('party-alpha', 'GM').length, 0);
    assert.strictEqual(server.getDiscrepanciesForClient('party-beta', 'GM').length, 0);
  });

  it('a genuine same-client duplicate is still caught and stays scoped to that client', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode));
    await server.ingest(makeRecord('a2', 'party-alpha', PU_A.puCode)); // same client, same PU
    await server.ingest(makeRecord('b1', 'party-beta', PU_A.puCode)); // unrelated client, unaffected

    const alphaDiscrepancies = server.getDiscrepanciesForClient('party-alpha', 'GM');
    const betaDiscrepancies = server.getDiscrepanciesForClient('party-beta', 'GM');

    assert.strictEqual(alphaDiscrepancies.length, 1);
    assert.strictEqual(alphaDiscrepancies[0].id, 'a2');
    assert.strictEqual(betaDiscrepancies.length, 0);
  });

  it('getDiscrepanciesForClient never surfaces another client\'s implausible submission', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode, { partyVotes: { APC: 300, PDP: 300 } })); // 600 > 412
    await server.ingest(makeRecord('b1', 'party-beta', PU_B.puCode)); // clean

    assert.strictEqual(server.getDiscrepanciesForClient('party-alpha', 'GM').length, 1);
    assert.strictEqual(server.getDiscrepanciesForClient('party-beta', 'GM').length, 0);
  });

  it('getAuditLogForClient only returns that client\'s own entries', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode));
    await server.ingest(makeRecord('a2', 'party-alpha', PU_B.puCode));
    await server.ingest(makeRecord('b1', 'party-beta', PU_A.puCode));

    const alphaLog = server.getAuditLogForClient('party-alpha', 'GM');
    const betaLog = server.getAuditLogForClient('party-beta', 'GM');

    assert.strictEqual(alphaLog.length, 2);
    assert.strictEqual(betaLog.length, 1);
    assert.ok(alphaLog.every((e) => e.partyClientId === 'party-alpha'));
    assert.ok(betaLog.every((e) => e.partyClientId === 'party-beta'));
  });

  it('an unknown/unregistered partyClientId gets an empty result, never an error or someone else\'s data', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode));

    assert.deepStrictEqual(server.getSubmissionsForClient('party-nonexistent', 'GM'), []);
    assert.deepStrictEqual(server.getDiscrepanciesForClient('party-nonexistent', 'GM'), []);
    assert.deepStrictEqual(server.getAuditLogForClient('party-nonexistent', 'GM'), []);
  });

  it('the audit log is append-only: resending the same id does not add a second entry', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode));
    await server.ingest(makeRecord('a1', 'party-alpha', PU_A.puCode)); // retry, same id

    assert.strictEqual(server.getAuditLogForClient('party-alpha', 'GM').length, 1);
  });

  it('the same party client operating in two different states never sees one state\'s data under the other', async () => {
    const server = createMockServer();
    const gmRecord = makeRecord('a-gm', 'party-alpha', PU_A.puCode);
    const adRecord = makeRecord('a-ad', 'party-alpha', AD_PU.puCode, { stateCode: 'AD', wardCode: 'AD-A/W1', lgaCode: 'AD-A' });
    await server.ingest(gmRecord);
    await server.ingest(adRecord);

    const gmView = server.getSubmissionsForClient('party-alpha', 'GM');
    const adView = server.getSubmissionsForClient('party-alpha', 'AD');

    assert.strictEqual(gmView.length, 1);
    assert.strictEqual(gmView[0].id, 'a-gm');
    assert.strictEqual(adView.length, 1);
    assert.strictEqual(adView[0].id, 'a-ad');

    // Same PU-code-collision property as cross-client isolation, but
    // across states instead: reporting AD's own PU 001 must not register
    // as a "duplicate" of GM's PU 001 just because both happen to be a
    // client's first submission in their respective states.
    assert.strictEqual(server.getDiscrepanciesForClient('party-alpha', 'GM').length, 0);
    assert.strictEqual(server.getDiscrepanciesForClient('party-alpha', 'AD').length, 0);
  });
});
