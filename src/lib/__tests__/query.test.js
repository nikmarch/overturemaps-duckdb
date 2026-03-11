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
  it('uses names.primary when names column exists and no extra fields', () => {
    const cols = new Set(['id', 'names', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain("names.primary");
    expect(sql).toContain('as display_name');
  });

  it('falls back to name column', () => {
    const cols = new Set(['id', 'name', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain("CAST(name AS VARCHAR)");
    expect(sql).toContain('as display_name');
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

  // ── Enriched display_name for FTS ──

  it('composes display_name with searchable fields for addresses', () => {
    const cols = new Set(['id', 'geometry', 'number', 'street', 'postcode', 'country']);
    const sql = buildCacheSelect(cols, 'addresses/address');
    expect(sql).toContain('CONCAT_WS');
    expect(sql).toContain('as display_name');
    // Address fields should be in the composed name
    expect(sql).toMatch(/CAST\(number AS VARCHAR\)/);
    expect(sql).toMatch(/CAST\(street AS VARCHAR\)/);
    expect(sql).toMatch(/CAST\(postcode AS VARCHAR\)/);
    expect(sql).toMatch(/CAST\(country AS VARCHAR\)/);
  });

  it('composes display_name with category and brand for places', () => {
    const cols = new Set(['id', 'names', 'geometry', 'categories', 'brand', 'addresses', 'websites', 'phones', 'confidence']);
    const sql = buildCacheSelect(cols, 'places/place');
    expect(sql).toContain('CONCAT_WS');
    // Category and brand are searchable, confidence is not
    expect(sql).toMatch(/categories\.primary/);
    expect(sql).toMatch(/brand\.names\.primary/);
  });

  it('skips numeric fields from display_name composition', () => {
    const cols = new Set(['id', 'names', 'geometry', 'height', 'num_floors', 'subtype', 'class']);
    const sql = buildCacheSelect(cols, 'buildings/building');
    expect(sql).toContain('CONCAT_WS');
    // Subtype and class are searchable
    expect(sql).toMatch(/CAST\(subtype AS VARCHAR\)/);
    expect(sql).toMatch(/CAST\(class AS VARCHAR\)/);
    // The CONCAT_WS should not include height or num_floors
    const concatMatch = sql.match(/CONCAT_WS\([^)]+\)/);
    expect(concatMatch[0]).not.toContain('height');
    expect(concatMatch[0]).not.toContain('num_floors');
  });
});
