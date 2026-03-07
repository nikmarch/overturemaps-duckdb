// DuckDB FTS helpers
//
// Notes:
// - The FTS extension may not be available in all WASM builds.
// - These helpers are best-effort and should never break core app behavior.

export function escapeSqlString(s) {
  return String(s).replace(/'/g, "''");
}

// Pure SQL snippet builder (easy to unit-test)
export function buildNameFilterSql(tableName, q, { useFts = false } = {}) {
  const query = String(q || '').trim();
  if (!tableName || !query) return '';

  const qq = escapeSqlString(query);

  if (useFts) {
    // DuckDB FTS convention: fts_main_<table>.match_bm25(id, 'query')
    // (DuckDB suggests match_bm25 when match() isn't available)
    return `fts_main_${tableName}.match_bm25(id, '${qq}')`;
  }

  return `display_name ILIKE '%${qq}%'`;
}

const FTS_PRESENT_CACHE = new Map();

export async function tableHasFts(conn, tableName) {
  if (!conn || !tableName) return false;
  if (FTS_PRESENT_CACHE.has(tableName)) return FTS_PRESENT_CACHE.get(tableName);

  try {
    // FTS extension creates helper table fts_main_<table>
    const rows = (await conn.query(
      `SELECT 1 AS ok FROM information_schema.tables WHERE table_name='fts_main_${escapeSqlString(tableName)}' LIMIT 1`
    )).toArray();
    const ok = rows.length > 0;
    FTS_PRESENT_CACHE.set(tableName, ok);
    return ok;
  } catch {
    FTS_PRESENT_CACHE.set(tableName, false);
    return false;
  }
}

export async function ensureFtsIndex(conn, tableName) {
  if (!conn || !tableName) return false;

  // PRAGMA expects the table name as a string literal.
  // We assume the main table has columns: id, display_name
  try {
    await conn.query(
      `PRAGMA create_fts_index('${escapeSqlString(tableName)}', 'id', 'display_name');`
    );
    // index creation implies helper tables exist
    FTS_PRESENT_CACHE.set(tableName, true);
    return true;
  } catch {
    // No-op: FTS not available / bad schema / older DuckDB.
    FTS_PRESENT_CACHE.set(tableName, false);
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
    const rows = (await conn.query(`
      SELECT
        id,
        display_name,
        centroid_lon,
        centroid_lat,
        '${escapeSqlString(tableName)}' AS source_table
      FROM "${tableName}"
      WHERE fts_main_${tableName}.match_bm25(id, '${qq}')
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
