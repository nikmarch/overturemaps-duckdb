import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock store for urlState module
vi.mock('../store.js', () => {
  let state = {};
  const useStore = {
    getState: () => state,
    setState: (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; },
    subscribe: () => () => {},
  };
  useStore._setState = (s) => { state = s; };
  return { useStore };
});

describe('urlState', () => {
  let urlState;
  let mockStore;

  beforeEach(async () => {
    globalThis.location = { hash: '', href: '' };
    globalThis.history = { replaceState: vi.fn() };

    mockStore = (await import('../store.js')).useStore;
    urlState = await import('../urlState.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const hasCompression = typeof globalThis.CompressionStream !== 'undefined';

  describe('encodeStateToUrl / decodeStateFromUrl round-trip', () => {
    it.skipIf(!hasCompression)('round-trips sv with sql, bbox, and theme keys', async () => {
      mockStore._setState({
        pipeline: [
          { id: 'p1', type: 'source', table: 'places_place', key: 'places/place' },
          { id: 'p2', type: 'combine', op: 'union', table: 'buildings_building', key: 'buildings/building' },
        ],
        pipelineSearch: 'cafe',
        pipelineLimit: 5000,
        pipelineBbox: { xmin: -118.3, xmax: -118.2, ymin: 34.0, ymax: 34.1 },
        compiledSql: 'SELECT * FROM places_place UNION ALL SELECT * FROM buildings_building',
        sqlOverride: null,
      });

      await urlState.encodeStateToUrl();

      const url = globalThis.history.replaceState.mock.calls[0][2];
      expect(url).toContain('?sv=');

      globalThis.location.hash = url.startsWith('#') ? url : `#${url}`;

      const decoded = await urlState.decodeStateFromUrl();
      expect(decoded).not.toBeNull();
      expect(decoded.themeKeys).toEqual(['places/place', 'buildings/building']);
      expect(decoded.bbox).toEqual({ xmin: -118.3, xmax: -118.2, ymin: 34.0, ymax: 34.1 });
      expect(decoded.sql).toContain('places_place');
      expect(decoded.search).toBe('cafe');
      expect(decoded.limit).toBe(5000);
    });

    it.skipIf(!hasCompression)('uses sqlOverride when present', async () => {
      mockStore._setState({
        pipeline: [{ id: 'p1', type: 'source', table: 'places_place', key: 'places/place' }],
        pipelineSearch: '',
        pipelineLimit: 3000,
        pipelineBbox: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
        compiledSql: 'SELECT * FROM places_place',
        sqlOverride: 'SELECT id FROM places_place LIMIT 10',
      });

      await urlState.encodeStateToUrl();
      const url = globalThis.history.replaceState.mock.calls[0][2];
      globalThis.location.hash = url;

      const decoded = await urlState.decodeStateFromUrl();
      expect(decoded.sql).toBe('SELECT id FROM places_place LIMIT 10');
    });

    it.skipIf(!hasCompression)('skips encoding when pipeline is empty', async () => {
      mockStore._setState({
        pipeline: [],
        pipelineSearch: '',
        pipelineLimit: 3000,
        pipelineBbox: null,
        compiledSql: '',
        sqlOverride: null,
      });

      await urlState.encodeStateToUrl();
      expect(globalThis.history.replaceState).not.toHaveBeenCalled();
    });
  });

  describe('decodeStateFromUrl', () => {
    it('returns null when no ?sv= in hash', async () => {
      globalThis.location.hash = '#12/34.5/-118.2';
      const result = await urlState.decodeStateFromUrl();
      expect(result).toBeNull();
    });

    it('returns null for empty encoded string', async () => {
      globalThis.location.hash = '#12/34.5/-118.2?sv=';
      const result = await urlState.decodeStateFromUrl();
      expect(result).toBeNull();
    });
  });

  describe('clearUrlState', () => {
    it('strips ?sv= from hash', () => {
      globalThis.location.hash = '#12/34.5/-118.2?sv=abc123';
      urlState.clearUrlState();
      const url = globalThis.history.replaceState.mock.calls[0][2];
      expect(url).toBe('#12/34.5/-118.2');
      expect(url).not.toContain('?sv=');
    });
  });
});
