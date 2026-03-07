import { describe, it, expect } from 'vitest';
import { buildShowQuery, buildQuery, buildMatchedBQuery } from '../src/lib/analysisQueries.js';

describe('buildShowQuery', () => {
  it('returns empty string for no tables', () => {
    expect(buildShowQuery([], 100)).toBe('');
  });

  it('produces UNION ALL for multiple tables', () => {
    const tables = [
      { key: 'places/place', table: 'places_place' },
      { key: 'buildings/building', table: 'buildings_building' },
    ];
    const sql = buildShowQuery(tables, 500);
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('LIMIT 500');
    expect(sql).toContain('FROM "places_place"');
    expect(sql).toContain('FROM "buildings_building"');
  });

  it('aligns columns with NULL padding for mismatched _f counts', () => {
    const tables = [
      { key: 'places/place', table: 'places_place' },           // 4 THEME_FIELDS
      { key: 'buildings/building_part', table: 'buildings_building_part' }, // 2 THEME_FIELDS
    ];
    const sql = buildShowQuery(tables, 100);
    // building_part has only 2 fields, so _f2 and _f3 should be NULL-padded
    expect(sql).toContain('NULL AS _f2');
    expect(sql).toContain('NULL AS _f3');
  });

  it('includes _source column', () => {
    const tables = [{ key: 'places/place', table: 'places_place' }];
    const sql = buildShowQuery(tables, 100);
    expect(sql).toContain("'places/place' AS _source");
  });
});

describe('buildQuery', () => {
  it('builds intersect SQL with JOIN', () => {
    const sql = buildQuery('intersect', 'places_place', 'buildings_building', 100, 1000);
    expect(sql).toContain('JOIN "buildings_building"');
    expect(sql).toContain('ST_Intersects');
    expect(sql).toContain('LIMIT 1000');
  });

  it('builds within SQL with EXISTS and distance', () => {
    const sql = buildQuery('within', 'places_place', 'buildings_building', 200, 500);
    expect(sql).toContain('WHERE EXISTS');
    expect(sql).toContain('ST_Distance');
    expect(sql).toContain('LIMIT 500');
  });

  it('builds exclude SQL with NOT EXISTS', () => {
    const sql = buildQuery('exclude', 'places_place', 'buildings_building', 100);
    expect(sql).toContain('WHERE NOT EXISTS');
    expect(sql).toContain('ST_Distance');
  });

  it('returns empty for unknown mode', () => {
    expect(buildQuery('unknown', 'a', 'b', 100)).toBe('');
  });
});

describe('buildMatchedBQuery', () => {
  it('builds intersect query selecting b.*', () => {
    const sql = buildMatchedBQuery('intersect', 'a', 'b', 100, 500);
    expect(sql).toContain('SELECT DISTINCT b.*');
    expect(sql).toContain('ST_Intersects');
  });

  it('builds within query selecting b.*', () => {
    const sql = buildMatchedBQuery('within', 'a', 'b', 100);
    expect(sql).toContain('SELECT DISTINCT b.*');
    expect(sql).toContain('ST_Distance');
  });

  it('returns null for exclude and other modes', () => {
    expect(buildMatchedBQuery('exclude', 'a', 'b', 100)).toBeNull();
    expect(buildMatchedBQuery('show', 'a', 'b', 100)).toBeNull();
  });
});
