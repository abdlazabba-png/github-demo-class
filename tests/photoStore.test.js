import 'fake-indexeddb/auto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { savePhoto, getPhoto } from '../src/sync/photoStore.js';

describe('photoStore', () => {
  it('round-trips a blob by id', async () => {
    const blob = new Blob(['fake-jpeg-bytes'], { type: 'image/jpeg' });
    const id = 'photo-1';

    await savePhoto(id, blob);
    const record = await getPhoto(id);

    assert.ok(record);
    assert.strictEqual(record.id, id);
    assert.strictEqual(record.blob.type, 'image/jpeg');
    assert.strictEqual(record.blob.size, blob.size);
  });

  it('returns null for an id that was never saved', async () => {
    const record = await getPhoto('never-saved');
    assert.strictEqual(record, null);
  });

  it('put overwrites an existing id rather than erroring', async () => {
    const id = 'photo-overwrite';
    await savePhoto(id, new Blob(['first']));
    await savePhoto(id, new Blob(['second-longer-content']));

    const record = await getPhoto(id);
    assert.strictEqual(record.blob.size, new Blob(['second-longer-content']).size);
  });
});
