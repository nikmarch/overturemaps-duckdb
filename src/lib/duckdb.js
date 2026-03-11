import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';
import { clearFtsCache } from './fts.js';

let db = null;
let conn = null;

export async function initDuckDB() {
  const bundles = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(bundles);
  const worker = new Worker(URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  ));
  db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();

  await conn.query('INSTALL spatial; LOAD spatial;');

  // FTS is optional in some WASM builds / hosting contexts.
  // If it fails to load, we fall back to ILIKE queries.
  try {
    await conn.query('INSTALL fts; LOAD fts;');
  } catch (e) {
    console.warn('DuckDB FTS extension unavailable:', e?.message || e);
  }

  return conn;
}

export function getConn() {
  return conn;
}

export function getDb() {
  return db;
}

// Tables to preserve when dropping all user data tables
const SYSTEM_TABLES = new Set(['_session', '_load_history']);

export async function dropAllTables() {
  if (!conn) return;
  clearFtsCache();
  const tables = (await conn.query('SHOW TABLES')).toArray().map(t => t.name);
  for (const t of tables) {
    if (!t || SYSTEM_TABLES.has(t)) continue;
    await conn.query(`DROP TABLE IF EXISTS "${t}"`);
  }
}
