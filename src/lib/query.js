import { THEME_FIELDS } from './constants.js';

export function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

// Themes whose parquet files include a `names` struct column
const HAS_NAMES = new Set([
  'places/place', 'buildings/building', 'buildings/building_part',
  'transportation/segment', 'base/infrastructure', 'base/land',
  'base/land_use', 'base/water', 'divisions/division',
  'divisions/division_area',
]);

export function splitBbox(bbox, cols = 2, rows = 2) {
  const dx = (bbox.xmax - bbox.xmin) / cols;
  const dy = (bbox.ymax - bbox.ymin) / rows;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        xmin: bbox.xmin + c * dx,
        xmax: bbox.xmin + (c + 1) * dx,
        ymin: bbox.ymin + r * dy,
        ymax: bbox.ymin + (r + 1) * dy,
      });
    }
  }
  return tiles;
}

export function buildQueryParams(key, files, bbox, limit) {
  const defs = THEME_FIELDS[key] || [];
  const extraFields = defs;

  const displayNameCol = HAS_NAMES.has(key)
    ? "COALESCE(CAST(names.primary AS VARCHAR), '') as display_name"
    : "'' as display_name";

  const columns = [
    'id',
    displayNameCol,
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
