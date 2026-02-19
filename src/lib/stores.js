import { writable, derived, get } from 'svelte/store';

export const status = writable({ text: 'Initializing...', type: 'loading' });

export const releases = writable([]);
export const selectedRelease = writable(null);

// [{ theme, type }]
export const themes = writable([]);

// key -> { enabled, limit, loading, metaText }
export const themeUi = writable({});

export const showSnapviews = writable(true);
export const highlightIntersections = writable(false);

// Viewport render cap — max total features rendered across all themes
const VIEWPORT_CAP_KEY = 'overture_viewport_cap';
const DEFAULT_VIEWPORT_CAP = 3000;
const savedCap = parseInt(localStorage.getItem(VIEWPORT_CAP_KEY), 10);
export const viewportCap = writable(Number.isFinite(savedCap) ? savedCap : DEFAULT_VIEWPORT_CAP);
viewportCap.subscribe(v => localStorage.setItem(VIEWPORT_CAP_KEY, String(v)));

// { shownText, enabledCount, totalThemes, viewportText, totalRendered }
export const viewportStats = writable({ shownText: '-', enabledCount: 0, totalThemes: 0, viewportText: '-', totalRendered: 0 });

// --- Snapview store ---
// Array of snapview objects, each:
// { id, bbox, keys, status, progress, themeStats, ts, totalTimeMs, totalRows, totalFiles }
export const snapviews = writable([]);

// Active snapview id (string | null)
export const activeSnapview = writable(null);

// Create a new snapview with status 'loading'
export function createSnapview(id, bbox, keys) {
  const sv = {
    id,
    bbox,
    keys: [...keys],
    status: 'loading',
    progress: { loaded: 0, total: keys.length, currentKey: null },
    themeStats: {},
    ts: Date.now(),
    totalTimeMs: null,
    totalRows: null,
    totalFiles: null,
  };
  snapviews.update(list => [sv, ...list].slice(0, 50));
  return sv;
}

// Update one theme's stats within a snapview
export function updateSnapviewTheme(snapviewId, key, patch) {
  snapviews.update(list => list.map(sv => {
    if (sv.id !== snapviewId) return sv;
    const themeStats = { ...sv.themeStats, [key]: { ...(sv.themeStats[key] || {}), ...patch } };
    const loaded = Object.values(themeStats).filter(t => t.status === 'done').length;
    const progress = { loaded, total: sv.keys.length, currentKey: key };
    return { ...sv, themeStats, progress };
  }));
}

// Add a key to an existing snapview (when user toggles another theme while loading)
export function addSnapviewKey(snapviewId, key) {
  snapviews.update(list => list.map(sv => {
    if (sv.id !== snapviewId) return sv;
    if (sv.keys.includes(key)) return sv;
    const keys = [...sv.keys, key];
    const progress = { ...sv.progress, total: keys.length };
    return { ...sv, keys, progress };
  }));
}

// Remove a key from an existing snapview
export function removeSnapviewKey(snapviewId, key) {
  snapviews.update(list => list.map(sv => {
    if (sv.id !== snapviewId) return sv;
    const keys = sv.keys.filter(k => k !== key);
    const themeStats = { ...sv.themeStats };
    delete themeStats[key];
    const loaded = Object.values(themeStats).filter(t => t.status === 'done').length;
    const progress = { loaded, total: keys.length, currentKey: sv.progress.currentKey };
    return { ...sv, keys, themeStats, progress };
  }));
}

// Finalize a snapview: set status 'done', compute totals
export function finalizeSnapview(snapviewId) {
  snapviews.update(list => list.map(sv => {
    if (sv.id !== snapviewId) return sv;
    let totalRows = 0, totalFiles = 0, totalTimeMs = 0;
    for (const t of Object.values(sv.themeStats)) {
      totalRows += t.rowCount || 0;
      totalFiles += t.fileCount || 0;
      totalTimeMs += t.loadTimeMs || 0;
    }
    return { ...sv, status: 'done', totalRows, totalFiles, totalTimeMs };
  }));
}

// Mark a snapview as errored
export function failSnapview(snapviewId, error) {
  snapviews.update(list => list.map(sv => {
    if (sv.id !== snapviewId) return sv;
    return { ...sv, status: 'error', error: error?.message || String(error) };
  }));
}

// Check if all themes in a snapview are done, if so finalize it
export function checkSnapviewComplete(snapviewId) {
  const list = get(snapviews);
  const sv = list.find(s => s.id === snapviewId);
  if (!sv || sv.status !== 'loading') return;
  const allDone = sv.keys.every(k => sv.themeStats[k]?.status === 'done');
  if (allDone) finalizeSnapview(snapviewId);
}

// Get a snapview by id
export function getSnapview(snapviewId) {
  return get(snapviews).find(s => s.id === snapviewId) || null;
}

// Delete a snapview by id
export function deleteSnapview(snapviewId) {
  snapviews.update(list => list.filter(sv => sv.id !== snapviewId));
}

// Sorted snapviews (newest first) — replaces the old groupedSnapviews
export const sortedSnapviews = derived(snapviews, ($snapviews) => {
  return [...$snapviews].sort((a, b) => b.ts - a.ts);
});

export const themeList = derived(themes, ($themes) => {
  return [...$themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));
});
