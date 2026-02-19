import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

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
  return conn;
}

export function getConn() {
  return conn;
}

export function getDb() {
  return db;
}

export async function dropAllTables() {
  if (!conn) return;
  const tables = (await conn.query('SHOW TABLES')).toArray().map(t => t.name);
  for (const t of tables) {
    if (!t) continue;
    await conn.query(`DROP TABLE IF EXISTS "${t}"`);
  }
}
