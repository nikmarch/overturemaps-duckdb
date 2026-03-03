import * as duckdb from '@duckdb/duckdb-wasm';

let db = null;
let conn = null;

export function themeKeyToTable(key) {
  return key.replace(/\//g, '_');
}

async function ensureDb() {
  if (db) return;

  const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

  const worker = new Worker(bundle.mainWorker);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
}

function inferType(value) {
  if (value == null) return 'VARCHAR';
  if (typeof value === 'number') return Number.isInteger(value) ? 'BIGINT' : 'DOUBLE';
  if (typeof value === 'boolean') return 'BOOLEAN';
  return 'VARCHAR';
}

export async function loadTable(name, rows) {
  if (!rows || rows.length === 0) return;
  await ensureDb();

  // Infer schema from first row
  const first = rows[0];
  const cols = Object.keys(first);
  const colDefs = cols.map(c => `"${c}" ${inferType(first[c])}`).join(', ');

  await conn.query(`DROP TABLE IF EXISTS "${name}"`);
  await conn.query(`CREATE TABLE "${name}" (${colDefs})`);

  // Insert via prepared statement in batches
  const BATCH = 1000;
  const placeholders = cols.map(() => '?').join(', ');
  const insertSql = `INSERT INTO "${name}" VALUES (${placeholders})`;

  const stmt = await conn.prepare(insertSql);
  for (let i = 0; i < rows.length; i += BATCH) {
    const end = Math.min(i + BATCH, rows.length);
    for (let j = i; j < end; j++) {
      const row = rows[j];
      const values = cols.map(c => {
        const v = row[c];
        // Convert ArrayBuffer/Uint8Array to null (binary cols like geometry_wkb)
        if (v instanceof ArrayBuffer || v instanceof Uint8Array) return null;
        return v ?? null;
      });
      await stmt.query(...values);
    }
  }
  await stmt.close();
}

export async function query(sql) {
  await ensureDb();
  const result = await conn.query(sql);
  return result.toArray().map(row => row.toJSON());
}

export async function dropTable(name) {
  await ensureDb();
  await conn.query(`DROP TABLE IF EXISTS "${name}"`);
}

export async function listTables() {
  await ensureDb();
  const result = await conn.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'");
  return result.toArray().map(r => r.toJSON().table_name);
}

export async function close() {
  if (conn) { await conn.close(); conn = null; }
  if (db) { await db.terminate(); db = null; }
}

// Expose on window for console access
window.localdb = { query, listTables, loadTable, dropTable, close };
