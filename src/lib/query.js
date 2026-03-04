import { THEME_FIELDS } from './constants.js';

export function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

// Build a minimal SELECT clause for caching parquet data into DuckDB.
// Computes display_name + spatial columns + pre-cast extra theme fields.
// parquetCols: Set of column names from the parquet schema.
// Extra theme fields are stored as _f{i} using the THEME_FIELDS definition index
// so getFieldsForTable can reconstruct the mapping reliably.
export function buildCacheSelect(parquetCols, key) {
  let nameExpr = "''";
  if (parquetCols.has('names')) nameExpr = "COALESCE(CAST(names.primary AS VARCHAR), '')";
  else if (parquetCols.has('name')) nameExpr = "COALESCE(CAST(name AS VARCHAR), '')";

  const defs = THEME_FIELDS[key] || [];
  const extraCols = [];
  for (let i = 0; i < defs.length; i++) {
    if (parquetCols.has(defs[i].col)) {
      extraCols.push(`CAST(${defs[i].sql} AS VARCHAR) as _f${i}`);
    }
  }

  return [
    'id',
    `${nameExpr} as display_name`,
    'ST_GeometryType(geometry) as geom_type',
    'ST_AsGeoJSON(geometry) as geojson',
    'ST_X(ST_Centroid(geometry)) as centroid_lon',
    'ST_Y(ST_Centroid(geometry)) as centroid_lat',
    ...extraCols,
  ].join(',\n    ');
}

export async function getFieldsForTable(conn, tableName, key) {
  const cols = (await conn.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${tableName}'`)).toArray();
  const colNames = new Set(cols.map(c => c.column_name));

  // display_name is now stored directly; map _f{originalIndex} back to extraFields
  const defs = THEME_FIELDS[key] || [];
  const extraFields = [];
  const extraSelectParts = [];
  for (let i = 0; i < defs.length; i++) {
    if (colNames.has(`_f${i}`)) {
      extraSelectParts.push(`_f${i} as _f${extraFields.length}`);
      extraFields.push(defs[i]);
    }
  }

  const selectParts = [
    'id', 'display_name', 'geom_type', 'geojson', 'centroid_lon', 'centroid_lat',
    ...extraSelectParts,
  ];

  return { selectParts, extraFields };
}
