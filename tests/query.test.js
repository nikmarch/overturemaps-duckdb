import { describe, it, expect } from 'vitest';
import { bboxFilter, buildCacheSelect } from '../src/lib/query.js';

describe('bboxFilter', () => {
  it('returns correct WHERE clause from bbox', () => {
    const bbox = { xmin: -118.3, xmax: -118.2, ymin: 34.0, ymax: 34.1 };
    const sql = bboxFilter(bbox);
    expect(sql).toContain('bbox.xmax >= -118.3');
    expect(sql).toContain('bbox.xmin <= -118.2');
    expect(sql).toContain('bbox.ymax >= 34');
    expect(sql).toContain('bbox.ymin <= 34.1');
  });
});

describe('buildCacheSelect', () => {
  it('includes base columns and geometry', () => {
    const cols = new Set(['id', 'geometry']);
    const result = buildCacheSelect(cols, 'unknown/type');
    expect(result).toContain('id');
    expect(result).toContain('geometry');
    expect(result).toContain('geom_type');
    expect(result).toContain('centroid_lon');
    expect(result).toContain('centroid_lat');
  });

  it('uses names.primary when names column exists', () => {
    const cols = new Set(['id', 'geometry', 'names']);
    const result = buildCacheSelect(cols, 'unknown/type');
    expect(result).toContain('names.primary');
    expect(result).toContain('as display_name');
  });

  it('uses name column when no names column', () => {
    const cols = new Set(['id', 'geometry', 'name']);
    const result = buildCacheSelect(cols, 'unknown/type');
    expect(result).toContain('CAST(name AS VARCHAR)');
  });

  it('falls back to empty string when no name columns', () => {
    const cols = new Set(['id', 'geometry']);
    const result = buildCacheSelect(cols, 'unknown/type');
    expect(result).toContain("'' as display_name");
  });

  it('adds _f* columns for matching THEME_FIELDS', () => {
    const cols = new Set(['id', 'geometry', 'names', 'categories', 'confidence']);
    const result = buildCacheSelect(cols, 'places/place');
    expect(result).toContain('as _f0');
    expect(result).toContain('as _f1');
  });
});
