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
  it('uses names.primary for display_name when names column exists', () => {
    const cols = new Set(['id', 'names', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain("names.primary");
    expect(sql).toContain('as display_name');
  });

  it('falls back to name column for display_name', () => {
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

  it('has separate display_name and search_name columns', () => {
    const cols = new Set(['id', 'names', 'geometry']);
    const sql = buildCacheSelect(cols, 'unknown/type');
    expect(sql).toContain('as display_name');
    expect(sql).toContain('as search_name');
  });

  // ── search_name composition for FTS ──

  it('composes search_name with searchable fields for addresses', () => {
    const cols = new Set(['id', 'geometry', 'number', 'street', 'postcode', 'country']);
    const sql = buildCacheSelect(cols, 'addresses/address');
    // search_name should use CONCAT_WS
    const searchMatch = sql.match(/CONCAT_WS\(.+?\) as search_name/s)?.[0] || '';
    expect(searchMatch).toContain('CONCAT_WS');
    expect(searchMatch).toMatch(/CAST\(number AS VARCHAR\)/);
    expect(searchMatch).toMatch(/CAST\(street AS VARCHAR\)/);
    expect(searchMatch).toMatch(/CAST\(postcode AS VARCHAR\)/);
    expect(searchMatch).toMatch(/CAST\(country AS VARCHAR\)/);
    // display_name should be plain name (empty for addresses with no names col)
    expect(sql).toMatch(/''\s+as display_name/);
  });

  it('composes search_name with category and brand for places, excludes address/website/phone', () => {
    const cols = new Set(['id', 'names', 'geometry', 'categories', 'brand', 'addresses', 'websites', 'phones', 'confidence']);
    const sql = buildCacheSelect(cols, 'places/place');
    // search_name has CONCAT_WS with category and brand
    const searchMatch = sql.match(/CONCAT_WS\(.+?\) as search_name/s)?.[0] || '';
    expect(searchMatch).toMatch(/categories\.primary/);
    expect(searchMatch).toMatch(/brand\.names\.primary/);
    // Address, website, phone excluded from search_name
    expect(searchMatch).not.toContain('addresses');
    expect(searchMatch).not.toContain('websites');
    expect(searchMatch).not.toContain('phones');
    // display_name is just the name
    expect(sql).toMatch(/names\.primary.+?as display_name/s);
  });

  it('skips numeric fields from search_name composition', () => {
    const cols = new Set(['id', 'names', 'geometry', 'height', 'num_floors', 'subtype', 'class']);
    const sql = buildCacheSelect(cols, 'buildings/building');
    // search_name should include subtype and class
    const searchMatch = sql.match(/CONCAT_WS\(.+?\) as search_name/s)?.[0] || '';
    expect(searchMatch).toMatch(/CAST\(subtype AS VARCHAR\)/);
    expect(searchMatch).toMatch(/CAST\(class AS VARCHAR\)/);
    // search_name should not include height or num_floors
    expect(searchMatch).not.toContain('height');
    expect(searchMatch).not.toContain('num_floors');
  });

  it('display_name is clean name without extra fields', () => {
    const cols = new Set(['id', 'names', 'geometry', 'categories', 'confidence']);
    const sql = buildCacheSelect(cols, 'places/place');
    // display_name should be just the name expression, not CONCAT_WS
    const displayMatch = sql.match(/(.+?) as display_name/)?.[1]?.trim() || '';
    expect(displayMatch).not.toContain('CONCAT_WS');
    expect(displayMatch).toContain('names.primary');
  });
});
