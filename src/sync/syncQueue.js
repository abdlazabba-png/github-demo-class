import { STORE, openOutboxDB, reqToPromise, txDone } from './db.js';
import { computeSubmissionHash } from './hash.js';

// Crash-safe offline outbox for field-agent submissions.
//
// Guarantees this class exists to provide (see CLAUDE.md Phase 1):
//   - Zero data loss: enqueue() only resolves after the IndexedDB write
//     transaction has committed, so a capture that "succeeded" on screen is
//     durable even if the app is killed a moment later.
//   - No duplicate submissions: every record carries a client-generated
//     UUID that acts as an idempotency key. A resend after a crash/kill is
//     safe because the transport's remote end (mock or real AppSync) must
//     dedupe by that id.
export class SyncQueue {
  constructor({ transport, isOnline, dbName = 'ert-outbox' } = {}) {
    if (typeof transport !== 'function') {
      throw new Error('SyncQueue requires a transport(record) function');
    }
    this.transport = transport;
    this.isOnline = isOnline || (() => typeof navigator === 'undefined' || navigator.onLine);
    this.dbPromise = openOutboxDB(dbName);
    this.flushing = false;
    this.listeners = new Set();
    // Date.now() alone isn't a reliable capture-order key: on Windows the
    // clock can resolve to ~16ms, so several enqueue() calls in a tight
    // loop can tie, and IndexedDB's getAll() on a UUID-keyed store returns
    // key order, not insertion order. This counter, incremented
    // synchronously before any await, breaks ties deterministically.
    this._seq = 0;
  }

  async init() {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = await reqToPromise(store.getAll());
    // A record left in 'syncing' means the app stopped (killed, crashed,
    // device restarted) between "request sent" and "ack processed". We
    // cannot know whether the server received it, so we requeue it —
    // correctness then rests entirely on the transport's idempotent dedupe.
    for (const record of all) {
      if (record.status === 'syncing') {
        record.status = 'pending';
        store.put(record);
      }
    }
    await txDone(tx);
    return this;
  }

  async enqueue(payload) {
    const seq = this._seq++; // assigned synchronously, before the awaits below can interleave
    const id = crypto.randomUUID();
    const submissionHash = await computeSubmissionHash({ id, payload });
    const record = {
      id,
      payload,
      submissionHash,
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
      seq,
      lastAttemptAt: null,
      lastError: null,
    };
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    await txDone(tx);
    this._notify();
    return record;
  }

  async all() {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readonly');
    const records = await reqToPromise(tx.objectStore(STORE).getAll());
    return records.sort((a, b) => a.createdAt - b.createdAt || (a.seq ?? 0) - (b.seq ?? 0));
  }

  async pending() {
    return (await this.all()).filter((r) => r.status === 'pending');
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify() {
    for (const fn of this.listeners) fn();
  }

  async _setStatus(id, patch) {
    const db = await this.dbPromise;
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const record = await reqToPromise(store.get(id));
    if (!record) return null;
    Object.assign(record, patch);
    store.put(record);
    await txDone(tx);
    return record;
  }

  // Sends pending records one at a time, in capture order. Sequential (not
  // parallel) on purpose: on a throttled 2G link we never want two in-flight
  // requests for the same outbox, and it keeps at most one record ambiguous
  // ('syncing') at any instant if the process dies mid-flush.
  async flush() {
    if (this.flushing) return;
    if (!this.isOnline()) return;
    this.flushing = true;
    try {
      const queued = await this.pending();
      for (const record of queued) {
        if (!this.isOnline()) break;
        await this._setStatus(record.id, { status: 'syncing', lastAttemptAt: Date.now() });
        this._notify();
        try {
          await this.transport(record);
          await this._setStatus(record.id, { status: 'synced', lastError: null });
        } catch (err) {
          await this._setStatus(record.id, {
            status: 'pending',
            attempts: record.attempts + 1,
            lastError: String((err && err.message) || err),
          });
          this._notify();
          break;
        }
        this._notify();
      }
    } finally {
      this.flushing = false;
    }
  }
}
