import { THEME_FIELDS } from './constants.js';

export function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

export async function getFieldsForTable(conn, tableName, key) {
  const cols = (await conn.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${tableName}'`)).toArray();
  const colNames = new Set(cols.map(c => c.column_name));

  let nameExpr = 'NULL';
  if (colNames.has('names')) nameExpr = 'names.primary';
  else if (colNames.has('name')) nameExpr = 'name';

  const defs = THEME_FIELDS[key] || [];
  const extraFields = defs.filter(f => colNames.has(f.col));

  const selectParts = [
    'id',
    `COALESCE(CAST(${nameExpr} AS VARCHAR), '') as display_name`,
    'geom_type', 'geojson', 'centroid_lon', 'centroid_lat',
    ...extraFields.map((f, i) => `CAST(${f.sql} AS VARCHAR) as _f${i}`),
  ];

  return { selectParts, extraFields };
}
