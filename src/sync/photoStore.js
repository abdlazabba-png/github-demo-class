import { reqToPromise, txDone } from './db.js';

// Separate database from the submissions outbox on purpose: photo blobs are
// large and have a different lifecycle (eventually uploaded to S3 once the
// real backend exists), so keeping them out of the outbox store means
// outbox reads/writes (which happen on every enqueue/flush) never have to
// move megabytes of image data around.
const DB_NAME = 'ert-photos';
const STORE = 'photos';

function openPhotoDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePhoto(id, blob) {
  const db = await openPhotoDB();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put({ id, blob, createdAt: Date.now() });
  await txDone(tx);
  return id;
}

export async function getPhoto(id) {
  const db = await openPhotoDB();
  const tx = db.transaction(STORE, 'readonly');
  const record = await reqToPromise(tx.objectStore(STORE).get(id));
  return record || null;
}

export async function getPhotoObjectUrl(id) {
  const record = await getPhoto(id);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}
