import { PROXY } from './constants.js';
import { queryTile } from './duckdb.js';
import { getMap, getBbox, getZoom, bboxContains, filterByBbox } from './map.js';
import { precisionForZoom, geohashesForBbox } from './grid.js';
import { renderFeature } from './render.js';
import { setSnapviewRelease } from './snapviews.js';
import { parseWkb } from './wkb.js';
import {
  useStore,
  updateSnapviewTheme,
  checkSnapviewComplete,
  failSnapview,
} from './store.js';
import {
  themeState, currentRelease, themeAbort, setCurrentRelease,
  getThemeColor, getRenderLimit, updateStats, initTheme, assignColors,
  log, setThemeUi, formatDuration,
} from './themes.js';

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

// toggleTheme: when enabling, fires loadTheme WITHOUT await (non-blocking)
export function toggleTheme(key, enabled, snapviewId) {
  themeState[key].enabled = enabled;
  setThemeUi(key, { enabled });
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
  setThemeUi(key, { limit: newLimit });

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
    const filtered = filterByBbox(state.cachedRows, bbox).slice(0, renderLimit);
    await renderBatched(filtered, state, color, state.extraFields || []);
  }

  const loadTimeMs = Math.round(performance.now() - t0);
  const rowCount = state.markers.length;
  setThemeUi(key, { rowCount, loadTimeMs });
  updateStats();
  log(`${rowCount.toLocaleString()} ${type} (${formatDuration(loadTimeMs)})`, 'success');
}

export async function loadTheme(key, snapviewId) {
  // Cancel any in-flight requests for this theme
  if (themeAbort[key]) themeAbort[key].abort();
  const ac = new AbortController();
  themeAbort[key] = ac;

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

  setThemeUi(key, { loading: true });

  if (snapviewId) {
    updateSnapviewTheme(snapviewId, key, { status: 'loading', filesLoaded: 0, filesTotal: 0 });
  }

  state.layer.clearLayers();
  state.markers = [];

  try {
    if (!useCache) {
      log(`Loading ${type}...`);

      // 1. Compute geohash tiles client-side
      const zoom = getZoom();
      const precision = precisionForZoom(zoom, key);
      const hashes = geohashesForBbox(bbox, precision);
      fileCount = hashes.length;

      const metaText = `${hashes.length} tiles`;
      setThemeUi(key, { metaText });

      if (snapviewId) {
        updateSnapviewTheme(snapviewId, key, { status: 'loading', filesLoaded: 0, filesTotal: hashes.length });
      }

      if (hashes.length > 0) {
        const renderLimit = getRenderLimit(svCap);
        // extraFields from THEME_FIELDS (same columns the worker uses)
        const defs = (await import('./constants.js')).THEME_FIELDS[key] || [];
        state.extraFields = defs;
        state.cachedRows = [];
        let rendered = 0;

        // 2. Fetch each geohash tile individually (CDN-cached)
        const CONCURRENCY = 6;
        for (let i = 0; i < hashes.length; i += CONCURRENCY) {
          if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const batch = hashes.slice(i, i + CONCURRENCY);
          const results = await Promise.all(batch.map(hash => {
            const tileUrl = `${PROXY}/tiles/${key}/${hash}.arrow?release=${currentRelease}`;
            return queryTile(tileUrl, { signal: ac.signal });
          }));

          for (const { rows: batchRows } of results) {
            if (batchRows.length === 0) continue;

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

            const canRender = Math.max(0, renderLimit - rendered);
            const toRender = batchRows.slice(0, canRender);
            for (const row of toRender) {
              renderFeature(row, state, color, defs);
            }
            rendered += toRender.length;
          }

          log(`${type}: ${Math.min(i + CONCURRENCY, hashes.length)}/${hashes.length} tiles, ${state.cachedRows.length} rows`);
          updateStats();

          if (snapviewId) {
            updateSnapviewTheme(snapviewId, key, {
              status: 'loading',
              filesLoaded: Math.min(i + CONCURRENCY, hashes.length),
              filesTotal: hashes.length,
            });
          }
        }
      }

      state.bbox = { ...bbox };
      state.loadedCount = state.cachedRows?.length || 0;
    } else {
      log(`Querying cached ${type}...`);
      const renderLimit = getRenderLimit(svCap);

      const filtered = filterByBbox(state.cachedRows, bbox).slice(0, renderLimit);
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

    setThemeUi(key, { loadTimeMs, rowCount, fileCount });

    log(`${rowCount.toLocaleString()} ${type} (${formatDuration(loadTimeMs)})`, 'success');
  } catch (e) {
    if (e.name === 'AbortError') return; // cancelled by a newer loadTheme call
    log(`Error loading ${type}: ${e.message}`, 'error');
    console.error(e);
    if (snapviewId) {
      updateSnapviewTheme(snapviewId, key, { status: 'error', error: e.message });
      failSnapview(snapviewId, e);
    }
  } finally {
    setThemeUi(key, { loading: false });
  }
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

  setThemeUi(key, { enabled: true, loading: true });

  let rowCount = 0;
  try {
    const bbox = getBbox();
    if (state.cachedRows) {
      const filtered = filterByBbox(state.cachedRows, bbox).slice(0, renderLimit);
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
  setThemeUi(key, { enabled: state.enabled, rowCount, loadTimeMs, loading: false });
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
        const filtered = filterByBbox(state.cachedRows, bbox).slice(0, renderLimit);
        await renderBatched(filtered, state, color, state.extraFields || []);
      }
    } catch (e) {
      console.error(e);
    }

    const rowCount = state.markers.length;
    setThemeUi(key, { rowCount });
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
  setCurrentRelease(release);
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
