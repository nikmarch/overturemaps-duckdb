import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage before importing store
const storage = {};
vi.stubGlobal('localStorage', {
  getItem: (k) => storage[k] ?? null,
  setItem: (k, v) => { storage[k] = v; },
});

const {
  useStore,
  createSnapview,
  finalizeSnapview,
  deleteSnapview,
  checkSnapviewComplete,
  selectSortedSnapviews,
} = await import('../src/lib/store.js');

describe('snapview helpers', () => {
  beforeEach(() => {
    useStore.setState({ snapviews: [], viewportCap: 3000 });
  });

  it('createSnapview adds a snapview to the store', () => {
    const sv = createSnapview('sv1', { xmin: 0, xmax: 1, ymin: 0, ymax: 1 }, ['places/place']);
    expect(sv.id).toBe('sv1');
    expect(sv.status).toBe('loading');
    expect(sv.keys).toEqual(['places/place']);

    const list = useStore.getState().snapviews;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sv1');
  });

  it('finalizeSnapview sets status to done and totals', () => {
    createSnapview('sv2', {}, ['a']);
    useStore.setState(s => ({
      snapviews: s.snapviews.map(sv =>
        sv.id === 'sv2'
          ? { ...sv, themeStats: { a: { status: 'done', rowCount: 10, fileCount: 2, loadTimeMs: 500 } } }
          : sv
      ),
    }));
    finalizeSnapview('sv2');

    const sv = useStore.getState().snapviews.find(s => s.id === 'sv2');
    expect(sv.status).toBe('done');
    expect(sv.totalRows).toBe(10);
    expect(sv.totalFiles).toBe(2);
    expect(sv.totalTimeMs).toBe(500);
  });

  it('deleteSnapview removes it from the list', () => {
    createSnapview('sv3', {}, ['a']);
    createSnapview('sv4', {}, ['b']);
    expect(useStore.getState().snapviews).toHaveLength(2);

    deleteSnapview('sv3');
    const list = useStore.getState().snapviews;
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('sv4');
  });

  it('checkSnapviewComplete finalizes when all keys done', () => {
    createSnapview('sv5', {}, ['a', 'b']);
    useStore.setState(s => ({
      snapviews: s.snapviews.map(sv =>
        sv.id === 'sv5'
          ? {
              ...sv,
              themeStats: {
                a: { status: 'done', rowCount: 5, fileCount: 1, loadTimeMs: 100 },
                b: { status: 'done', rowCount: 3, fileCount: 1, loadTimeMs: 200 },
              },
            }
          : sv
      ),
    }));
    checkSnapviewComplete('sv5');

    const sv = useStore.getState().snapviews.find(s => s.id === 'sv5');
    expect(sv.status).toBe('done');
  });

  it('checkSnapviewComplete does not finalize when keys pending', () => {
    createSnapview('sv6', {}, ['a', 'b']);
    useStore.setState(s => ({
      snapviews: s.snapviews.map(sv =>
        sv.id === 'sv6'
          ? { ...sv, themeStats: { a: { status: 'done', rowCount: 5, fileCount: 1, loadTimeMs: 100 } } }
          : sv
      ),
    }));
    checkSnapviewComplete('sv6');

    const sv = useStore.getState().snapviews.find(s => s.id === 'sv6');
    expect(sv.status).toBe('loading');
  });
});

describe('selectSortedSnapviews', () => {
  it('sorts by timestamp descending', () => {
    useStore.setState({
      snapviews: [
        { id: 'old', ts: 1000 },
        { id: 'new', ts: 2000 },
      ],
    });
    const sorted = selectSortedSnapviews(useStore.getState());
    expect(sorted[0].id).toBe('new');
    expect(sorted[1].id).toBe('old');
  });
});
