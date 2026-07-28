import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockServer } from '../src/sync/mockServer.js';
import { POLLING_UNITS } from '../src/referenceData/gombe.js';
import { simulateConcurrentAgents } from './helpers/simulateAgents.js';

function lgaCodeFor(pu) {
  return pu.wardCode.split('/')[0]; // wardCode is "LGA/Wn" (see gombe.js)
}

function payloadFor({ agentIndex, submissionIndex, partyClientId, pu }) {
  return {
    agentId: `agent-${agentIndex}`,
    partyClientId,
    puCode: pu.puCode,
    wardCode: pu.wardCode,
    lgaCode: lgaCodeFor(pu),
    partyVotes: { APC: 10, PDP: 10 },
    ocrVotes: { APC: 10, PDP: 10 },
    photoUrl: null,
    gps: null,
    timestamp: Date.now(),
    deviceId: `device-${agentIndex}-${submissionIndex}`,
  };
}

// CLAUDE.md Phase 3: "load-test the dashboard and sync layer under
// concurrent submission" — as a simulated election, per the phase's own
// wording, since there's no real backend yet. These are correctness
// properties under concurrency, not throughput numbers (see
// scripts/run-load-test.js for a runnable report with timing).
describe('Phase 3: concurrent submission load (simulated election)', () => {
  it('a small agent group submitting concurrently loses nothing and creates no duplicate rows', async () => {
    const server = createMockServer({ latencyMs: 15 });
    const AGENT_COUNT = 12;
    const PER_AGENT = 3;

    const results = await simulateConcurrentAgents({
      server,
      agentCount: AGENT_COUNT,
      submissionsPerAgent: PER_AGENT,
      buildPayload: (agentIndex, s) => {
        const pu = POLLING_UNITS[(agentIndex + s) % POLLING_UNITS.length];
        const partyClientId = agentIndex % 2 === 0 ? 'party-alpha' : 'party-beta';
        return payloadFor({ agentIndex, submissionIndex: s, partyClientId, pu });
      },
    });

    const totalEnqueued = results.reduce((sum, r) => sum + r.enqueued, 0);
    const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);

    assert.strictEqual(totalEnqueued, AGENT_COUNT * PER_AGENT);
    assert.strictEqual(totalSynced, totalEnqueued); // zero data loss
    assert.strictEqual(server.count(), totalEnqueued); // zero duplicate rows server-side

    for (const r of results) {
      assert.ok(r.finalState.every((rec) => rec.status === 'synced'), `agent ${r.agentIndex} left unsynced records`);
    }
  });

  it('tenant isolation holds under concurrent load across two party clients', async () => {
    const server = createMockServer({ latencyMs: 10 });
    const AGENT_COUNT = 16;
    const PER_AGENT = 2;

    await simulateConcurrentAgents({
      server,
      agentCount: AGENT_COUNT,
      submissionsPerAgent: PER_AGENT,
      buildPayload: (agentIndex, s) => {
        const pu = POLLING_UNITS[(agentIndex + s) % POLLING_UNITS.length];
        const partyClientId = agentIndex % 2 === 0 ? 'party-alpha' : 'party-beta';
        return payloadFor({ agentIndex, submissionIndex: s, partyClientId, pu });
      },
    });

    const alpha = server.getSubmissionsForClient('party-alpha');
    const beta = server.getSubmissionsForClient('party-beta');

    assert.strictEqual(alpha.length + beta.length, AGENT_COUNT * PER_AGENT);
    assert.ok(alpha.every((r) => r.payload.partyClientId === 'party-alpha'));
    assert.ok(beta.every((r) => r.payload.partyClientId === 'party-beta'));

    // Audit logs must sum the same way and never cross over either.
    const alphaLog = server.getAuditLogForClient('party-alpha');
    const betaLog = server.getAuditLogForClient('party-beta');
    assert.strictEqual(alphaLog.length, alpha.length);
    assert.strictEqual(betaLog.length, beta.length);
  });

  it('many agents racing to report the SAME polling unit: exactly one comes out clean, none are lost or silently merged', async () => {
    const server = createMockServer({ latencyMs: 20 });
    const SAME_PU = POLLING_UNITS[0];
    const RACER_COUNT = 8;

    await simulateConcurrentAgents({
      server,
      agentCount: RACER_COUNT,
      submissionsPerAgent: 1,
      buildPayload: (agentIndex) =>
        payloadFor({ agentIndex, submissionIndex: 0, partyClientId: 'party-alpha', pu: SAME_PU }),
    });

    // Every racer's attempt is kept as its own row — a race must never
    // cause two submissions to collapse into one, or one to vanish.
    assert.strictEqual(server.count(), RACER_COUNT);

    const submissions = server.getSubmissionsForClient('party-alpha');
    const clean = submissions.filter((s) => s.validation.overallSeverity === 'ok');
    const flaggedDuplicate = submissions.filter(
      (s) => s.validation.checks.find((c) => c.type === 'duplicate').severity === 'error'
    );

    // Exactly one "first" — if the read-prior-then-write step in
    // mockServer.ingest() were ever split across an await point, two
    // concurrent calls could both read priorCount=0 and both come out
    // clean (a lost update). It isn't, so this must always be exactly 1.
    assert.strictEqual(clean.length, 1);
    assert.strictEqual(flaggedDuplicate.length, RACER_COUNT - 1);
  });
});
