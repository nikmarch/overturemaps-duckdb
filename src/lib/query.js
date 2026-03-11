import { THEME_FIELDS } from './constants.js';

export function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

// Build a minimal SELECT clause for caching parquet data into DuckDB.
// Stores geometry as native GEOMETRY (WKB) — NOT as a GeoJSON string.
// ST_AsGeoJSON() is called only at render time in getFieldsForTable.
export function buildCacheSelect(parquetCols, key) {
  let nameExpr = "''";
  if (parquetCols.has('names')) nameExpr = "COALESCE(CAST(names.primary AS VARCHAR), '')";
  else if (parquetCols.has('name')) nameExpr = "COALESCE(CAST(name AS VARCHAR), '')";

  const defs = THEME_FIELDS[key] || [];
  const extraCols = [];
  const searchableParts = [nameExpr];

  for (let i = 0; i < defs.length; i++) {
    if (parquetCols.has(defs[i].col)) {
      const castExpr = `CAST(${defs[i].sql} AS VARCHAR)`;
      extraCols.push(`${castExpr} as _f${i}`);
      // Include text-like fields in display_name for FTS indexing
      if (isSearchableField(defs[i])) {
        searchableParts.push(`COALESCE(${castExpr}, '')`);
      }
    }
  }

  // Compose display_name from name + searchable fields for richer FTS
  const displayNameExpr = searchableParts.length > 1
    ? `CONCAT_WS(' ', ${searchableParts.join(', ')})`
    : nameExpr;

  return [
    'id',
    `${displayNameExpr} as display_name`,
    'geometry',                                        // native GEOMETRY (WKB)
    'ST_GeometryType(geometry) as geom_type',
    'ST_X(ST_Centroid(geometry)) as centroid_lon',
    'ST_Y(ST_Centroid(geometry)) as centroid_lat',
    ...extraCols,
  ].join(',\n    ');
}

// Fields worth including in FTS display_name.
// Skip numeric-only fields (height, floors, depth, confidence, zoom, speed).
const NUMERIC_LABELS = new Set([
  'Height (m)', 'Floors', 'Min height', 'Elevation', 'Depth',
  'Min depth', 'Max depth', 'Confidence', 'Min zoom', 'Max zoom',
  'Speed limit', 'Population', 'Salt', 'Intermittent',
]);

function isSearchableField(def) {
  return !NUMERIC_LABELS.has(def.label);
}

// Build the SELECT used when reading rows for rendering.
// Converts geometry → GeoJSON string here, not at cache time.
export async function getFieldsForTable(conn, tableName, key) {
  const cols = (await conn.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='${tableName}'`
  )).toArray();
  const colNames = new Set(cols.map(c => c.column_name));

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
    'id', 'display_name',
    'ST_AsGeoJSON(geometry) as geojson',  // convert only at render time
    'geom_type', 'centroid_lon', 'centroid_lat',
    ...extraSelectParts,
  ];

  return { selectParts, extraFields };
}
