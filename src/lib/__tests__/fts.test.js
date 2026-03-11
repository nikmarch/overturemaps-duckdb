import { describe, it, expect } from 'vitest';
import { escapeSqlString, buildNameFilterSql } from '../fts.js';

describe('escapeSqlString', () => {
  it('doubles single quotes', () => {
    expect(escapeSqlString("o'brien")).toBe("o''brien");
  });

  it('handles no quotes', () => {
    expect(escapeSqlString('hello')).toBe('hello');
  });

  it('handles multiple quotes', () => {
    expect(escapeSqlString("it's a 'test'")).toBe("it''s a ''test''");
  });

  it('converts non-strings', () => {
    expect(escapeSqlString(123)).toBe('123');
  });
});

describe('buildNameFilterSql', () => {
  it('returns empty for empty query', () => {
    expect(buildNameFilterSql('my_table', '')).toBe('');
    expect(buildNameFilterSql('my_table', '  ')).toBe('');
    expect(buildNameFilterSql('my_table', null)).toBe('');
  });

  it('returns empty for missing table', () => {
    expect(buildNameFilterSql('', 'test')).toBe('');
    expect(buildNameFilterSql(null, 'test')).toBe('');
  });

  it('builds ILIKE clause by default', () => {
    const sql = buildNameFilterSql('places_place', 'cafe');
    expect(sql).toBe("search_name ILIKE '%cafe%'");
  });

  it('builds FTS clause when useFts is true', () => {
    const sql = buildNameFilterSql('places_place', 'cafe', { useFts: true });
    expect(sql).toBe("fts_main_places_place.match_bm25(id, 'cafe')");
  });

  it('escapes quotes in query', () => {
    const sql = buildNameFilterSql('t', "o'b");
    expect(sql).toContain("o''b");
  });
});
