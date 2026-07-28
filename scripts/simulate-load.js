// Runnable load-test report for Phase 3 (CLAUDE.md: "load-test the
// dashboard and sync layer under concurrent submission"). tests/loadSimulation.test.js
// asserts correctness under concurrency with small, fast numbers; this
// script runs a bigger simulated agent group with realistic network
// latency and prints throughput/timing, the way an actual load test would
// report results. Still against the mock server — there's no real backend
// yet, so this measures our own code's behavior under concurrency, not
// real AWS latency/scale.
//
// Run with: npm run loadtest
import 'fake-indexeddb/auto';
import { createMockServer } from '../src/sync/mockServer.js';
import { POLLING_UNITS } from '../src/referenceData/gombe.js';
import { PARTY_CLIENTS } from '../src/referenceData/partyClients.js';
import { simulateConcurrentAgents } from '../tests/helpers/simulateAgents.js';

const AGENT_COUNT = 50;
const SUBMISSIONS_PER_AGENT = 5;
const SIMULATED_LATENCY_MS = 60; // rough stand-in for a real mobile network round trip

function lgaCodeFor(pu) {
  return pu.wardCode.split('/')[0];
}

function buildPayload(agentIndex, submissionIndex) {
  const pu = POLLING_UNITS[(agentIndex + submissionIndex) % POLLING_UNITS.length];
  const partyClientId = PARTY_CLIENTS[agentIndex % PARTY_CLIENTS.length].id;
  return {
    agentId: `agent-${agentIndex}`,
    partyClientId,
    puCode: pu.puCode,
    wardCode: pu.wardCode,
    lgaCode: lgaCodeFor(pu),
    partyVotes: { APC: 40 + submissionIndex, PDP: 30 + submissionIndex },
    ocrVotes: { APC: 40 + submissionIndex, PDP: 30 + submissionIndex },
    photoUrl: null,
    gps: null,
    timestamp: Date.now(),
    deviceId: `device-${agentIndex}`,
  };
}

async function main() {
  const server = createMockServer({ latencyMs: SIMULATED_LATENCY_MS });
  const totalSubmissions = AGENT_COUNT * SUBMISSIONS_PER_AGENT;

  console.log(
    `Simulating ${AGENT_COUNT} agents x ${SUBMISSIONS_PER_AGENT} submissions ` +
      `(${totalSubmissions} total) at ~${SIMULATED_LATENCY_MS}ms simulated latency each...\n`
  );

  const start = performance.now();
  const results = await simulateConcurrentAgents({
    server,
    agentCount: AGENT_COUNT,
    submissionsPerAgent: SUBMISSIONS_PER_AGENT,
    buildPayload,
  });
  const elapsedMs = performance.now() - start;

  const totalEnqueued = results.reduce((sum, r) => sum + r.enqueued, 0);
  const totalSynced = results.reduce((sum, r) => sum + r.synced, 0);
  const unsyncedAgents = results.filter((r) => r.synced !== r.enqueued);

  let discrepancyCount = 0;
  for (const client of PARTY_CLIENTS) {
    discrepancyCount += server.getDiscrepanciesForClient(client.id).length;
  }

  console.log('--- Results ---');
  console.log(`Wall time:            ${elapsedMs.toFixed(0)}ms`);
  console.log(`Throughput:           ${(totalSubmissions / (elapsedMs / 1000)).toFixed(1)} submissions/sec`);
  console.log(`Enqueued:             ${totalEnqueued} / ${totalSubmissions} expected`);
  console.log(`Synced:               ${totalSynced} / ${totalEnqueued} enqueued`);
  console.log(`Server row count:     ${server.count()} (should equal enqueued — no duplicates, no loss)`);
  console.log(`Discrepancies flagged:${discrepancyCount} (expected: some, from the shared demo PUs colliding)`);
  console.log(`Agents left unsynced: ${unsyncedAgents.length}`);

  const ok =
    totalEnqueued === totalSubmissions &&
    totalSynced === totalEnqueued &&
    server.count() === totalEnqueued &&
    unsyncedAgents.length === 0;

  console.log(`\n${ok ? 'PASS' : 'FAIL'}: zero data loss and zero duplicates under concurrent load.`);
  process.exitCode = ok ? 0 : 1;
}

main();
