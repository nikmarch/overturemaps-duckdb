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

  // ── Union-only: per-source limits ──

  it('applies per-source limit for union-only pipeline', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'union', table: 'buildings_building', key: 'buildings/building' }),
    ], { limit: 1000 });
    // 1000 / 2 = 500 per source
    expect(sql).toMatch(/FROM "places_place"\n\s*LIMIT 500/);
    expect(sql).toMatch(/FROM "buildings_building"\n\s*LIMIT 500/);
    expect(sql).toMatch(/\nLIMIT 1000$/);
  });

  // ── Spatial: NO per-source limits in base CTE ──

  it('does NOT per-source limit when spatial filters exist', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'intersect', table: 'buildings_building', key: 'buildings/building' }),
    ], { limit: 1000 });
    // Source subqueries inside base CTE should have no LIMIT
    const baseCte = sql.split('matched_0')[0];
    const limitMatches = baseCte.match(/LIMIT \d+/g) || [];
    // No per-source limits in the base CTE
    expect(limitMatches).toHaveLength(0);
    // Only the final LIMIT exists
    expect(sql).toMatch(/\nLIMIT 1000$/);
  });

  it('spatial filter runs against full data, not pre-limited base', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'within', table: 'buildings_building', key: 'buildings/building', distance: 300 }),
    ]);
    // matched_0 references base (which has no per-source limit)
    expect(sql).toContain('SELECT base.id FROM base');
    // The base CTE subqueries should NOT have LIMIT
    const basePart = sql.match(/base AS \(([\s\S]*?)\)/)?.[1] || '';
    expect(basePart).not.toMatch(/LIMIT \d+/);
  });

  // ── Bbox ──

  it('applies bbox filter', () => {
    const sql = compilePipeline([node()], {
      bbox: { xmin: -118.3, xmax: -118.2, ymin: 34.0, ymax: 34.1 },
    });
    expect(sql).toContain('centroid_lon >= -118.3');
    expect(sql).toContain('centroid_lon <= -118.2');
    expect(sql).toContain('centroid_lat >= 34');
    expect(sql).toContain('centroid_lat <= 34.1');
  });

  it('no bbox WHERE clause when bbox is null', () => {
    const sql = compilePipeline([node()], { bbox: null });
    expect(sql).not.toContain('centroid_lon >=');
  });

  // ── Search ──

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

  it('no search clause when search is empty', () => {
    const sql = compilePipeline([node()], { search: '' });
    expect(sql).not.toContain('ILIKE');
    expect(sql).not.toContain('match_bm25');
    expect(sql).not.toContain('_score');
    expect(sql).not.toContain('ORDER BY');
  });

  it('includes _score column and ORDER BY when searching with FTS', () => {
    const sql = compilePipeline([node()], {
      search: 'cafe',
      ftsTables: new Set(['places_place']),
    });
    expect(sql).toContain('_score');
    expect(sql).toContain('ORDER BY _score DESC');
  });

  it('includes _score as NULL for non-FTS search', () => {
    const sql = compilePipeline([node()], { search: 'cafe' });
    expect(sql).toContain('NULL AS _score');
    expect(sql).toContain('ORDER BY _score DESC');
  });

  // ── Spatial operations ──

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

  it('exclude also has no per-source limit (spatial pipeline)', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'exclude', table: 'buildings_building', key: 'buildings/building' }),
    ], { limit: 1000 });
    const basePart = sql.match(/base AS \(([\s\S]*?)\)\n/)?.[1] || '';
    expect(basePart).not.toMatch(/LIMIT \d+/);
  });

  it('prevents self-match in spatial filters', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'within', table: 'buildings_building', key: 'buildings/building' }),
    ]);
    expect(sql).toContain('base.id != b.id');
  });

  it('collects IDs from both sides of spatial relationship', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'intersect', table: 'buildings_building', key: 'buildings/building' }),
    ]);
    // Source side
    expect(sql).toContain('SELECT base.id FROM base');
    // Filter table side
    expect(sql).toContain('SELECT b.id FROM "buildings_building" b');
  });

  // ── Column alignment ──

  it('aligns columns across sources with different field counts', () => {
    const sql = compilePipeline([
      node(),
      node({ id: 'p2', type: 'combine', op: 'union', table: 'foo_bar', key: 'foo/bar' }),
    ]);
    expect(sql).toMatch(/NULL AS _f\d/);
  });
});
