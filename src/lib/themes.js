import L from 'leaflet';
import { PROXY, PALETTE_16, THEME_COLORS, DEFAULT_COLOR } from './constants.js';
import { getConn } from './duckdb.js';
import { getMap, getBbox, bboxContains } from './map.js';
import { bboxFilter, getFieldsForTable } from './query.js';
import { renderFeature } from './render.js';
import { darkenHex } from './render.js';
import { isIntersectionMode, recomputeIntersections } from './intersections.js';
import { setSnapviewRelease } from './snapviews.js';
import {
  status as statusStore,
  themes as themesStore,
  themeUi,
  releases as releasesStore,
  selectedRelease as selectedReleaseStore,
  viewportStats as viewportStatsStore,
  updateSnapviewTheme,
  checkSnapviewComplete,
  failSnapview,
} from './stores.js';

export const themeState = {};
export let currentRelease = null;
const THEME_KEY_COLORS = {};

function log(msg, type = 'loading') {
  statusStore.set({ text: msg, type });
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

export function updateStats() {
  const shown = [];
  let enabledCount = 0;
  const totalThemes = Object.keys(themeState).length;
  for (const [key, state] of Object.entries(themeState)) {
    if (state.enabled) enabledCount++;
    if (state.markers.length > 0) {
      const type = key.split('/')[1];
      shown.push(`${state.markers.length.toLocaleString()} ${type}`);
    }
  }
  const shownText = shown.length ? shown.join(', ') : '-';
  viewportStatsStore.update(s => ({ ...s, shownText, enabledCount, totalThemes }));
}

export function initTheme(key) {
  const map = getMap();
  const layer = L.layerGroup();
  layer.addTo(map);
  themeState[key] = { key, layer, markers: [], bbox: null, limit: 33000, loadedCount: 0, enabled: false };
  themeUi.update(m => ({ ...m, [key]: { enabled: false, limit: 33000, loading: false, metaText: '' } }));
}

// toggleTheme: when enabling, fires loadTheme WITHOUT await (non-blocking)
export function toggleTheme(key, enabled, snapviewId) {
  themeState[key].enabled = enabled;
  themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), enabled } }));
  if (enabled) {
    // Fire-and-forget: loadTheme runs in background
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
  themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), limit: newLimit } }));

  if (state.enabled && state.bbox) {
    if (newLimit <= state.loadedCount) {
      await rerenderThemeFromCache(key);
    } else if (newLimit > oldLimit) {
      state.bbox = null;
      await loadTheme(key);
    }
  }
}

async function rerenderThemeFromCache(key) {
  const conn = getConn();
  const state = themeState[key];
  const [theme, type] = key.split('/');
  const tableName = `${theme}_${type}`;
  const color = getThemeColor(key);
  const bbox = getBbox();
  const t0 = performance.now();

  state.layer.clearLayers();
  state.markers = [];

  try {
    const fields = await getFieldsForTable(conn, tableName, key);
    const rows = (await conn.query(`
      SELECT ${fields.selectParts.join(', ')}
      FROM "${tableName}"
      WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}
        AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}
      LIMIT ${state.limit}
    `)).toArray();
    await renderBatched(rows, state, color, fields.extraFields);
  } catch (e) {
    console.error(e);
  }

  const loadTimeMs = Math.round(performance.now() - t0);
  const rowCount = state.markers.length;
  themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), rowCount, loadTimeMs } }));
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
  const conn = getConn();
  const [theme, type] = key.split('/');
  const state = themeState[key];
  const bbox = getBbox();
  const limit = state.limit;
  const useCache = bboxContains(state.bbox, bbox);
  const color = getThemeColor(key);
  const tableName = `${theme}_${type}`;
  const t0 = performance.now();
  let fileCount = 0;

  themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), loading: true } }));

  // Report initial loading state to snapview
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
      const files = fileKeys.map(k => `${location.origin}/${k}`);
      fileCount = files.length;

      const metaText = `${filtered}/${total}`;
      themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), metaText } }));

      if (snapviewId) {
        updateSnapviewTheme(snapviewId, key, { status: 'loading', filesLoaded: 0, filesTotal: files.length });
      }

      await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);

      if (files.length > 0) {
        const batchSize = 3;
        let totalLoaded = 0;
        let fields = null;

        for (let i = 0; i < files.length && totalLoaded < limit; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          const remaining = limit - totalLoaded;
          log(`Loading ${type} (${Math.min(i + batch.length, files.length)}/${files.length} files, ${total} total)...`);

          const fileList = batch.map(f => `'${f}'`).join(',');

          if (i === 0) {
            await conn.query(`
              CREATE TABLE "${tableName}" AS
              SELECT *, ST_GeometryType(geometry) as geom_type,
                     ST_AsGeoJSON(geometry) as geojson,
                     ST_X(ST_Centroid(geometry)) as centroid_lon,
                     ST_Y(ST_Centroid(geometry)) as centroid_lat
              FROM read_parquet([${fileList}], hive_partitioning=false)
              WHERE ${bboxFilter(bbox)}
              LIMIT ${remaining}
            `);
            fields = await getFieldsForTable(conn, tableName, key);
          } else {
            await conn.query(`
              INSERT INTO "${tableName}"
              SELECT *, ST_GeometryType(geometry) as geom_type,
                     ST_AsGeoJSON(geometry) as geojson,
                     ST_X(ST_Centroid(geometry)) as centroid_lon,
                     ST_Y(ST_Centroid(geometry)) as centroid_lat
              FROM read_parquet([${fileList}], hive_partitioning=false)
              WHERE ${bboxFilter(bbox)}
              LIMIT ${remaining}
            `);
          }

          const newRows = (await conn.query(`
            SELECT ${fields.selectParts.join(', ')}
            FROM "${tableName}"
            LIMIT ${limit} OFFSET ${totalLoaded}
          `)).toArray();

          for (const r of newRows) {
            renderFeature(r, state, color, fields.extraFields);
          }
          totalLoaded += newRows.length;
          updateStats();

          // Report per-batch progress to snapview
          if (snapviewId) {
            updateSnapviewTheme(snapviewId, key, {
              status: 'loading',
              filesLoaded: Math.min(i + batch.length, files.length),
              filesTotal: files.length,
            });
          }

          await new Promise(r => setTimeout(r, 0));
        }
      }
      state.bbox = { ...bbox };
      state.loadedCount = state.markers.length;
    } else {
      log(`Querying cached ${type}...`);
      const fields = await getFieldsForTable(conn, tableName, key);
      const rows = (await conn.query(`
        SELECT ${fields.selectParts.join(', ')}
        FROM "${tableName}"
        WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}
          AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}
        LIMIT ${limit}
      `)).toArray();

      await renderBatched(rows, state, color, fields.extraFields);
    }

    if (isIntersectionMode()) {
      await recomputeIntersections(themeState, currentRelease);
      rerenderAllEnabled();
    }

    const loadTimeMs = Math.round(performance.now() - t0);
    const rowCount = state.markers.length;

    // Report completion to snapview
    if (snapviewId) {
      updateSnapviewTheme(snapviewId, key, {
        status: 'done',
        rowCount,
        fileCount,
        loadTimeMs,
      });
      checkSnapviewComplete(snapviewId);
    }

    recordLoadHistory(conn, { key, bbox, limit, cached: useCache, loadTimeMs, rowCount, fileCount, release: currentRelease });

    themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), loadTimeMs, rowCount, fileCount } }));

    log(`${rowCount.toLocaleString()} ${type} (${formatDuration(loadTimeMs)})`, 'success');
  } catch (e) {
    log(`Error loading ${type}: ${e.message}`, 'error');
    console.error(e);
    if (snapviewId) {
      updateSnapviewTheme(snapviewId, key, { status: 'error', error: e.message });
      failSnapview(snapviewId, e);
    }
  } finally {
    themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), loading: false } }));
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function recordLoadHistory(conn, { key, bbox, limit, cached, loadTimeMs, rowCount, fileCount, release }) {
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _load_history (
        key VARCHAR, release VARCHAR,
        xmin DOUBLE, ymin DOUBLE, xmax DOUBLE, ymax DOUBLE,
        lim INTEGER, cached BOOLEAN,
        row_count INTEGER, file_count INTEGER, load_time_ms INTEGER,
        ts TIMESTAMP DEFAULT current_timestamp
      )
    `);
    await conn.query(`
      INSERT INTO _load_history VALUES (
        '${key}', '${release}',
        ${bbox.xmin}, ${bbox.ymin}, ${bbox.xmax}, ${bbox.ymax},
        ${limit}, ${cached},
        ${rowCount}, ${fileCount}, ${loadTimeMs},
        current_timestamp
      )
    `);
  } catch (e) {
    console.warn('Failed to record load history:', e?.message);
  }
}

export async function enableThemeFromCache(key, snapviewBbox) {
  const conn = getConn();
  const state = themeState[key];
  if (!state || state.enabled) return;

  const [theme, type] = key.split('/');
  const tableName = `${theme}_${type}`;
  const color = getThemeColor(key);
  const limit = state.limit;
  const t0 = performance.now();

  state.enabled = true;
  state.layer.clearLayers();
  state.markers = [];

  let rowCount = 0;
  try {
    const bbox = getBbox();
    const fields = await getFieldsForTable(conn, tableName, key);
    const rows = (await conn.query(`
      SELECT ${fields.selectParts.join(', ')}
      FROM "${tableName}"
      WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}
        AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}
      LIMIT ${limit}
    `)).toArray();
    await renderBatched(rows, state, color, fields.extraFields);
    rowCount = rows.length;
    if (snapviewBbox) {
      state.bbox = { ...snapviewBbox };
      state.loadedCount = rowCount;
    }
  } catch {
    // Table might not exist yet
  }

  const loadTimeMs = Math.round(performance.now() - t0);
  themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), enabled: true, rowCount, loadTimeMs } }));
  updateStats();
}

export function disableTheme(key) {
  const state = themeState[key];
  if (!state || !state.enabled) return;
  state.enabled = false;
  state.layer.clearLayers();
  state.markers = [];
  themeUi.update(m => ({ ...m, [key]: { ...(m[key] || {}), enabled: false } }));
  updateStats();
}

export async function rerenderAllEnabled() {
  const conn = getConn();
  for (const key of Object.keys(themeState)) {
    const state = themeState[key];
    if (!state.enabled) continue;

    const [theme, type] = key.split('/');
    const color = getThemeColor(key);
    const tableName = `${theme}_${type}`;

    state.layer.clearLayers();
    state.markers = [];
    try {
      const bbox = getBbox();
      const fields = await getFieldsForTable(conn, tableName, key);
      const rows = (await conn.query(`
        SELECT ${fields.selectParts.join(', ')}
        FROM "${tableName}"
        WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}
          AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}
        LIMIT ${state.limit}
      `)).toArray();
      await renderBatched(rows, state, color, fields.extraFields);
    } catch (e) {
      console.error(e);
    }
    updateStats();
  }
}

export async function loadReleases() {
  log('Loading releases...');
  const res = await fetch(`${PROXY}/releases`);
  const data = await res.json();
  const rels = data.releases ?? data;
  releasesStore.set(rels);

  if (rels.length > 0) {
    selectedReleaseStore.set(rels[0]);
    await onReleaseChange(rels[0]);
  }
}

export async function onReleaseChange(release) {
  const map = getMap();
  currentRelease = release;
  selectedReleaseStore.set(release);
  setSnapviewRelease(release);

  for (const key of Object.keys(themeState)) {
    themeState[key].layer.clearLayers();
    map.removeLayer(themeState[key].layer);
    delete themeState[key];
  }

  log('Loading themes...');
  const res = await fetch(`${PROXY}/themes?release=${release}`);
  const themes = await res.json();
  themesStore.set(themes);

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
    themeState[key].bbox = null;
    themeState[key].loadedCount = 0;
    themeState[key].enabled = false;
  }
  themeUi.update(m => {
    const next = { ...m };
    for (const key of Object.keys(next)) {
      next[key] = { ...next[key], enabled: false };
    }
    return next;
  });
}
