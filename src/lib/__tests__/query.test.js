import { describe, it, expect } from 'vitest';
import { bboxFilter, buildCacheSelect } from '../query.js';

describe('bboxFilter', () => {
  it('builds correct WHERE clause', () => {
    const sql = bboxFilter({ xmin: -118.3, xmax: -118.2, ymin: 34.0, ymax: 34.1 });
    expect(sql).toBe(
      'bbox.xmax >= -118.3 AND bbox.xmin <= -118.2 AND bbox.ymax >= 34 AND bbox.ymin <= 34.1'
    );
  });
});

describe('buildCacheSelect', () => {
  it('uses names.primary when names column exists', () => {
    const cols = new Set(['id', 'names', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain("COALESCE(CAST(names.primary AS VARCHAR), '') as display_name");
  });

  it('falls back to name column', () => {
    const cols = new Set(['id', 'name', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain("COALESCE(CAST(name AS VARCHAR), '') as display_name");
  });

  it('uses empty string when no name column', () => {
    const cols = new Set(['id', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain("'' as display_name");
  });

  it('includes theme-specific fields', () => {
    const cols = new Set(['id', 'names', 'geometry', 'categories', 'confidence']);
    const sql = buildCacheSelect(cols, 'places/place');
    expect(sql).toContain('_f0');
    expect(sql).toContain('_f1');
    expect(sql).toContain('categories.primary');
  });

  it('always includes geometry and centroid columns', () => {
    const cols = new Set(['id', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain('geometry');
    expect(sql).toContain('ST_GeometryType(geometry) as geom_type');
    expect(sql).toContain('ST_X(ST_Centroid(geometry)) as centroid_lon');
    expect(sql).toContain('ST_Y(ST_Centroid(geometry)) as centroid_lat');
  });
});
