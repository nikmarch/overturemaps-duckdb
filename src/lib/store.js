import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const VIEWPORT_CAP_KEY = 'overture_viewport_cap';
const DEFAULT_VIEWPORT_CAP = 3000;
const savedCap = parseInt(localStorage.getItem(VIEWPORT_CAP_KEY), 10);

export const useStore = create(subscribeWithSelector((set, get) => ({
  status: { text: 'Initializing...', type: 'loading' },
  releases: [],
  selectedRelease: null,
  themes: [],
  themeUi: {},
  showSnapviews: true,
  highlightIntersections: false,
  viewportCap: Number.isFinite(savedCap) ? savedCap : DEFAULT_VIEWPORT_CAP,
  viewportStats: { shownText: '-', enabledCount: 0, totalThemes: 0, viewportText: '-', totalRendered: 0 },
  snapviews: [],
  activeSnapview: null,
})));

// Persist viewportCap to localStorage
useStore.subscribe(
  s => s.viewportCap,
  v => localStorage.setItem(VIEWPORT_CAP_KEY, String(v)),
);

// --- Snapview helpers ---

export function createSnapview(id, bbox, keys) {
  const cap = useStore.getState().viewportCap;
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
    cap,
  };
  useStore.setState(s => ({
    snapviews: [sv, ...s.snapviews].slice(0, 50),
  }));
  return sv;
}

export function updateSnapviewTheme(snapviewId, key, patch) {
  useStore.setState(s => ({
    snapviews: s.snapviews.map(sv => {
      if (sv.id !== snapviewId) return sv;
      const themeStats = { ...sv.themeStats, [key]: { ...(sv.themeStats[key] || {}), ...patch } };
      const loaded = Object.values(themeStats).filter(t => t.status === 'done').length;
      const progress = { loaded, total: sv.keys.length, currentKey: key };
      return { ...sv, themeStats, progress };
    }),
  }));
}

export function addSnapviewKey(snapviewId, key) {
  useStore.setState(s => ({
    snapviews: s.snapviews.map(sv => {
      if (sv.id !== snapviewId) return sv;
      if (sv.keys.includes(key)) return sv;
      const keys = [...sv.keys, key];
      const progress = { ...sv.progress, total: keys.length };
      return { ...sv, keys, progress };
    }),
  }));
}

export function removeSnapviewKey(snapviewId, key) {
  useStore.setState(s => ({
    snapviews: s.snapviews.map(sv => {
      if (sv.id !== snapviewId) return sv;
      const keys = sv.keys.filter(k => k !== key);
      const themeStats = { ...sv.themeStats };
      delete themeStats[key];
      const loaded = Object.values(themeStats).filter(t => t.status === 'done').length;
      const progress = { loaded, total: keys.length, currentKey: sv.progress.currentKey };
      return { ...sv, keys, themeStats, progress };
    }),
  }));
}

export function finalizeSnapview(snapviewId) {
  useStore.setState(s => ({
    snapviews: s.snapviews.map(sv => {
      if (sv.id !== snapviewId) return sv;
      let totalRows = 0, totalFiles = 0, totalTimeMs = 0;
      for (const t of Object.values(sv.themeStats)) {
        totalRows += t.rowCount || 0;
        totalFiles += t.fileCount || 0;
        totalTimeMs += t.loadTimeMs || 0;
      }
      return { ...sv, status: 'done', totalRows, totalFiles, totalTimeMs };
    }),
  }));
}

export function failSnapview(snapviewId, error) {
  useStore.setState(s => ({
    snapviews: s.snapviews.map(sv => {
      if (sv.id !== snapviewId) return sv;
      return { ...sv, status: 'error', error: error?.message || String(error) };
    }),
  }));
}

export function checkSnapviewComplete(snapviewId) {
  const list = useStore.getState().snapviews;
  const sv = list.find(s => s.id === snapviewId);
  if (!sv || sv.status !== 'loading') return;
  const allDone = sv.keys.every(k => sv.themeStats[k]?.status === 'done');
  if (allDone) finalizeSnapview(snapviewId);
}

export function getSnapview(snapviewId) {
  return useStore.getState().snapviews.find(s => s.id === snapviewId) || null;
}

export function deleteSnapview(snapviewId) {
  useStore.setState(s => ({
    snapviews: s.snapviews.filter(sv => sv.id !== snapviewId),
  }));
}

export function updateSnapviewCap(snapviewId, cap) {
  useStore.setState(s => ({
    snapviews: s.snapviews.map(sv =>
      sv.id === snapviewId ? { ...sv, cap } : sv
    ),
  }));
}

// --- Selectors (replace Svelte derived stores) ---

export const selectThemeList = (s) =>
  [...s.themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));

export const selectSortedSnapviews = (s) =>
  [...s.snapviews].sort((a, b) => b.ts - a.ts);
