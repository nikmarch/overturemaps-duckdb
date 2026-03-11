// DuckDB-backed session state.
//
// Persists pipeline config (nodes, search, limit, bbox, sqlOverride, loadedTables)
// in a _session table. Zustand remains the reactive layer for UI — this module
// syncs between the two:
//
//   DuckDB _session ←→ Zustand store
//
// On init: read _session → hydrate Zustand
// On change: Zustand subscriber → write _session (debounced)

import { getConn } from './duckdb.js';
import { useStore } from './store.js';

const TABLE = '_session';

// Keys we persist. Each maps to a Zustand state field.
const SESSION_KEYS = [
  'pipeline',
  'pipelineSearch',
  'pipelineLimit',
  'pipelineBbox',
  'sqlOverride',
  'loadedTables',
];

// ── Table setup ──

export async function initSessionTable() {
  const conn = getConn();
  if (!conn) return;

  await conn.query(`
    CREATE TABLE IF NOT EXISTS "${TABLE}" (
      key VARCHAR PRIMARY KEY,
      val VARCHAR
    )
  `);
}

// ── Read / Write ──

async function getSession(key) {
  const conn = getConn();
  if (!conn) return undefined;

  try {
    const res = await conn.query(
      `SELECT val FROM "${TABLE}" WHERE key = '${key}'`
    );
    const rows = res.toArray();
    if (rows.length === 0) return undefined;
    return JSON.parse(rows[0].val);
  } catch {
    return undefined;
  }
}

async function setSession(key, value) {
  const conn = getConn();
  if (!conn) return;

  const json = JSON.stringify(value).replace(/'/g, "''");
  await conn.query(`
    INSERT OR REPLACE INTO "${TABLE}" (key, val)
    VALUES ('${key}', '${json}')
  `);
}

// ── Restore: DuckDB → Zustand ──

export async function restoreSession() {
  const conn = getConn();
  if (!conn) return false;

  try {
    const res = await conn.query(`SELECT key, val FROM "${TABLE}"`);
    const rows = res.toArray();
    if (rows.length === 0) return false;

    const patch = {};
    for (const row of rows) {
      if (SESSION_KEYS.includes(row.key)) {
        try {
          patch[row.key] = JSON.parse(row.val);
        } catch { /* skip corrupt entries */ }
      }
    }

    if (Object.keys(patch).length > 0) {
      useStore.setState(patch);
      return true;
    }
  } catch {
    // Table might not exist yet on first run
  }
  return false;
}

// ── Persist: Zustand → DuckDB (debounced) ──

let syncTimer = null;

function persistSession() {
  const state = useStore.getState();
  const conn = getConn();
  if (!conn) return;

  // Fire-and-forget: write each key
  for (const key of SESSION_KEYS) {
    setSession(key, state[key]).catch(() => {});
  }
}

export function initSessionSync() {
  useStore.subscribe(
    s => SESSION_KEYS.map(k => s[k]),
    () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(persistSession, 500);
    },
    { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
}

// ── Clear session (called on loadArea / reset) ──

export async function clearSession() {
  const conn = getConn();
  if (!conn) return;

  try {
    await conn.query(`DELETE FROM "${TABLE}"`);
  } catch { /* table may not exist */ }
}
