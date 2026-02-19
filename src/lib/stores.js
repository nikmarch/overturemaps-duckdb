import { writable, derived } from 'svelte/store';

export const status = writable({ text: 'Initializing...', type: 'loading' });

export const releases = writable([]);
export const selectedRelease = writable(null);

// [{ theme, type }]
export const themes = writable([]);

// key -> { enabled, limit, loading, metaText }
export const themeUi = writable({});

export const showSnapviews = writable(true);
export const highlightIntersections = writable(false);

// { shownText, enabledCount, totalThemes, viewportText }
export const viewportStats = writable({ shownText: '-', enabledCount: 0, totalThemes: 0, viewportText: '-' });

// Snapview history entries (raw)
export const snapviews = writable([]);

// Active snapview restoration: { bbox, keys: Set<string> } | null
export const activeSnapview = writable(null);

// Grouped snapviews: [{ bboxKey, bbox, entries: [...], keys: [...], ts }]
export const groupedSnapviews = derived(snapviews, ($snapviews) => {
  const groups = new Map();
  for (const sv of $snapviews) {
    const bk = bboxKey(sv.bbox);
    if (!groups.has(bk)) {
      groups.set(bk, { bboxKey: bk, bbox: sv.bbox, entries: [], keys: [], ts: sv.ts, totalTimeMs: 0, totalRows: 0, totalFiles: 0 });
    }
    const g = groups.get(bk);
    g.entries.push(sv);
    if (!g.keys.includes(sv.key)) g.keys.push(sv.key);
    if (sv.ts > g.ts) g.ts = sv.ts;
    g.totalTimeMs += sv.loadTimeMs || 0;
    g.totalRows += sv.rowCount || 0;
    g.totalFiles += sv.fileCount || 0;
  }
  return [...groups.values()];
});

function bboxKey(bbox) {
  return [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax].map(n => n.toFixed(5)).join(',');
}

export const themeList = derived(themes, ($themes) => {
  return [...$themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));
});
