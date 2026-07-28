import { validateSubmission } from '../validation/validate.js';
import { findPollingUnit } from '../referenceData/gombe.js';

// Stand-in for the AppSync/DynamoDB ingestion endpoint (CLAUDE.md: "mock
// backend first" for Phase 1). The one property that matters for the
// sync-queue tests is the one real AppSync would also need to provide:
// ingesting the same idempotency key twice must not create a second row.
//
// It also now runs the Phase 2 validation pipeline once per *new*
// submission (not on idempotent resends of the same id — that's just a
// retried ack, not a new event) and keeps the result as that record's
// discrepancy entry, queryable via getDiscrepancies(). This is the
// server-side half of validate.js; src/ui/CaptureForm.jsx runs the same
// module client-side for an immediate agent-facing warning.
export function createMockServer({ latencyMs = 0 } = {}) {
  const store = new Map(); // id -> record
  let failNext = 0;

  async function ingest(record) {
    await delay(latencyMs);
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('simulated network failure');
    }
    if (!store.has(record.id)) {
      const priorPuCodes = Array.from(store.values()).map((r) => r.payload.puCode);
      const pu = findPollingUnit(record.payload.puCode);
      const validation = validateSubmission({
        partyVotes: record.payload.partyVotes,
        ocrVotes: record.payload.ocrVotes,
        registeredVoters: pu ? pu.registeredVoters : null,
        puCode: record.payload.puCode,
        priorPuCodes,
      });
      store.set(record.id, { ...record, receivedAt: Date.now(), validation });
    }
    // Already-seen id: silently succeed without writing (or re-validating)
    // again. This is the server half of "no duplicate submissions" — the
    // client half is that it always resends under the *same* id after a
    // crash/restart.
    return { ok: true, id: record.id };
  }

  return {
    ingest,
    getAll: () => Array.from(store.values()).sort((a, b) => a.receivedAt - b.receivedAt),
    getDiscrepancies: () =>
      Array.from(store.values())
        .filter((r) => r.validation.overallSeverity === 'warning' || r.validation.overallSeverity === 'error')
        .sort((a, b) => a.receivedAt - b.receivedAt),
    count: () => store.size,
    failNextRequest(n = 1) {
      failNext = n;
    },
  };
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
