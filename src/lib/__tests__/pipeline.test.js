import { describe, it, expect } from 'vitest';
import { compilePipeline } from '../pipeline.js';

const node = (overrides = {}) => ({
  id: 'p1',
  type: 'source',
  table: 'places_place',
  key: 'places/place',
  ...overrides,
});

describe('compilePipeline', () => {
  it('returns empty string for empty nodes', () => {
    expect(compilePipeline([])).toBe('');
  });

  it('returns empty string when no sources exist', () => {
    // A combine with no prior source shouldn't produce SQL
    expect(compilePipeline([{ id: 'p1', type: 'combine', op: 'intersect', table: 'x', key: 'x/y' }])).toBe('');
  });

  it('compiles a single source', () => {
    const sql = compilePipeline([node()]);
    expect(sql).toContain('FROM "places_place"');
    expect(sql).toContain("'places/place' AS _source");
    expect(sql).toContain('LIMIT 3000');
    expect(sql).toContain('ST_AsGeoJSON(geometry) AS geojson');
  });

  it('compiles two sources with UNION ALL', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'union', table: 'buildings_building', key: 'buildings/building' }),
    ]);
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('FROM "places_place"');
    expect(sql).toContain('FROM "buildings_building"');
  });

  it('applies per-source limit to balance UNION', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'union', table: 'buildings_building', key: 'buildings/building' }),
    ], { limit: 1000 });
    // 1000 / 2 = 500 per source
    expect(sql).toMatch(/FROM "places_place"\n\s*LIMIT 500/);
    expect(sql).toMatch(/FROM "buildings_building"\n\s*LIMIT 500/);
    // Outer limit
    expect(sql).toMatch(/\nLIMIT 1000$/);
  });

  it('applies bbox filter', () => {
    const sql = compilePipeline([node()], {
      bbox: { xmin: -118.3, xmax: -118.2, ymin: 34.0, ymax: 34.1 },
    });
    expect(sql).toContain('centroid_lon >= -118.3');
    expect(sql).toContain('centroid_lon <= -118.2');
    expect(sql).toContain('centroid_lat >= 34');
    expect(sql).toContain('centroid_lat <= 34.1');
  });

  it('uses ILIKE search when no FTS tables provided', () => {
    const sql = compilePipeline([node()], { search: 'cafe' });
    expect(sql).toContain("ILIKE '%cafe%'");
    expect(sql).toContain('FROM "places_place"\n  WHERE');
  });

  it('uses match_bm25 when table has FTS', () => {
    const sql = compilePipeline([node()], {
      search: 'cafe',
      ftsTables: new Set(['places_place']),
    });
    expect(sql).toContain('fts_main_places_place.match_bm25');
    expect(sql).not.toContain('ILIKE');
  });

  it('mixes FTS and ILIKE across sources', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'union', table: 'buildings_building', key: 'buildings/building' }),
    ], {
      search: 'tower',
      ftsTables: new Set(['places_place']),
    });
    expect(sql).toContain('fts_main_places_place.match_bm25');
    expect(sql).toContain("ILIKE '%tower%'");
  });

  it('escapes single quotes in search', () => {
    const sql = compilePipeline([node()], { search: "o'brien" });
    expect(sql).toContain("o''brien");
    expect(sql).not.toContain("o'brien");
  });

  it('compiles intersect spatial filter', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'intersect', table: 'buildings_building', key: 'buildings/building' }),
    ]);
    expect(sql).toContain('matched_0');
    expect(sql).toContain('ST_Intersects');
    expect(sql).toContain('id IN (SELECT id FROM matched_0)');
    // Both tables should appear in base (auto-include for intersect)
    expect(sql).toContain('FROM "buildings_building"');
  });

  it('compiles within spatial filter with distance', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'within', table: 'buildings_building', key: 'buildings/building', distance: 500 }),
    ]);
    expect(sql).toContain('ST_Distance');
    // 500m / 111320 ≈ 0.004492
    expect(sql).toContain('0.004492');
  });

  it('compiles exclude spatial filter', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'exclude', table: 'buildings_building', key: 'buildings/building' }),
    ]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('ST_Distance');
    // Exclude should NOT auto-include the filter table in sources
    expect(sql).not.toContain("'buildings/building' AS _source");
  });

  it('prevents self-match in spatial filters', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'within', table: 'buildings_building', key: 'buildings/building' }),
    ]);
    expect(sql).toContain('base.id != b.id');
  });

  it('aligns columns across sources with different field counts', () => {
    // places/place has THEME_FIELDS, some other key may not
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'union', table: 'foo_bar', key: 'foo/bar' }),
    ]);
    // foo/bar has no THEME_FIELDS, so it gets NULL AS _f0, _f1, etc.
    expect(sql).toMatch(/NULL AS _f\d/);
  });

  it('no search clause when search is empty', () => {
    const sql = compilePipeline([node()], { search: '' });
    expect(sql).not.toContain('ILIKE');
    expect(sql).not.toContain('match_bm25');
    expect(sql).not.toContain('WHERE');
  });

  it('no bbox WHERE clause when bbox is null', () => {
    const sql = compilePipeline([node()], { bbox: null });
    // centroid_lon appears in SELECT columns, but not in a WHERE filter
    expect(sql).not.toContain('centroid_lon >=');
  });
});
