// DuckDB FTS helpers
//
// Notes:
// - The FTS extension may not be available in all WASM builds.
// - These helpers are best-effort and should never break core app behavior.

function escapeSqlString(s) {
  return String(s).replace(/'/g, "''");
}

export async function ensureFtsIndex(conn, tableName) {
  if (!conn || !tableName) return false;

  // PRAGMA expects the table name as a string literal.
  // We assume the main table has columns: id, display_name
  try {
    await conn.query(
      `PRAGMA create_fts_index('${escapeSqlString(tableName)}', 'id', 'display_name');`
    );
    return true;
  } catch {
    // No-op: FTS not available / bad schema / older DuckDB.
    return false;
  }
}

export async function ftsSearchTable(conn, tableName, q, limit = 10) {
  const query = String(q || '').trim();
  if (!conn || !tableName || !query) return [];

  // Prefer FTS match; fallback to ILIKE if FTS isn't available.
  // We intentionally do per-table try/catch so one broken table doesn't poison the whole search.
  const qq = escapeSqlString(query);

  try {
    // DuckDB FTS convention: fts_main_<table>.match('query')
    const rows = (await conn.query(`
      SELECT
        id,
        display_name,
        centroid_lon,
        centroid_lat,
        '${escapeSqlString(tableName)}' AS source_table
      FROM "${tableName}"
      WHERE fts_main_${tableName}.match('${qq}')
      LIMIT ${Number(limit) || 10}
    `)).toArray();
    return rows;
  } catch {
    // FTS not available for this table; fall back to substring match.
  }

  try {
    const rows = (await conn.query(`
      SELECT
        id,
        display_name,
        centroid_lon,
        centroid_lat,
        '${escapeSqlString(tableName)}' AS source_table
      FROM "${tableName}"
      WHERE display_name ILIKE '%${qq}%'
      ORDER BY length(display_name) ASC
      LIMIT ${Number(limit) || 10}
    `)).toArray();
    return rows;
  } catch {
    return [];
  }
}

export async function listUserTables(conn) {
  const tables = (await conn.query('SHOW TABLES')).toArray().map(t => t.name).filter(Boolean);

  // Drop internal / helper tables.
  return tables.filter(t => {
    if (t.startsWith('_')) return false;
    if (t.startsWith('sqlite_')) return false;
    // fts extension creates its own helper tables; exclude them from user search sources.
    if (t.startsWith('fts_') || t.startsWith('fts_main_')) return false;
    return true;
  });
}
