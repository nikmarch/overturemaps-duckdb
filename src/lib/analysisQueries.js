import { THEME_FIELDS } from './constants.js';

export const BASE_COLS = ['id', 'display_name', 'geom_type', 'centroid_lon', 'centroid_lat'];

export function buildShowQuery(tables, limit) {
  if (tables.length === 0) return '';

  // Find max _f* index across all tables so UNION ALL columns align
  const maxF = tables.reduce((mx, t) => {
    const defs = THEME_FIELDS[t.key] || [];
    return Math.max(mx, defs.length);
  }, 0);

  const unions = tables.map(t => {
    const defs = THEME_FIELDS[t.key] || [];
    const fCols = [];
    for (let i = 0; i < maxF; i++) {
      fCols.push(i < defs.length ? `_f${i}` : `NULL AS _f${i}`);
    }
    const cols = [...BASE_COLS, 'ST_AsGeoJSON(geometry) AS geojson', ...fCols, `'${t.key}' AS _source`];
    return `SELECT ${cols.join(', ')}\nFROM "${t.table}"`;
  });
  return unions.join('\nUNION ALL\n') + `\nLIMIT ${limit}`;
}

export function buildQuery(mode, tableA, tableB, distance, limit = 2000) {
  const cols    = `a.*, ST_AsGeoJSON(a.geometry) as geojson`;
  const distDeg = (distance / 111320).toFixed(6);
  const preFlt  = `ABS(a.centroid_lon - b.centroid_lon) < 0.2\n  AND ABS(a.centroid_lat - b.centroid_lat) < 0.2`;

  switch (mode) {
    case 'intersect':
      return `SELECT ${cols}\nFROM "${tableA}" a\nJOIN "${tableB}" b\n  ON ${preFlt}\n  AND ST_Intersects(a.geometry, b.geometry)\nLIMIT ${limit}`;
    case 'within':
      return `SELECT ${cols}\nFROM "${tableA}" a\nWHERE EXISTS (\n  SELECT 1 FROM "${tableB}" b\n  WHERE ${preFlt}\n    AND ST_Distance(a.geometry, b.geometry) < ${distDeg}\n)\nLIMIT ${limit}`;
    case 'exclude':
      return `SELECT ${cols}\nFROM "${tableA}" a\nWHERE NOT EXISTS (\n  SELECT 1 FROM "${tableB}" b\n  WHERE ${preFlt}\n    AND ST_Distance(a.geometry, b.geometry) < ${distDeg}\n)\nLIMIT ${limit}`;
    default:
      return '';
  }
}

export function buildMatchedBQuery(mode, tableA, tableB, distance, limit = 2000) {
  const bCols   = `b.*, ST_AsGeoJSON(b.geometry) as geojson`;
  const distDeg = (distance / 111320).toFixed(6);
  const preFlt  = `ABS(a.centroid_lon - b.centroid_lon) < 0.2\n  AND ABS(a.centroid_lat - b.centroid_lat) < 0.2`;

  switch (mode) {
    case 'intersect':
      return `SELECT DISTINCT ${bCols}\nFROM "${tableA}" a\nJOIN "${tableB}" b\n  ON ${preFlt}\n  AND ST_Intersects(a.geometry, b.geometry)\nLIMIT ${limit}`;
    case 'within':
      return `SELECT DISTINCT ${bCols}\nFROM "${tableA}" a\nJOIN "${tableB}" b\n  ON ${preFlt}\n  AND ST_Distance(a.geometry, b.geometry) < ${distDeg}\nLIMIT ${limit}`;
    default:
      return null;
  }
}
