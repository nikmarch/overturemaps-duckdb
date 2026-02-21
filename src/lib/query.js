import { THEME_FIELDS } from './constants.js';

export function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

export function buildQueryParams(key, files, bbox, limit) {
  const defs = THEME_FIELDS[key] || [];
  const extraFields = defs;

  const columns = [
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

  return {
    params: { files, columns, where: bboxFilter(bbox), limit },
    extraFields,
  };
}
