import { validateSubmission } from '../validation/validate.js';
import { findPollingUnit } from '../referenceData/gombe.js';

// Stand-in for the AppSync/DynamoDB ingestion endpoint (CLAUDE.md: "mock
// backend first" for Phase 1). The one property that matters for the
// sync-queue tests is the one real AppSync would also need to provide:
// ingesting the same idempotency key twice must not create a second row.
//
// It also now runs the Phase 2 validation pipeline once per *new*
// submission (not on idempotent resends of the same id — that's just a
// retried ack, not a new event), appends an audit-log entry, and keeps the
// validation result as that record's discrepancy entry. This is the
// server-side half of validate.js; src/ui/CaptureForm.jsx runs the same
// module client-side for an immediate agent-facing warning.
//
// Tenant isolation (CLAUDE.md: "strict data isolation between party
// clients... enforce this at the access-control layer, not just the UI"):
// every query the party dashboard uses takes a required partyClientId and
// filters by it. getAll()/getDiscrepancies() below are NOT party-scoped —
// they exist for the local-device outbox view and for tests, and must
// never be wired into anything party-client-facing. Real AppSync would
// enforce this with resolver-level auth rules; here it's enforced by simply
// not giving the dashboard's data layer any function capable of returning
// more than one party client's data at once.
export function createMockServer({ latencyMs = 0 } = {}) {
  const store = new Map(); // id -> record
  const auditLog = []; // append-only; entries are never mutated or removed
  let failNext = 0;

  async function ingest(record) {
    await delay(latencyMs);
    if (failNext > 0) {
      failNext -= 1;
      throw new Error('simulated network failure');
    }
    if (!store.has(record.id)) {
      const { partyClientId, puCode, partyVotes, ocrVotes, agentId } = record.payload;
      // Duplicate detection is scoped to the same party client on purpose:
      // two different party clients independently reporting the same PU is
      // the expected, normal case (each runs its own monitoring operation),
      // not a duplicate. Only a second submission *within one client's own
      // operation* is a genuine duplicate worth flagging.
      const priorPuCodes = Array.from(store.values())
        .filter((r) => r.payload.partyClientId === partyClientId)
        .map((r) => r.payload.puCode);
      const pu = findPollingUnit(puCode);
      const validation = validateSubmission({
        partyVotes,
        ocrVotes,
        registeredVoters: pu ? pu.registeredVoters : null,
        puCode,
        priorPuCodes,
      });
      const receivedAt = Date.now();
      store.set(record.id, { ...record, receivedAt, validation });
      auditLog.push({
        id: record.id,
        partyClientId,
        puCode,
        agentId,
        receivedAt,
        validationSeverity: validation.overallSeverity,
      });
    }
    // Already-seen id: silently succeed without writing (or re-validating,
    // or re-auditing) again. This is the server half of "no duplicate
    // submissions" — the client half is that it always resends under the
    // *same* id after a crash/restart.
    return { ok: true, id: record.id };
  }

  return {
    ingest,
    // Whole-server views — not party-scoped. Local outbox status + tests
    // only; never expose to a party-client-facing surface.
    getAll: () => Array.from(store.values()).sort((a, b) => a.receivedAt - b.receivedAt),
    getDiscrepancies: () =>
      Array.from(store.values())
        .filter((r) => r.validation.overallSeverity === 'warning' || r.validation.overallSeverity === 'error')
        .sort((a, b) => a.receivedAt - b.receivedAt),
    count: () => store.size,

    // Party-dashboard-facing views — every one requires a partyClientId and
    // can only ever return that client's own data.
    getSubmissionsForClient: (partyClientId) =>
      Array.from(store.values())
        .filter((r) => r.payload.partyClientId === partyClientId)
        .sort((a, b) => a.receivedAt - b.receivedAt),
    getDiscrepanciesForClient: (partyClientId) =>
      Array.from(store.values())
        .filter(
          (r) =>
            r.payload.partyClientId === partyClientId &&
            (r.validation.overallSeverity === 'warning' || r.validation.overallSeverity === 'error')
        )
        .sort((a, b) => a.receivedAt - b.receivedAt),
    getAuditLogForClient: (partyClientId) =>
      auditLog.filter((entry) => entry.partyClientId === partyClientId).sort((a, b) => a.receivedAt - b.receivedAt),

    failNextRequest(n = 1) {
      failNext = n;
    },
  };
}

function delay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
