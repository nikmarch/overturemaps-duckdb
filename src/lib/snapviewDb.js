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

async function idbPut(store, value) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(store, key) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly');
    const req = key === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store, key) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(store) {
  const d = await openDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// --- Snapview metadata ---

export async function saveSnapviewMeta(sv) {
  try {
    await idbPut(STORE_NAME, {
      id: sv.id, keys: sv.keys, bbox: sv.bbox, ts: sv.ts,
      cap: sv.cap, totalRows: sv.totalRows, totalFiles: sv.totalFiles, totalTimeMs: sv.totalTimeMs,
    });
  } catch { /* ignore storage errors */ }
}

export async function loadAllSnapviewMeta() {
  try { return (await idbGet(STORE_NAME)) || []; }
  catch { return []; }
}

export async function deleteSnapviewMeta(id) {
  try { await idbDelete(STORE_NAME, id); }
  catch { /* ignore */ }
}

// --- Table cache (parquet buffers) ---

export async function saveTableCache(tableName, parquetBuffer, { bbox, release }) {
  try { await idbPut(TABLE_CACHE_STORE, { tableName, parquetBuffer, bbox, release, ts: Date.now() }); }
  catch (e) { console.warn('saveTableCache:', e); }
}

export async function loadTableCache(tableName) {
  try { return (await idbGet(TABLE_CACHE_STORE, tableName)) || null; }
  catch { return null; }
}

export async function deleteTableCache(tableName) {
  try { await idbDelete(TABLE_CACHE_STORE, tableName); }
  catch { /* ignore */ }
}

export async function clearAllTableCache() {
  try { await idbClear(TABLE_CACHE_STORE); }
  catch { /* ignore */ }
}
