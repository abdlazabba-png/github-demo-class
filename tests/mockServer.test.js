import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../src/sync/mockServer.js';
import { findPollingUnitInState } from '../src/referenceData/states/index.js';

// GM-A/W1/001 has 412 registered voters (src/referenceData/states/gombe.js).
const PU = findPollingUnitInState('GM', 'GM-A/W1/001');

function makeRecord(id, overrides = {}) {
  return {
    id,
    submissionHash: `hash-${id}`,
    payload: {
      agentId: 'agent-1',
      stateCode: 'GM',
      puCode: PU.puCode,
      wardCode: PU.wardCode,
      lgaCode: 'GM-A',
      partyVotes: { APC: 100, PDP: 50 },
      ocrVotes: { APC: 100, PDP: 50 },
      photoUrl: 'local-photo://x',
      gps: null,
      timestamp: Date.now(),
      deviceId: 'device-1',
      ...overrides,
    },
  };
}

describe('mockServer validation pipeline', () => {
  it('attaches an ok validation result to a clean submission', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('r1'));
    const [record] = server.getAll();
    assert.strictEqual(record.validation.overallSeverity, 'ok');
    assert.strictEqual(server.getDiscrepancies().length, 0);
  });

  it('surfaces an implausible submission (votes > registered voters) in the discrepancy queue', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('r1', { partyVotes: { APC: 300, PDP: 300 } })); // 600 > 412
    const discrepancies = server.getDiscrepancies();
    assert.strictEqual(discrepancies.length, 1);
    assert.strictEqual(discrepancies[0].validation.overallSeverity, 'error');
  });

  it('surfaces an OCR-vs-manual mismatch as a discrepancy', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('r1', { partyVotes: { APC: 100, PDP: 50 }, ocrVotes: { APC: 80, PDP: 50 } }));
    const discrepancies = server.getDiscrepancies();
    assert.strictEqual(discrepancies.length, 1);
    assert.strictEqual(discrepancies[0].validation.overallSeverity, 'warning');
  });

  it('flags a second submission for the same PU as a duplicate, not a silent merge', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('r1'));
    await server.ingest(makeRecord('r2')); // different id, same puCode

    assert.strictEqual(server.count(), 2); // both are kept — nothing silently overwritten
    const discrepancies = server.getDiscrepancies();
    assert.strictEqual(discrepancies.length, 1); // only the second one is "a duplicate of" something
    assert.strictEqual(discrepancies[0].id, 'r2');
    assert.strictEqual(discrepancies[0].validation.overallSeverity, 'error');
  });

  it('does not duplicate-flag or re-validate an idempotent resend of the same id', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('r1'));
    await server.ingest(makeRecord('r1')); // same id: a retry, not a new submission

    assert.strictEqual(server.count(), 1);
    assert.strictEqual(server.getDiscrepancies().length, 0);
  });

  it('marks plausibility unknown (not ok, not error) for a PU with no reference data', async () => {
    const server = createMockServer();
    await server.ingest(makeRecord('r1', { puCode: 'not-a-real-pu' }));
    const [record] = server.getAll();
    const plausibility = record.validation.checks.find((c) => c.type === 'plausibility');
    assert.strictEqual(plausibility.severity, 'unknown');
    // 'unknown' alone shouldn't land it in the discrepancy queue.
    assert.strictEqual(server.getDiscrepancies().length, 0);
  });
});
