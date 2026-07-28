// Stand-in for the AppSync/DynamoDB ingestion endpoint (CLAUDE.md: "mock
// backend first" for Phase 1). The one property that matters for the
// sync-queue tests is the one real AppSync would also need to provide:
// ingesting the same idempotency key twice must not create a second row.
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
      store.set(record.id, { ...record, receivedAt: Date.now() });
    }
    // Already-seen id: silently succeed without writing again. This is the
    // server half of "no duplicate submissions" — the client half is that
    // it always resends under the *same* id after a crash/restart.
    return { ok: true, id: record.id };
  }

  return {
    ingest,
    getAll: () => Array.from(store.values()).sort((a, b) => a.receivedAt - b.receivedAt),
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
