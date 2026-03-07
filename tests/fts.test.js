import { describe, it, expect } from 'vitest';
import { buildNameFilterSql } from '../src/lib/fts.js';

describe('buildNameFilterSql', () => {
  it('returns empty string for empty query', () => {
    expect(buildNameFilterSql('places_place', '')).toBe('');
    expect(buildNameFilterSql('places_place', '   ')).toBe('');
  });

  it('builds ILIKE clause by default', () => {
    const sql = buildNameFilterSql('places_place', 'coffee');
    expect(sql).toContain("display_name ILIKE");
    expect(sql).toContain('%coffee%');
  });

  it('escapes single quotes', () => {
    const sql = buildNameFilterSql('places_place', "o'reilly");
    expect(sql).toContain("%o''reilly%");
  });

  it('builds FTS match when useFts=true', () => {
    const sql = buildNameFilterSql('places_place', 'cafe', { useFts: true });
    expect(sql).toContain('fts_main_places_place.match');
    expect(sql).toContain("'cafe'");
  });
});
