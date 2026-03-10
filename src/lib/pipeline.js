// Pipeline SQL compiler
//
// Turns a pipeline node list + options into a single SQL query string.
// Nodes: { id, type: 'source'|'combine', op?, table, key, distance? }
//
// Sources and unions become a UNION ALL CTE ("base").
// Spatial ops (intersect/within) collect IDs from BOTH sides into a
// matched_N CTE, then filter base to only participating rows — so you
// see all geometries involved in the relationship.
// Exclude keeps the NOT EXISTS semantics (hide rows near the filter table).

import { THEME_FIELDS } from './constants.js';
import { escapeSqlString } from './fts.js';

export function compilePipeline(nodes, { search = '', limit = 3000, bbox = null, ftsTables = new Set() } = {}) {
  if (!nodes.length) return '';

  const sources = [];
  const spatialFilters = [];

  for (const node of nodes) {
    if (node.type === 'source' || (node.type === 'combine' && node.op === 'union')) {
      sources.push(node);
    } else if (node.type === 'combine') {
      spatialFilters.push(node);
    }
  }

  if (sources.length === 0) return '';

  // Auto-include spatial filter tables in sources (for intersect/within)
  // so their geometries appear in the output
  for (const sf of spatialFilters) {
    if (sf.op === 'exclude') continue;
    if (!sources.some(s => s.table === sf.table)) {
      sources.push(sf);
    }
  }

  // Find max _f* count across source tables for UNION alignment
  const maxF = sources.reduce((mx, n) => {
    return Math.max(mx, (THEME_FIELDS[n.key] || []).length);
  }, 0);

  // Per-source limit so each table gets a fair share in the UNION
  const perSourceLimit = Math.ceil(limit / sources.length);

  // Build per-source search clause
  const searchQ = search ? escapeSqlString(search) : '';

  // Build UNION CTE
  const unionParts = sources.map(n => {
    const defs = THEME_FIELDS[n.key] || [];
    const fCols = [];
    for (let i = 0; i < maxF; i++) {
      fCols.push(i < defs.length ? `_f${i}` : `NULL AS _f${i}`);
    }
    const cols = [
      'id', 'display_name', 'geometry', 'geom_type',
      'centroid_lon', 'centroid_lat',
      ...fCols,
      `'${n.key}' AS _source`,
    ];
    let where = '';
    if (searchQ) {
      if (ftsTables.has(n.table)) {
        where = `\n  WHERE fts_main_${n.table}.match_bm25(id, '${searchQ}') IS NOT NULL`;
      } else {
        where = `\n  WHERE display_name ILIKE '%${searchQ}%'`;
      }
    }
    return `  (SELECT ${cols.join(', ')}\n  FROM "${n.table}"${where}\n  LIMIT ${perSourceLimit})`;
  });

  // Output SELECT (convert geometry to GeoJSON here, not in CTE)
  const outCols = [
    'id', 'display_name',
    'ST_AsGeoJSON(geometry) AS geojson',
    'geom_type', 'centroid_lon', 'centroid_lat',
  ];
  for (let i = 0; i < maxF; i++) outCols.push(`_f${i}`);
  outCols.push('_source');

  // ── Build CTEs and WHERE clauses ──

  const ctes = [`base AS (\n${unionParts.join('\n  UNION ALL\n')}\n)`];
  const wheres = [];

  // Bbox
  if (bbox) {
    wheres.push(
      `centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}` +
      `\n    AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}`
    );
  }

  // Spatial filters
  spatialFilters.forEach((sf, i) => {
    const distDeg = ((sf.distance || 250) / 111320).toFixed(6);
    const pre =
      `base.id != b.id\n` +
      `      AND ABS(base.centroid_lon - b.centroid_lon) < 0.2\n` +
      `      AND ABS(base.centroid_lat - b.centroid_lat) < 0.2`;

    if (sf.op === 'intersect' || sf.op === 'within') {
      const spatialCond = sf.op === 'intersect'
        ? 'ST_Intersects(base.geometry, b.geometry)'
        : `ST_Distance(base.geometry, b.geometry) < ${distDeg}`;

      // Collect IDs from both sides of the relationship
      ctes.push(
        `matched_${i} AS (\n` +
        `  SELECT base.id FROM base\n` +
        `  WHERE EXISTS (\n` +
        `    SELECT 1 FROM "${sf.table}" b\n` +
        `    WHERE ${pre}\n` +
        `      AND ${spatialCond}\n` +
        `  )\n` +
        `  UNION\n` +
        `  SELECT b.id FROM "${sf.table}" b\n` +
        `  WHERE EXISTS (\n` +
        `    SELECT 1 FROM base\n` +
        `    WHERE ${pre}\n` +
        `      AND ${spatialCond}\n` +
        `  )\n` +
        `)`
      );
      wheres.push(`id IN (SELECT id FROM matched_${i})`);

    } else if (sf.op === 'exclude') {
      // Exclude: hide base rows near the filter table
      wheres.push(
        `NOT EXISTS (\n    SELECT 1 FROM "${sf.table}" b\n` +
        `    WHERE ${pre}\n      AND ST_Distance(base.geometry, b.geometry) < ${distDeg}\n  )`
      );
    }
  });

  // Text search is pushed into each source subquery (see UNION above)
  // so that per-table FTS indexes are used when available.

  // ── Assemble ──

  let sql = `WITH ${ctes.join(',\n')}`;
  sql += `\nSELECT ${outCols.join(', ')}\nFROM base`;

  if (wheres.length) {
    sql += `\nWHERE ${wheres.join('\n  AND ')}`;
  }

  sql += `\nLIMIT ${limit}`;

  return sql;
}
