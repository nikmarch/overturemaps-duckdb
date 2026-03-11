import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

const VIEWPORT_CAP_KEY = 'overture_viewport_cap';
const DEFAULT_VIEWPORT_CAP = 3000;
const savedCap = parseInt(localStorage.getItem(VIEWPORT_CAP_KEY), 10);

export const useStore = create(subscribeWithSelector((_set, _get) => ({
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
  globalSearch: "",

  // Reactive pipeline
  pipeline: [],           // [{ id, type: 'source'|'combine', op?, table, key, distance? }]
  pipelineSearch: '',     // text filter (ILIKE on display_name)
  pipelineLimit: 3000,    // result cap
  compiledSql: '',        // auto-compiled SQL from pipeline
  sqlOverride: null,      // user-edited SQL (overrides compiledSql when set)
  pipelineResult: null,   // { count, durationMs } or { error }
  pipelineRows: null,     // raw result rows from last pipeline query (shared by map + table)
  pipelineRunning: false,
  pipelineBbox: null,     // null = use viewport, { xmin, xmax, ymin, ymax } = drawn rectangle
  loadedTables: [],       // ['places_place', 'buildings_building', ...]

  queryStatus: [],
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
    hasData: true,
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

export function hydrateSnapviewMeta(metaList) {
  const svs = metaList.map(meta => ({
    ...meta,
    status: 'done',
    hasData: false,
    progress: { loaded: meta.keys.length, total: meta.keys.length, currentKey: null },
    themeStats: {},
    error: null,
  }));
  useStore.setState(s => {
    const existingIds = new Set(s.snapviews.map(sv => sv.id));
    const newSvs = svs.filter(sv => !existingIds.has(sv.id));
    return { snapviews: [...s.snapviews, ...newSvs].slice(0, 50) };
  });
}

// --- Pipeline helpers ---

let pipelineIdCounter = 1;
function pipelineId() {
  return 'p' + (pipelineIdCounter++);
}

export function addLoadedTable(tableName, key) {
  useStore.setState(s => {
    if (s.loadedTables.includes(tableName)) return {};

    const loadedTables = [...s.loadedTables, tableName];

    // Auto-add pipeline node for newly loaded table
    const hasNode = s.pipeline.some(n => n.table === tableName);
    if (hasNode) return { loadedTables };

    const node = {
      id: pipelineId(),
      type: s.pipeline.length === 0 ? 'source' : 'combine',
      op: s.pipeline.length === 0 ? undefined : 'union',
      table: tableName,
      key,
    };
    return { loadedTables, pipeline: [...s.pipeline, node] };
  });
}

export function addPipelineNode(node) {
  useStore.setState(s => ({
    pipeline: [...s.pipeline, { ...node, id: node.id || pipelineId() }],
    sqlOverride: null,
  }));
}

export function removePipelineNode(id) {
  useStore.setState(s => {
    let pipeline = s.pipeline.filter(n => n.id !== id);
    // If we removed the source, promote the first remaining node to source
    if (pipeline.length > 0 && !pipeline.some(n => n.type === 'source')) {
      pipeline = pipeline.map((n, i) =>
        i === 0 ? { ...n, type: 'source', op: undefined } : n
      );
    }
    return { pipeline, sqlOverride: null };
  });
}

export function updatePipelineNode(id, patch) {
  useStore.setState(s => ({
    pipeline: s.pipeline.map(n => n.id === id ? { ...n, ...patch } : n),
    sqlOverride: null,
  }));
}

export function clearPipeline() {
  useStore.setState({ pipeline: [], sqlOverride: null, pipelineResult: null });
}

// --- Selectors (replace Svelte derived stores) ---

export const selectThemeList = (s) =>
  [...s.themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));

export const selectSortedSnapviews = (s) =>
  [...s.snapviews].sort((a, b) => b.ts - a.ts);
