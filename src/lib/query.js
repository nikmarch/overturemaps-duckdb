import { THEME_FIELDS } from './constants.js';
import { S3_HOST } from './duckdb.js';

export function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

export function buildSelectSql(key, fileUrls, bbox, limit) {
  const defs = THEME_FIELDS[key] || [];

  // We include all theme-specific fields unconditionally since we know
  // the Overture schema. If a column doesn't exist, DuckDB will error
  // and we can handle it gracefully.
  const extraFields = defs;

  const selectParts = [
    'id',
    "COALESCE(CAST(names.primary AS VARCHAR), '') as display_name",
    'hex(geometry) as geometry_wkb',
    'bbox.xmin as bbox_xmin',
    'bbox.xmax as bbox_xmax',
    'bbox.ymin as bbox_ymin',
    'bbox.ymax as bbox_ymax',
    '(bbox.xmin + bbox.xmax) / 2 as centroid_lon',
    '(bbox.ymin + bbox.ymax) / 2 as centroid_lat',
    ...extraFields.map((f, i) => `CAST(${f.sql} AS VARCHAR) as _f${i}`),
  ];

  const fileList = fileUrls.map(u => `'${u}'`).join(',');

  const sql = `SELECT ${selectParts.join(', ')}
FROM read_parquet([${fileList}], hive_partitioning=false)
WHERE ${bboxFilter(bbox)}
LIMIT ${limit}`;

  return { sql, extraFields };
}
