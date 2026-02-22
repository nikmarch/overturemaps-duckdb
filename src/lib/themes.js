import L from 'leaflet';
import { PROXY, PALETTE_16, THEME_COLORS, DEFAULT_COLOR } from './constants.js';
import { query } from './duckdb.js';
import { getMap, getBbox, bboxContains } from './map.js';
import { buildQueryParams, splitBbox } from './query.js';
import { renderFeature } from './render.js';
import { darkenHex } from './render.js';
import { isIntersectionMode, recomputeIntersections } from './intersections.js';
import { setSnapviewRelease } from './snapviews.js';
import { parseWkb } from './wkb.js';
import {
  useStore,
  updateSnapviewTheme,
  checkSnapviewComplete,
  failSnapview,
} from './store.js';

export const themeState = {};
export let currentRelease = null;
const THEME_KEY_COLORS = {};

function log(msg, type = 'loading') {
  useStore.setState({ status: { text: msg, type } });
}

export function getThemeColor(key) {
  if (THEME_KEY_COLORS[key]) return THEME_KEY_COLORS[key];
  const theme = String(key || '').split('/')[0];
  return THEME_COLORS[theme] || DEFAULT_COLOR;
}

export function assignColors(themes) {
  const sorted = [...themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));
  for (const k of Object.keys(THEME_KEY_COLORS)) delete THEME_KEY_COLORS[k];
  sorted.forEach(({ theme, type }, i) => {
    const key = `${theme}/${type}`;
    const fill = PALETTE_16[i % PALETTE_16.length];
    THEME_KEY_COLORS[key] = { fill, stroke: darkenHex(fill) };
  });
  return sorted;
}

// Get the active snapview's cap, falling back to global viewportCap
export function getActiveCap() {
  const state = useStore.getState();
  const activeId = state.activeSnapview;
  if (activeId) {
    const sv = state.snapviews.find(s => s.id === activeId);
    if (sv?.cap) return sv.cap;
  }
  return state.viewportCap;
}

// Per-theme render budget: cap / enabledThemeCount
export function getRenderLimit(overrideCap) {
  const cap = overrideCap ?? getActiveCap();
  const enabledCount = Object.values(themeState).filter(s => s.enabled).length || 1;
  return Math.max(1, Math.floor(cap / enabledCount));
}

export function updateStats() {
  const shown = [];
  let enabledCount = 0;
  let totalRendered = 0;
  const totalThemes = Object.keys(themeState).length;
  for (const [key, state] of Object.entries(themeState)) {
    if (state.enabled) enabledCount++;
    if (state.markers.length > 0) {
      const type = key.split('/')[1];
      shown.push(`${state.markers.length.toLocaleString()} ${type}`);
      totalRendered += state.markers.length;
    }
  }
  const shownText = shown.length ? shown.join(', ') : '-';
  useStore.setState(s => ({
    viewportStats: { ...s.viewportStats, shownText, enabledCount, totalThemes, totalRendered },
  }));
}

export function initTheme(key) {
  const map = getMap();
  const layer = L.layerGroup();
  layer.addTo(map);
  themeState[key] = { key, layer, markers: [], cachedRows: null, bbox: null, limit: 33000, loadedCount: 0, enabled: false };
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { enabled: false, limit: 33000, loading: false, metaText: '' } },
  }));
}

// toggleTheme: when enabling, fires loadTheme WITHOUT await (non-blocking)
export function toggleTheme(key, enabled, snapviewId) {
  themeState[key].enabled = enabled;
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), enabled } },
  }));
  if (enabled) {
    loadTheme(key, snapviewId).catch(e => {
      console.error(`loadTheme ${key} failed:`, e);
      if (snapviewId) failSnapview(snapviewId, e);
    });
  } else {
    themeState[key].layer.clearLayers();
    themeState[key].markers = [];
    updateStats();
    log('Ready', 'success');
  }
}

export async function setThemeLimit(key, limit) {
  const state = themeState[key];
  if (!state) return;
  const newLimit = Number(limit) || 33000;
  const oldLimit = state.limit;
  state.limit = newLimit;
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), limit: newLimit } },
  }));

  if (state.enabled && state.bbox) {
    if (newLimit <= state.loadedCount) {
      await rerenderThemeFromCache(key);
    } else if (newLimit > oldLimit) {
      state.bbox = null;
      await loadTheme(key);
    }
  }
}

async function rerenderThemeFromCache(key, overrideCap) {
  const state = themeState[key];
  const [, type] = key.split('/');
  const color = getThemeColor(key);
  const bbox = getBbox();
  const renderLimit = getRenderLimit(overrideCap);
  const t0 = performance.now();

  state.layer.clearLayers();
  state.markers = [];

  if (state.cachedRows) {
    const filtered = state.cachedRows.filter(r =>
      r.centroid_lon >= bbox.xmin && r.centroid_lon <= bbox.xmax &&
      r.centroid_lat >= bbox.ymin && r.centroid_lat <= bbox.ymax
    ).slice(0, renderLimit);

    await renderBatched(filtered, state, color, state.extraFields || []);
  }

  const loadTimeMs = Math.round(performance.now() - t0);
  const rowCount = state.markers.length;
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), rowCount, loadTimeMs } },
  }));
  updateStats();
  log(`${rowCount.toLocaleString()} ${type} (${formatDuration(loadTimeMs)})`, 'success');
}

const RENDER_BATCH = 500;

async function renderBatched(rows, state, color, extraFields) {
  for (let i = 0; i < rows.length; i += RENDER_BATCH) {
    const end = Math.min(i + RENDER_BATCH, rows.length);
    for (let j = i; j < end; j++) {
      renderFeature(rows[j], state, color, extraFields);
    }
    if (end < rows.length) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

export async function loadTheme(key, snapviewId) {
  const [theme, type] = key.split('/');
  const state = themeState[key];
  const bbox = getBbox();
  const limit = state.limit;
  const useCache = bboxContains(state.bbox, bbox) && state.cachedRows;
  const color = getThemeColor(key);
  const t0 = performance.now();

  const svCap = snapviewId
    ? useStore.getState().snapviews.find(s => s.id === snapviewId)?.cap
    : undefined;
  let fileCount = 0;

  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), loading: true } },
  }));

  if (snapviewId) {
    updateSnapviewTheme(snapviewId, key, { status: 'loading', filesLoaded: 0, filesTotal: 0 });
  }

  state.layer.clearLayers();
  state.markers = [];

  try {
    if (!useCache) {
      log(`Loading ${type}...`);

      const filesUrl = `${PROXY}/files?release=${currentRelease}&theme=${theme}&type=${type}&xmin=${bbox.xmin}&xmax=${bbox.xmax}&ymin=${bbox.ymin}&ymax=${bbox.ymax}`;
      const filesRes = await fetch(filesUrl);
      const fileKeys = await filesRes.json();
      const total = filesRes.headers.get('X-Total-Files') || '?';
      const filtered = filesRes.headers.get('X-Filtered-Files') || '?';
      fileCount = fileKeys.length;

      const metaText = `${filtered}/${total}`;
      useStore.setState(s => ({
        themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), metaText } },
      }));

      if (snapviewId) {
        updateSnapviewTheme(snapviewId, key, { status: 'loading', filesLoaded: 0, filesTotal: fileKeys.length });
      }

      if (fileKeys.length > 0) {
        const renderLimit = getRenderLimit(svCap);
        const tiles = splitBbox(bbox);
        const perTileLimit = Math.ceil(limit / tiles.length);

        state.cachedRows = [];
        let rendered = 0;
        let extraFields;

        for (let t = 0; t < tiles.length; t++) {
          const { params, extraFields: ef } = buildQueryParams(key, fileKeys, tiles[t], perTileLimit);
          extraFields = ef;
          state.extraFields = ef;

          log(`Querying ${type} tile ${t + 1}/${tiles.length} (${fileKeys.length} files)...`);

          await query(params, (batchRows, fileIndex, totalFiles) => {
            // Parse WKB and render progressively as each file completes
            for (const row of batchRows) {
              if (row.geometry_wkb) {
                const parsed = parseWkb(row.geometry_wkb);
                if (parsed) {
                  row.geom_type = parsed.geom_type;
                  row.geojson = JSON.stringify(parsed.geojson);
                }
              }
              if (row.centroid_lon == null && row.bbox_xmin != null) {
                row.centroid_lon = (row.bbox_xmin + row.bbox_xmax) / 2;
                row.centroid_lat = (row.bbox_ymin + row.bbox_ymax) / 2;
              }
            }
            state.cachedRows.push(...batchRows);

            // Render this batch (up to remaining budget)
            const canRender = Math.max(0, renderLimit - rendered);
            const toRender = batchRows.slice(0, canRender);
            for (const row of toRender) {
              renderFeature(row, state, color, extraFields);
            }
            rendered += toRender.length;

            log(`${type}: tile ${t + 1}/${tiles.length}, ${fileIndex + 1}/${totalFiles} files, ${state.cachedRows.length} rows`);
            updateStats();

            if (snapviewId) {
              updateSnapviewTheme(snapviewId, key, {
                status: 'loading',
                filesLoaded: fileIndex + 1,
                filesTotal: totalFiles,
              });
            }
          });

          log(`${type}: tile ${t + 1}/${tiles.length}, ${state.cachedRows.length} rows`);
        }
      }

      state.bbox = { ...bbox };
      state.loadedCount = state.cachedRows?.length || 0;
    } else {
      log(`Querying cached ${type}...`);
      const renderLimit = getRenderLimit(svCap);

      const filtered = state.cachedRows.filter(r =>
        r.centroid_lon >= bbox.xmin && r.centroid_lon <= bbox.xmax &&
        r.centroid_lat >= bbox.ymin && r.centroid_lat <= bbox.ymax
      ).slice(0, renderLimit);

      await renderBatched(filtered, state, color, state.extraFields || []);
    }

    const loadTimeMs = Math.round(performance.now() - t0);
    const rowCount = state.markers.length;

    if (snapviewId) {
      updateSnapviewTheme(snapviewId, key, {
        status: 'done',
        rowCount,
        fileCount,
        loadTimeMs,
      });
      checkSnapviewComplete(snapviewId);
    }

    useStore.setState(s => ({
      themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), loadTimeMs, rowCount, fileCount } },
    }));

    log(`${rowCount.toLocaleString()} ${type} (${formatDuration(loadTimeMs)})`, 'success');
  } catch (e) {
    log(`Error loading ${type}: ${e.message}`, 'error');
    console.error(e);
    if (snapviewId) {
      updateSnapviewTheme(snapviewId, key, { status: 'error', error: e.message });
      failSnapview(snapviewId, e);
    }
  } finally {
    useStore.setState(s => ({
      themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), loading: false } },
    }));
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function enableThemeFromCache(key, snapviewBbox, snapviewCap) {
  const state = themeState[key];
  if (!state) return;

  const [, type] = key.split('/');
  const color = getThemeColor(key);
  const renderLimit = getRenderLimit(snapviewCap);
  const t0 = performance.now();

  state.enabled = true;
  state.layer.clearLayers();
  state.markers = [];

  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), enabled: true, loading: true } },
  }));

  let rowCount = 0;
  try {
    const bbox = getBbox();
    if (state.cachedRows) {
      const filtered = state.cachedRows.filter(r =>
        r.centroid_lon >= bbox.xmin && r.centroid_lon <= bbox.xmax &&
        r.centroid_lat >= bbox.ymin && r.centroid_lat <= bbox.ymax
      ).slice(0, renderLimit);

      await renderBatched(filtered, state, color, state.extraFields || []);
      rowCount = filtered.length;
    }

    if (snapviewBbox) {
      state.bbox = { ...snapviewBbox };
      state.loadedCount = rowCount;
    }
    log(`${rowCount.toLocaleString()} ${type} (cached)`, 'success');
  } catch (e) {
    console.warn(`enableThemeFromCache ${key} failed:`, e?.message);
    log(`Failed to load cached ${type}`, 'error');
    state.enabled = false;
  }

  const loadTimeMs = Math.round(performance.now() - t0);
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), enabled: state.enabled, rowCount, loadTimeMs, loading: false } },
  }));
  updateStats();
}

export function disableTheme(key) {
  const state = themeState[key];
  if (!state || !state.enabled) return;
  state.enabled = false;
  state.layer.clearLayers();
  state.markers = [];
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), enabled: false } },
  }));
  updateStats();
}

export async function rerenderAllEnabled(overrideCap) {
  const renderLimit = getRenderLimit(overrideCap);
  for (const key of Object.keys(themeState)) {
    const state = themeState[key];
    if (!state.enabled) continue;

    const color = getThemeColor(key);

    state.layer.clearLayers();
    state.markers = [];
    try {
      const bbox = getBbox();
      if (state.cachedRows) {
        const filtered = state.cachedRows.filter(r =>
          r.centroid_lon >= bbox.xmin && r.centroid_lon <= bbox.xmax &&
          r.centroid_lat >= bbox.ymin && r.centroid_lat <= bbox.ymax
        ).slice(0, renderLimit);

        await renderBatched(filtered, state, color, state.extraFields || []);
      }
    } catch (e) {
      console.error(e);
    }

    const rowCount = state.markers.length;
    useStore.setState(s => ({
      themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), rowCount } },
    }));
    updateStats();
  }
}

export async function loadReleases() {
  log('Loading releases...');
  const res = await fetch(`${PROXY}/releases`);
  const data = await res.json();
  const rels = data.releases ?? data;
  useStore.setState({ releases: rels });

  if (rels.length > 0) {
    useStore.setState({ selectedRelease: rels[0] });
    await onReleaseChange(rels[0]);
  }
}

export async function onReleaseChange(release) {
  const map = getMap();
  currentRelease = release;
  useStore.setState({ selectedRelease: release });
  setSnapviewRelease(release);

  for (const key of Object.keys(themeState)) {
    themeState[key].layer.clearLayers();
    map.removeLayer(themeState[key].layer);
    delete themeState[key];
  }

  log('Loading themes...');
  const res = await fetch(`${PROXY}/themes?release=${release}`);
  const themes = await res.json();
  useStore.setState({ themes });

  const sorted = assignColors(themes);
  for (const { theme, type } of sorted) {
    initTheme(`${theme}/${type}`);
  }

  log('Ready', 'success');
}

export function clearAllThemes() {
  for (const key of Object.keys(themeState)) {
    themeState[key].layer.clearLayers();
    themeState[key].markers = [];
    themeState[key].cachedRows = null;
    themeState[key].extraFields = null;
    themeState[key].bbox = null;
    themeState[key].loadedCount = 0;
    themeState[key].enabled = false;
  }
  useStore.setState(s => {
    const next = { ...s.themeUi };
    for (const key of Object.keys(next)) {
      next[key] = { ...next[key], enabled: false };
    }
    return { themeUi: next };
  });
}
