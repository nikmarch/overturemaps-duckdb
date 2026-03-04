const DB_NAME = 'overture_snapviews';
const STORE_NAME = 'snapviews';
const DB_VERSION = 1;

let db = null;

async function openDb() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapviewMeta(sv) {
  try {
    const d = await openDb();
    const meta = {
      id: sv.id,
      keys: sv.keys,
      bbox: sv.bbox,
      ts: sv.ts,
      cap: sv.cap,
      totalRows: sv.totalRows,
      totalFiles: sv.totalFiles,
      totalTimeMs: sv.totalTimeMs,
    };
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(meta);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore storage errors */ }
}

export async function loadAllSnapviewMeta() {
  try {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch { return []; }
}

export async function deleteSnapviewMeta(id) {
  try {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}
