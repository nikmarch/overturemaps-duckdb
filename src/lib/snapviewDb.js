const DB_NAME = 'overture_snapviews';
const STORE_NAME = 'snapviews';
const TABLE_CACHE_STORE = 'table_cache';
const DB_VERSION = 2;

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
      if (!d.objectStoreNames.contains(TABLE_CACHE_STORE)) {
        d.createObjectStore(TABLE_CACHE_STORE, { keyPath: 'tableName' });
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

// --- Table cache (parquet buffers in IndexedDB) ---

export async function saveTableCache(tableName, parquetBuffer, { bbox, release }) {
  try {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(TABLE_CACHE_STORE, 'readwrite');
      tx.objectStore(TABLE_CACHE_STORE).put({
        tableName,
        parquetBuffer,
        bbox,
        release,
        ts: Date.now(),
      });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) { console.warn('saveTableCache:', e); }
}

export async function loadTableCache(tableName) {
  try {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(TABLE_CACHE_STORE, 'readonly');
      const req = tx.objectStore(TABLE_CACHE_STORE).get(tableName);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

export async function deleteTableCache(tableName) {
  try {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(TABLE_CACHE_STORE, 'readwrite');
      tx.objectStore(TABLE_CACHE_STORE).delete(tableName);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}

export async function clearAllTableCache() {
  try {
    const d = await openDb();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(TABLE_CACHE_STORE, 'readwrite');
      tx.objectStore(TABLE_CACHE_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* ignore */ }
}
