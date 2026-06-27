// Tiny IndexedDB store so recordings survive page reloads (a bake-off run reloads
// nothing, but you record once and can re-run engine sweeps across sessions).

const DB = 'voice-bench';
const STORE = 'recordings';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putRecording(id: string, pcm: Float32Array): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(pcm, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getAllRecordings(): Promise<Map<string, Float32Array>> {
  const db = await open();
  const out = new Map<string, Float32Array>();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as string[];
      const vals = valsReq.result as Float32Array[];
      keys.forEach((k, i) => out.set(k, vals[i]!));
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return out;
}
