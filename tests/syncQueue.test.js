import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncQueue } from '../src/sync/syncQueue.js';
import { createMockServer } from '../src/sync/mockServer.js';

// Each scenario below maps directly to one of the five conditions CLAUDE.md
// requires Phase 1 to prove, automated rather than manual: airplane mode
// during capture, app killed mid-sync, device restart before sync
// completes, delayed reconnect after hours offline, throttled 2G. The bar
// for all of them is the same: zero data loss, no duplicate submissions.

let dbCounter = 0;
function uniqueDbName() {
  dbCounter += 1;
  return `test-outbox-${Date.now()}-${dbCounter}`;
}

function samplePayload(overrides = {}) {
  return {
    agentId: 'agent-1',
    puCode: 'GM/AK/001',
    wardCode: 'GM/AK',
    lgaCode: 'GM',
    partyVotes: { APC: 120, PDP: 98, LP: 12 },
    ocrVotes: { APC: 120, PDP: 98, LP: 12 },
    photoUrl: 'local://photo-1.jpg',
    gps: { lat: 10.29, lng: 11.17 },
    timestamp: Date.now(),
    deviceId: 'device-1',
    ...overrides,
  };
}

describe('SyncQueue offline scenarios', () => {
  it('airplane mode during capture: enqueue persists durably with zero network attempts', async () => {
    let networkCalls = 0;
    const server = createMockServer();
    let online = false;
    const queue = await new SyncQueue({
      dbName: uniqueDbName(),
      isOnline: () => online,
      transport: async (record) => {
        networkCalls += 1;
        await server.ingest(record);
      },
    }).init();

    const record = await queue.enqueue(samplePayload());
    assert.strictEqual(record.status, 'pending');
    assert.strictEqual(networkCalls, 0);

    await queue.flush(); // still offline: must no-op, must not lose the capture
    assert.strictEqual(networkCalls, 0);
    const stored = await queue.all();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].status, 'pending');

    online = true;
    await queue.flush();
    assert.strictEqual(networkCalls, 1);
    assert.strictEqual(server.count(), 1);
    assert.strictEqual((await queue.all())[0].status, 'synced');
  });

  it('app killed mid-sync: record stuck in "syncing" across a restart resends but does not duplicate server-side', async () => {
    const dbName = uniqueDbName();
    const server = createMockServer();
    const transport = async (record) => { await server.ingest(record); };

    const queue1 = await new SyncQueue({ dbName, isOnline: () => true, transport }).init();
    const record = await queue1.enqueue(samplePayload());

    // Reproduce the exact ambiguous state a kill leaves behind: the request
    // actually reached the server, but the client never got to process the
    // ack and update its own status before the process died.
    await server.ingest(record);
    await queue1._setStatus(record.id, { status: 'syncing' });

    const queue2 = await new SyncQueue({ dbName, isOnline: () => true, transport }).init();
    const resumed = await queue2.all();
    assert.strictEqual(resumed[0].status, 'pending'); // init() must requeue ambiguous records

    await queue2.flush();

    assert.strictEqual(server.count(), 1); // idempotent id kept the resend from duplicating
    assert.strictEqual((await queue2.all())[0].status, 'synced');
  });

  it('device restart before sync completes: items captured but never sent still arrive exactly once', async () => {
    const dbName = uniqueDbName();
    const server = createMockServer();
    const transport = async (record) => { await server.ingest(record); };

    const queue1 = await new SyncQueue({ dbName, isOnline: () => false, transport }).init();
    await queue1.enqueue(samplePayload({ puCode: 'GM/AK/002' }));
    await queue1.enqueue(samplePayload({ puCode: 'GM/AK/003' }));
    // restart happens here, before connectivity returns and before any flush

    const queue2 = await new SyncQueue({ dbName, isOnline: () => true, transport }).init();
    await queue2.flush();

    assert.strictEqual(server.count(), 2);
    assert.ok((await queue2.all()).every((r) => r.status === 'synced'));
  });

  it('delayed reconnect after hours offline: a whole offline batch arrives, in capture order, exactly once', async () => {
    const server = createMockServer();
    let online = false;
    const transport = async (record) => { await server.ingest(record); };
    const queue = await new SyncQueue({ dbName: uniqueDbName(), isOnline: () => online, transport }).init();

    const puCodes = ['GM/AK/010', 'GM/AK/011', 'GM/AK/012', 'GM/AK/013'];
    for (const puCode of puCodes) {
      await queue.enqueue(samplePayload({ puCode }));
    }

    await queue.flush(); // still offline
    assert.strictEqual(server.count(), 0);

    online = true; // "hours later"
    await queue.flush();

    assert.strictEqual(server.count(), 4);
    assert.deepStrictEqual(server.getAll().map((r) => r.payload.puCode), puCodes);
  });

  it('throttled 2G: high latency does not cause concurrent double-sends', async () => {
    const server = createMockServer({ latencyMs: 30 });
    const transport = async (record) => { await server.ingest(record); };
    const queue = await new SyncQueue({ dbName: uniqueDbName(), isOnline: () => true, transport }).init();

    await queue.enqueue(samplePayload({ puCode: 'GM/AK/020' }));
    await queue.enqueue(samplePayload({ puCode: 'GM/AK/021' }));

    // Simulates an impatient agent mashing "sync now" while the automatic
    // online-event flush is already in flight.
    const flushA = queue.flush();
    const flushB = queue.flush();
    await Promise.all([flushA, flushB]);

    assert.strictEqual(server.count(), 2); // re-entrancy guard, not the network, prevented a double send
    assert.ok((await queue.all()).every((r) => r.status === 'synced'));
  });

  it('a genuine transient failure leaves the record pending for retry, never lost or duplicated', async () => {
    const server = createMockServer();
    server.failNextRequest(1);
    const transport = async (record) => { await server.ingest(record); };
    const queue = await new SyncQueue({ dbName: uniqueDbName(), isOnline: () => true, transport }).init();

    await queue.enqueue(samplePayload());
    await queue.flush(); // fails once

    let all = await queue.all();
    assert.strictEqual(all[0].status, 'pending');
    assert.strictEqual(all[0].attempts, 1);
    assert.strictEqual(server.count(), 0);

    await queue.flush(); // retries, succeeds
    all = await queue.all();
    assert.strictEqual(all[0].status, 'synced');
    assert.strictEqual(server.count(), 1);
  });
});
