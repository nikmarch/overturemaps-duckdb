import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DuckDB connection
const mockRows = [];
const mockConn = {
  query: vi.fn(async (sql) => {
    if (sql.includes('CREATE TABLE')) return;
    if (sql.includes('DELETE FROM')) { mockRows.length = 0; return; }
    if (sql.includes('INSERT OR REPLACE')) {
      const keyMatch = sql.match(/VALUES \('(\w+)'/);
      const valMatch = sql.match(/', '(.+?)'\)/s);
      if (keyMatch && valMatch) {
        const key = keyMatch[1];
        const val = valMatch[1].replace(/''/g, "'");
        const existing = mockRows.findIndex(r => r.key === key);
        if (existing >= 0) mockRows[existing] = { key, val };
        else mockRows.push({ key, val });
      }
      return;
    }
    if (sql.includes('SELECT')) {
      const keyMatch = sql.match(/key = '(\w+)'/);
      const filtered = keyMatch
        ? mockRows.filter(r => r.key === keyMatch[1])
        : [...mockRows];
      return { toArray: () => filtered };
    }
  }),
};

vi.mock('../duckdb.js', () => ({
  getConn: () => mockConn,
}));

// Mock store
let storeState = {};
vi.mock('../store.js', () => {
  const useStore = {
    getState: () => storeState,
    setState: (patch) => {
      storeState = { ...storeState, ...(typeof patch === 'function' ? patch(storeState) : patch) };
    },
    subscribe: vi.fn(() => () => {}),
  };
  return { useStore };
});

const { initSessionTable, restoreSession, clearSession } = await import('../sessionState.js');

describe('sessionState', () => {
  beforeEach(() => {
    mockRows.length = 0;
    mockConn.query.mockClear();
    storeState = {
      pipeline: [],
      pipelineSearch: '',
      pipelineLimit: 3000,
      pipelineBbox: null,
      sqlOverride: null,
      loadedTables: [],
    };
  });

  it('initSessionTable creates the _session table', async () => {
    await initSessionTable();
    expect(mockConn.query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS "_session"')
    );
  });

  it('restoreSession returns false when table is empty', async () => {
    await initSessionTable();
    const restored = await restoreSession();
    expect(restored).toBe(false);
  });

  it('restoreSession hydrates Zustand from DuckDB rows', async () => {
    await initSessionTable();
    // Simulate persisted state
    mockRows.push(
      { key: 'pipeline', val: JSON.stringify([{ id: 'p1', type: 'source', table: 'places_place', key: 'places/place' }]) },
      { key: 'pipelineSearch', val: JSON.stringify('cafe') },
      { key: 'pipelineLimit', val: JSON.stringify(5000) },
      { key: 'pipelineBbox', val: JSON.stringify({ xmin: -118, xmax: -117, ymin: 34, ymax: 35 }) },
    );

    const restored = await restoreSession();
    expect(restored).toBe(true);
    expect(storeState.pipeline).toHaveLength(1);
    expect(storeState.pipeline[0].table).toBe('places_place');
    expect(storeState.pipelineSearch).toBe('cafe');
    expect(storeState.pipelineLimit).toBe(5000);
    expect(storeState.pipelineBbox).toEqual({ xmin: -118, xmax: -117, ymin: 34, ymax: 35 });
  });

  it('restoreSession ignores unknown keys', async () => {
    await initSessionTable();
    mockRows.push({ key: 'unknownKey', val: JSON.stringify('foo') });
    const restored = await restoreSession();
    expect(restored).toBe(false);
    expect(storeState.unknownKey).toBeUndefined();
  });

  it('clearSession empties the table', async () => {
    await initSessionTable();
    mockRows.push({ key: 'pipeline', val: '[]' });
    await clearSession();
    expect(mockRows).toHaveLength(0);
  });

  it('restoreSession skips corrupt JSON gracefully', async () => {
    await initSessionTable();
    mockRows.push(
      { key: 'pipeline', val: 'not valid json{{{' },
      { key: 'pipelineSearch', val: JSON.stringify('ok') },
    );
    const restored = await restoreSession();
    expect(restored).toBe(true);
    expect(storeState.pipelineSearch).toBe('ok');
    // pipeline should remain default (corrupt entry skipped)
    expect(storeState.pipeline).toEqual([]);
  });
});
