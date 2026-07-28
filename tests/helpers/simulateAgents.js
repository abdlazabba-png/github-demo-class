import { SyncQueue } from '../../src/sync/syncQueue.js';

// CLAUDE.md Phase 3: "small agent group, real or simulated election,
// load-test the dashboard and sync layer under concurrent submission."
// There's no real backend yet (still the mock server), so this is the
// simulated-election path: it spins up `agentCount` independent
// SyncQueue instances — each with its own local IndexedDB outbox, exactly
// like separate physical devices would have — and drives them all
// concurrently against the SAME shared mock server, the way a real pilot
// with many field agents submitting around the same time would.
export async function simulateConcurrentAgents({ server, agentCount, submissionsPerAgent, buildPayload }) {
  const agentIndexes = Array.from({ length: agentCount }, (_, i) => i);

  return Promise.all(
    agentIndexes.map(async (agentIndex) => {
      const queue = await new SyncQueue({
        // Unique per simulated agent so each gets its own isolated local
        // outbox in the shared fake-indexeddb engine, matching how
        // separate physical devices would never share local storage.
        dbName: `load-test-agent-${agentIndex}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        isOnline: () => true,
        transport: async (record) => {
          await server.ingest({
            id: record.id,
            payload: record.payload,
            submissionHash: record.submissionHash,
          });
        },
      }).init();

      for (let s = 0; s < submissionsPerAgent; s += 1) {
        await queue.enqueue(buildPayload(agentIndex, s));
      }
      await queue.flush();

      const finalState = await queue.all();
      return {
        agentIndex,
        enqueued: finalState.length,
        synced: finalState.filter((r) => r.status === 'synced').length,
        finalState,
      };
    })
  );
}
