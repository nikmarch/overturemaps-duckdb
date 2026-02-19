import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

const $ = id => document.getElementById(id);
const PROXY = '/api';

// Legacy top-level theme colors (kept as fallback).
const THEME_COLORS = {
  places:         { fill: '#e74c3c', stroke: '#c0392b' },
  buildings:      { fill: '#3388ff', stroke: '#2266cc' },
  transportation: { fill: '#f39c12', stroke: '#d68910' },
  base:           { fill: '#27ae60', stroke: '#1e8449' },
  addresses:      { fill: '#8e44ad', stroke: '#6c3483' },
  divisions:      { fill: '#2c3e50', stroke: '#1a252f' },
};

// 16-category palette (Tableau-ish). Assigned per (theme/type) key, deterministically.
const PALETTE_16 = [
  '#4E79A7', '#F28E2B', '#E15759', '#76B7B2',
  '#59A14F', '#EDC948', '#B07AA1', '#FF9DA7',
  '#9C755F', '#BAB0AC', '#1F77B4', '#FF7F0E',
  '#2CA02C', '#D62728', '#9467BD', '#8C564B',
];

const DEFAULT_COLOR = { fill: '#95a5a6', stroke: '#7f8c8d' };
const THEME_KEY_COLORS = {}; // key -> {fill, stroke}

// Per-type fields to extract for popups. Each entry: { sql: 'SQL expr', label: 'Display label' }
// These are tried in order; missing columns are skipped at runtime
const THEME_FIELDS = {
  'places/place': [
    { col: 'categories', sql: 'categories.primary', label: 'Category' },
    { col: 'confidence', sql: 'ROUND(confidence, 2)', label: 'Confidence' },
    { col: 'websites', sql: 'websites[1]', label: 'Website' },
    { col: 'phones', sql: 'phones[1]', label: 'Phone' },
  ],
  'buildings/building': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'height', sql: 'ROUND(height, 1)', label: 'Height' },
    { col: 'num_floors', sql: 'num_floors', label: 'Floors' },
  ],
  'buildings/building_part': [
    { col: 'height', sql: 'ROUND(height, 1)', label: 'Height' },
    { col: 'num_floors', sql: 'num_floors', label: 'Floors' },
  ],
  'addresses/address': [
    { col: 'number', sql: 'number', label: 'Number' },
    { col: 'street', sql: 'street', label: 'Street' },
    { col: 'postcode', sql: 'postcode', label: 'Postcode' },
    { col: 'country', sql: 'country', label: 'Country' },
  ],
  'transportation/segment': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'subclass', sql: 'subclass', label: 'Subclass' },
  ],
  'base/infrastructure': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
  'base/land': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'elevation', sql: 'elevation', label: 'Elevation' },
  ],
  'base/land_cover': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
  ],
  'base/land_use': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
  'base/water': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
    { col: 'is_salt', sql: 'is_salt', label: 'Salt' },
    { col: 'is_intermittent', sql: 'is_intermittent', label: 'Intermittent' },
  ],
  'base/bathymetry': [
    { col: 'depth', sql: 'depth', label: 'Depth' },
  ],
  'divisions/division': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
    { col: 'population', sql: 'population', label: 'Population' },
    { col: 'sources', sql: 'sources[1].record_id', label: 'OSM record' },
    // Normalize: keep the 'r' prefix, drop @suffix.
    { col: 'sources', sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM relation id' },
  ],
  'divisions/division_area': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
    // Overture divisions are sourced from OSM; record_id looks like r3766655@...
    { col: 'sources', sql: 'sources[1].record_id', label: 'OSM record' },
    // Normalize: keep the 'r' prefix, drop @suffix.
    { col: 'sources', sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM relation id' },
  ],
  'divisions/division_boundary': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'class', sql: 'class', label: 'Class' },
  ],
};

let conn = null;
let currentRelease = null;
const themeState = {};

// Visual history of load requests (what user asked the edge to fetch)
const footprintsLayer = L.layerGroup();
const FOOTPRINTS_KEY_PREFIX = `overture_footprints_${location.origin}`;
let footprints = [];

// Intersection highlighting (points only)
let intersectionMode = false;
let intersectionInfoByPointId = new Map();
let lastIntersectionSig = null;

const DEFAULT_VIEW = [34.05, -118.25];
const DEFAULT_ZOOM = 14;

const [z, lat, lon] = (location.hash.slice(1) || '').split('/').map(Number);
const hasHash = !isNaN(lat) && !isNaN(lon);

const map = L.map('map').setView(
  hasHash ? [lat, lon] : DEFAULT_VIEW,
  hasHash && !isNaN(z) ? z : DEFAULT_ZOOM
);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
footprintsLayer.addTo(map);

$('collapseBtn').onclick = () => {
  const body = $('controlsBody');
  const btn = $('collapseBtn');
  body.classList.toggle('collapsed');
  const isCollapsed = body.classList.contains('collapsed');
  btn.textContent = isCollapsed ? '+' : '−';
  localStorage.setItem('controlsCollapsed', isCollapsed);
};

if (localStorage.getItem('controlsCollapsed') === 'true') {
  $('controlsBody').classList.add('collapsed');
  $('collapseBtn').textContent = '+';
}

map.on('moveend', () => {
  const c = map.getCenter();
  history.replaceState(null, '', `#${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
});

function darkenHex(hex, amount = 0.22) {
  const s = hex.replace('#', '');
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const k = 1 - amount;
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r * k)}${toHex(g * k)}${toHex(b * k)}`;
}

function getThemeColor(key) {
  // Prefer per-(theme/type) key mapping for maximum distinctness in the list.
  if (THEME_KEY_COLORS[key]) return THEME_KEY_COLORS[key];

  // Fallback: color by top-level theme.
  const theme = String(key || '').split('/')[0];
  return THEME_COLORS[theme] || DEFAULT_COLOR;
}

function updateStats() {
  const shown = [];
  for (const [key, state] of Object.entries(themeState)) {
    if (state.markers.length > 0) {
      const type = key.split('/')[1];
      shown.push(`${state.markers.length.toLocaleString()} ${type}`);
    }
  }
  const shownText = shown.length ? shown.join(', ') : '-';
  $('shownStats').textContent = shownText;
  window.__uiSetStats?.({ cachedText: $('cachedStats')?.textContent || '-', shownText });
}

function formatTs(ms) {
  const d = new Date(ms);
  return d.toLocaleString();
}

function footprintsStorageKey() {
  return `${FOOTPRINTS_KEY_PREFIX}_${currentRelease || 'unknown'}`;
}

function loadFootprints() {
  try {
    footprints = JSON.parse(localStorage.getItem(footprintsStorageKey()) || '[]');
  } catch {
    footprints = [];
  }
}

function saveFootprints() {
  localStorage.setItem(footprintsStorageKey(), JSON.stringify(footprints));
}

function clearFootprintsLayer() {
  footprintsLayer.clearLayers();
}

function renderFootprints() {
  clearFootprintsLayer();
  if (!$('footprintsCheck')?.checked) return;

  for (const fp of footprints) {
    const { bbox, color, cached } = fp;
    const bounds = [[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]];
    const rect = L.rectangle(bounds, {
      // Make the border a bit more readable, but keep it visually "secondary" via dashes.
      color: color?.stroke || '#000',
      weight: 1.3,
      fillColor: color?.fill || '#000',
      // Keep footprints subtle; they’re for context, not a layer.
      fillOpacity: cached ? 0.015 : 0.04,
      dashArray: cached ? '2 6' : '6 6',
      interactive: true,
    });

    rect.bindPopup(
      `<b>${fp.key}</b>` +
      `<br><small>${cached ? 'cached query' : 'fresh load'}</small>` +
      `<br><small>limit: ${Number(fp.limit).toLocaleString()}</small>` +
      `<br><small>time: ${formatTs(fp.ts)}</small>` +
      `<br><a href="javascript:void(0)" class="zoom-to">zoom to viewport</a>`
    );

    rect.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const a = el && el.querySelector('a.zoom-to');
      if (!a) return;
      a.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Aim to match the cached/requested bbox as closely as Leaflet allows.
        map.fitBounds(bounds, { padding: [0, 0] });
      };
    });

    rect.addTo(footprintsLayer);
  }
}

function addFootprint({ key, bbox, limit, cached, color }) {
  const fp = { key, bbox, limit, cached: !!cached, color, ts: Date.now() };
  footprints.unshift(fp);
  // keep last 50
  footprints = footprints.slice(0, 50);
  saveFootprints();
  renderFootprints();
}

function log(msg, type = 'loading') {
  $('status').innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
  $('status').className = type;
  window.__uiSetStatus?.({ text: msg, type });
  updateStats();
}

function getBbox() {
  const b = map.getBounds();
  return { xmin: b.getWest(), xmax: b.getEast(), ymin: b.getSouth(), ymax: b.getNorth() };
}

function bboxContains(outer, inner) {
  return outer && outer.xmin <= inner.xmin && outer.xmax >= inner.xmax &&
    outer.ymin <= inner.ymin && outer.ymax >= inner.ymax;
}

function bboxFilter(bbox) {
  return `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
}

async function loadReleases() {
  log('Loading releases...');
  const res = await fetch(`${PROXY}/releases`);
  const data = await res.json();
  const rels = data.releases ?? data;

  // Let Svelte own the dropdown.
  window.__uiSetReleases?.(rels);

  // Back-compat: keep the DOM select in sync if it exists.
  const select = $('releaseSelect');
  if (select) {
    select.innerHTML = '';
    for (const r of rels) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      select.appendChild(opt);
    }
    select.disabled = false;
    select.onchange = () => onReleaseChange(select.value);
  }

  if (rels.length > 0) {
    window.__uiSetSelectedRelease?.(rels[0]);
    if (select) select.value = rels[0];
    await onReleaseChange(rels[0]);
  }
}

async function clearCache() {
  if (!currentRelease) return;

  const btn = $('clearCacheBtn');
  btn.disabled = true;

  try {
    if (!confirm('Clear cache? This will: \n• clear footprints (localStorage)\n• drop local DuckDB tables\n• clear edge spatial index for all themes')) {
      return;
    }

    log('Clearing cache...');

    // 1) Footprints (local)
    footprints = [];
    localStorage.removeItem(footprintsStorageKey());
    renderFootprints();

    // Intersection highlight state
    intersectionMode = false;
    intersectionInfoByPointId = new Map();
    lastIntersectionSig = null;
    if ($('intersectionsCheck')) $('intersectionsCheck').checked = false;

    // 2) Drop local DuckDB tables
    if (conn) {
      const tables = (await conn.query(`SHOW TABLES`)).toArray().map(t => t.name);
      for (const t of tables) {
        // DuckDB internal tables shouldn't show up here, but keep it safe.
        if (!t) continue;
        await conn.query(`DROP TABLE IF EXISTS "${t}"`);
      }
    }

    // Reset UI state for themes
    for (const key of Object.keys(themeState)) {
      themeState[key].layer.clearLayers();
      themeState[key].markers = [];
      themeState[key].bbox = null;
      const row = document.querySelector(`.theme-row[data-key="${key}"]`);
      const cb = row && row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = false;
      themeState[key].enabled = false;
    }

    // 3) Clear edge index caches
    const requests = Object.keys(themeState).map((key) => {
      const [theme, type] = key.split('/');
      const url = `${PROXY}/index/clear?release=${encodeURIComponent(currentRelease)}&theme=${encodeURIComponent(theme)}&type=${encodeURIComponent(type)}`;
      return fetch(url).catch(() => null);
    });
    await Promise.all(requests);

    updateStats();
    log('Cache cleared', 'success');
  } catch (e) {
    console.error(e);
    log(`Clear cache error: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function onReleaseChange(release) {
  currentRelease = release;
  window.__uiSetSelectedRelease?.(release);

  // Clear all existing theme layers
  for (const key of Object.keys(themeState)) {
    themeState[key].layer.clearLayers();
    map.removeLayer(themeState[key].layer);
    delete themeState[key];
  }

  // Load footprints for this release
  loadFootprints();
  renderFootprints();

  log('Loading themes...');
  const res = await fetch(`${PROXY}/themes?release=${release}`);
  const themes = await res.json();
  window.__uiSetThemes?.(themes);
  buildThemeUI(themes);
  log('Ready', 'success');
}

function buildThemeUI(themes) {
  const container = $('themeList');
  if (container) container.innerHTML = '';

  // Stable order + stable colors.
  const sorted = [...themes].sort((a, b) => (`${a.theme}/${a.type}`).localeCompare(`${b.theme}/${b.type}`));

  // Assign distinct colors per (theme/type) key (up to 16 before cycling).
  for (const k of Object.keys(THEME_KEY_COLORS)) delete THEME_KEY_COLORS[k];
  sorted.forEach(({ theme, type }, i) => {
    const key = `${theme}/${type}`;
    const fill = PALETTE_16[i % PALETTE_16.length];
    THEME_KEY_COLORS[key] = { fill, stroke: darkenHex(fill) };
  });

  for (const { theme, type } of sorted) {
    const key = `${theme}/${type}`;
    const color = getThemeColor(key);

    const layer = L.layerGroup();
    layer.addTo(map);
    themeState[key] = { key, layer, markers: [], bbox: null, limit: 33000, enabled: false };

    const row = document.createElement('div');
    row.className = 'theme-row';
    row.dataset.key = key;

    const label = document.createElement('label');
    const dot = document.createElement('span');
    dot.className = 'theme-dot';
    dot.style.background = color.fill;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.key = key;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'theme-name';
    nameSpan.textContent = type;
    nameSpan.title = `${theme}/${type}`;
    label.appendChild(dot);
    label.appendChild(checkbox);
    label.appendChild(nameSpan);

    const meta = document.createElement('span');
    meta.className = 'theme-meta';
    meta.dataset.key = key;

    const limitInput = document.createElement('input');
    limitInput.type = 'number';
    limitInput.className = 'theme-limit';
    limitInput.value = '33000';
    limitInput.min = '100';
    limitInput.max = '1000000';
    limitInput.step = '1000';
    limitInput.dataset.key = key;

    // Initialize UI state (Svelte-owned). Keep DOM rendering only if container exists.
    window.__uiUpdateTheme?.(key, { enabled: false, limit: 33000, loading: false, metaText: '' });

    if (container) {
      row.appendChild(label);
      row.appendChild(meta);
      row.appendChild(limitInput);
      container.appendChild(row);

      checkbox.onchange = () => onThemeToggle(key, checkbox.checked);
      limitInput.onchange = () => {
        themeState[key].limit = parseInt(limitInput.value) || 33000;
        themeState[key].bbox = null;
        window.__uiUpdateTheme?.(key, { limit: themeState[key].limit });
      };
    }
  }
}

async function onThemeToggle(key, enabled) {
  themeState[key].enabled = enabled;
  window.__uiUpdateTheme?.(key, { enabled });
  if (enabled) {
    await loadTheme(key);
  } else {
    themeState[key].layer.clearLayers();
    themeState[key].markers = [];
    updateStats();
    log('Ready', 'success');
  }
}

async function getFieldsForTable(tableName, key) {
  const cols = (await conn.query(`SELECT column_name FROM information_schema.columns WHERE table_name='${tableName}'`)).toArray();
  const colNames = new Set(cols.map(c => c.column_name));

  // Name expression
  let nameExpr = 'NULL';
  if (colNames.has('names')) nameExpr = 'names.primary';
  else if (colNames.has('name')) nameExpr = 'name';

  // Extra fields from schema map, filtered to columns that exist
  const defs = THEME_FIELDS[key] || [];
  const extraFields = defs.filter(f => colNames.has(f.col));

  const selectParts = [
    'id',
    `COALESCE(CAST(${nameExpr} AS VARCHAR), '') as display_name`,
    'geom_type', 'geojson', 'centroid_lon', 'centroid_lat',
    ...extraFields.map((f, i) => `CAST(${f.sql} AS VARCHAR) as _f${i}`),
  ];

  return { selectParts, extraFields };
}

async function loadTheme(key) {
  const [theme, type] = key.split('/');
  const state = themeState[key];
  const bbox = getBbox();
  const limit = state.limit;
  const useCache = bboxContains(state.bbox, bbox);
  const color = getThemeColor(key);
  const tableName = `${theme}_${type}`;

  // Leave a visible track of what we asked the edge to load
  addFootprint({ key, bbox, limit, cached: useCache, color });

  const row = document.querySelector(`.theme-row[data-key="${key}"]`);
  window.__uiUpdateTheme?.(key, { loading: true });
  if (row) row.classList.add('loading');

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

      const metaText = `${filtered}/${total}`;
      window.__uiUpdateTheme?.(key, { metaText });
      const meta = document.querySelector(`.theme-meta[data-key="${key}"]`);
      if (meta) meta.textContent = metaText;

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
            fields = await getFieldsForTable(tableName, key);
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
        }
      }
      state.bbox = { ...bbox };
    } else {
      log(`Querying cached ${type}...`);
      const fields = await getFieldsForTable(tableName, key);
      const rows = (await conn.query(`
        SELECT ${fields.selectParts.join(', ')}
        FROM "${tableName}"
        WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}
          AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}
      `)).toArray();

      for (const r of rows) {
        renderFeature(r, state, color, fields.extraFields);
      }
    }

    // After load, recompute intersections (if enabled) and repaint.
    if (intersectionMode) {
      await recomputeIntersections();
      rerenderAllEnabledThemes();
    }

    log(`${state.markers.length.toLocaleString()} ${type}`, 'success');
  } catch (e) {
    log(`Error loading ${type}: ${e.message}`, 'error');
    console.error(e);
  } finally {
    window.__uiUpdateTheme?.(key, { loading: false });
    if (row) row.classList.remove('loading');
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function rerenderAllEnabledThemes() {
  for (const key of Object.keys(themeState)) {
    const state = themeState[key];
    if (!state.enabled) continue;

    // Re-render from local table, no edge fetch.
    const [theme, type] = key.split('/');
    const color = getThemeColor(key);
    const tableName = `${theme}_${type}`;

    (async () => {
      state.layer.clearLayers();
      state.markers = [];
      try {
        const bbox = getBbox();
        const fields = await getFieldsForTable(tableName, key);
        const rows = (await conn.query(`
          SELECT ${fields.selectParts.join(', ')}
          FROM "${tableName}"
          WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}
            AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}
        `)).toArray();
        for (const r of rows) renderFeature(r, state, color, fields.extraFields);
      } catch (e) {
        console.error(e);
      }
      updateStats();
    })();
  }
}

function intersectionSignature() {
  const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled).sort();
  const bbox = getBbox();
  return JSON.stringify({
    release: currentRelease,
    enabledKeys,
    bbox: [bbox.xmin, bbox.xmax, bbox.ymin, bbox.ymax].map(n => Number(n.toFixed(6))),
  });
}

async function recomputeIntersections() {
  if (!intersectionMode) {
    intersectionInfoByPointId = new Map();
    lastIntersectionSig = null;
    return;
  }

  if (!conn) return;

  const sig = intersectionSignature();
  if (sig === lastIntersectionSig) return;
  lastIntersectionSig = sig;

  const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled);
  if (enabledKeys.length < 2) {
    intersectionInfoByPointId = new Map();
    return;
  }

  // Source: all enabled point layers in viewport
  // Targets: all enabled non-point layers in viewport
  const pointKeys = [];
  const targetKeys = [];

  for (const key of enabledKeys) {
    const [theme, type] = key.split('/');
    const table = `${theme}_${type}`;

    try {
      const sample = (await conn.query(`SELECT geom_type FROM "${table}" LIMIT 1`)).toArray();
      const gt = (sample?.[0]?.geom_type || '').toUpperCase();
      if (gt.includes('POINT')) pointKeys.push(key);
      else targetKeys.push(key);
    } catch {
      // ignore broken tables
    }
  }

  if (pointKeys.length === 0 || targetKeys.length === 0) {
    intersectionInfoByPointId = new Map();
    return;
  }

  const bbox = getBbox();
  const hits = new Map();

  // Pairwise point->target intersects, prefiltered by bbox struct.
  for (const pk of pointKeys) {
    const [ptheme, ptype] = pk.split('/');
    const ptable = `${ptheme}_${ptype}`;

    for (const tk of targetKeys) {
      const [ttheme, ttype] = tk.split('/');
      const ttable = `${ttheme}_${ttype}`;
      const label = `${ttheme}/${ttype}`;

      // NOTE: bbox struct exists on raw parquet rows; we stored it in the table as `bbox`.
      // We also have centroid_{lon,lat} for quick viewport filtering.
      const q = `
        SELECT p.id AS pid
        FROM "${ptable}" p
        JOIN "${ttable}" t
          ON t.bbox.xmax >= p.centroid_lon
         AND t.bbox.xmin <= p.centroid_lon
         AND t.bbox.ymax >= p.centroid_lat
         AND t.bbox.ymin <= p.centroid_lat
        WHERE p.centroid_lon BETWEEN ${bbox.xmin} AND ${bbox.xmax}
          AND p.centroid_lat BETWEEN ${bbox.ymin} AND ${bbox.ymax}
          AND t.centroid_lon BETWEEN ${bbox.xmin} AND ${bbox.xmax}
          AND t.centroid_lat BETWEEN ${bbox.ymin} AND ${bbox.ymax}
          AND ST_Intersects(t.geometry, p.geometry)
      `;

      try {
        const rows = (await conn.query(q)).toArray();
        for (const r of rows) {
          const arr = hits.get(r.pid) || [];
          if (!arr.includes(label)) arr.push(label);
          hits.set(r.pid, arr);
        }
      } catch (e) {
        console.warn('intersection query failed for', pk, 'x', tk, e?.message);
      }
    }
  }

  intersectionInfoByPointId = new Map(
    [...hits.entries()].map(([id, arr]) => [id, { hits: arr }])
  );
}

function boundsAreaDeg2(bounds) {
  // Rough proxy, good enough for ordering/opacity.
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return Math.abs((ne.lat - sw.lat) * (ne.lng - sw.lng));
}

function applyZOrderBySize(layer) {
  // Smaller geometries should sit above big ones (regardless of theme).
  try {
    const b = layer.getBounds?.();
    if (!b) return;
    const a = boundsAreaDeg2(b);
    // Heuristic: very large -> back, otherwise front.
    if (a > 5) layer.bringToBack?.();
    else layer.bringToFront?.();
  } catch { /* ignore */ }
}

function attachZoomLink(layer, opts = {}) {
  const pointZoom = opts.pointZoom ?? 16;
  if (!layer) return;

  layer.on('popupopen', (e) => {
    const el = e.popup.getElement();
    const a = el && el.querySelector('a.zoom-to');
    if (!a) return;

    a.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      // For circle markers
      if (layer.getLatLng) {
        map.setView(layer.getLatLng(), Math.max(map.getZoom(), pointZoom));
        return;
      }

      // For GeoJSON / polylines / polygons
      const bounds = layer.getBounds?.();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [0, 0] });
      }
    };
  });
}

function renderFeature(row, state, color, extraFields = []) {
  const geomType = (row.geom_type || '').toUpperCase();
  let leafletObj;

  const isDivisions = state?.key?.startsWith?.('divisions/');
  const intersects = intersectionMode && geomType.includes('POINT') && intersectionInfoByPointId.has(row.id);

  if (geomType.includes('POINT')) {
    if (row.centroid_lat && row.centroid_lon) {
      leafletObj = L.circleMarker(
        [Number(row.centroid_lat), Number(row.centroid_lon)],
        {
          radius: 6,
          fillColor: intersects ? '#2ecc71' : color.fill,
          color: intersects ? '#1e8449' : color.stroke,
          weight: intersects ? 2.5 : 1.5,
          fillOpacity: 0.95,
        }
      );
    }
  } else if (geomType.includes('POLYGON')) {
    if (row.geojson) {
      leafletObj = L.geoJSON(JSON.parse(row.geojson), {
        style: () => {
          // Big polygons should be much less intense.
          // For divisions, bias even more to transparency.
          let fillOpacity = isDivisions ? 0.06 : 0.18;
          return { fillColor: color.fill, color: color.stroke, weight: 1, opacity: 0.75, fillOpacity };
        }
      });
    }
  } else if (geomType.includes('LINE')) {
    if (row.geojson) {
      leafletObj = L.geoJSON(JSON.parse(row.geojson), {
        style: { color: color.fill, weight: 3, opacity: 0.95 }
      });
    }
  } else if (row.geojson) {
    leafletObj = L.geoJSON(JSON.parse(row.geojson), {
      style: { fillColor: color.fill, color: color.stroke, weight: 1, opacity: 0.6, fillOpacity: 0.12 }
    });
  }

  if (leafletObj) {
    const name = row.display_name || row.id || '?';
    let popup = `<b>${name}</b>`;
    for (let i = 0; i < extraFields.length; i++) {
      const val = row[`_f${i}`];
      if (val != null && val !== '') {
        popup += `<br><small>${extraFields[i].label}: ${val}</small>`;
      }
    }

    if (intersectionMode && geomType.includes('POINT')) {
      const info = intersectionInfoByPointId.get(row.id);
      if (info?.hits?.length) {
        popup += `<br><small>intersects: ${info.hits.join(', ')}</small>`;
      } else {
        popup += `<br><small>intersects: none</small>`;
      }
    }

    popup += `<br><a href="javascript:void(0)" class="zoom-to">zoom to</a>`;
    leafletObj.bindPopup(popup);

    // click link in popup -> zoom to it
    attachZoomLink(leafletObj, { pointZoom: 16 });

    leafletObj.addTo(state.layer);

    // Global rule: keep small geometries in front of big ones
    if (leafletObj.getBounds) {
      applyZOrderBySize(leafletObj);
    }

    // Divisions: also scale polygon fill opacity by rough size so huge ones are faint
    if (isDivisions && leafletObj.getBounds) {
      try {
        const a = boundsAreaDeg2(leafletObj.getBounds());
        const dyn = clamp(0.12 / (1 + Math.log10(a + 1)), 0.02, 0.10);
        leafletObj.setStyle?.({ fillOpacity: dyn, opacity: 0.5, weight: 1 });
      } catch { /* ignore */ }
    }

    state.markers.push({ layer: leafletObj, id: row.id });
  }
}

async function init() {
  try {
    log('Loading DuckDB...');
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const worker = new Worker(URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    ));
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    conn = await db.connect();
    await conn.query('INSTALL spatial; LOAD spatial;');

    // UI handlers
    // UI events are now Svelte-owned; keep legacy wiring as fallback.
    if ($('footprintsCheck') && !$('footprintsCheck').onchange) {
      $('footprintsCheck').onchange = () => renderFootprints();
    }
    if ($('intersectionsCheck') && !$('intersectionsCheck').onchange) {
      $('intersectionsCheck').onchange = async () => {
        intersectionMode = $('intersectionsCheck').checked;
        await recomputeIntersections();
        rerenderAllEnabledThemes();
      };
    }
    // clearCache is now wired by Svelte; keep legacy wiring as a fallback.
    if (!$('clearCacheBtn').onclick) $('clearCacheBtn').onclick = clearCache;

    await loadReleases();
  } catch (e) {
    log(`Init error: ${e.message}`, 'error');
    console.error(e);
  }
}

// Expose minimal hooks for the Svelte controller.
window.__setRelease = onReleaseChange;
window.__toggleTheme = onThemeToggle;
window.__setThemeLimit = (key, limit) => {
  if (!themeState[key]) return;
  themeState[key].limit = Number(limit) || 33000;
  themeState[key].bbox = null;
  window.__uiUpdateTheme?.(key, { limit: themeState[key].limit });
};
window.__clearCache = clearCache;
window.__setShowFootprints = (v) => {
  const el = $('footprintsCheck');
  if (el) el.checked = !!v;
  renderFootprints();
};
window.__setHighlightIntersections = async (v) => {
  intersectionMode = !!v;
  const el = $('intersectionsCheck');
  if (el) el.checked = !!v;
  await recomputeIntersections();
  rerenderAllEnabledThemes();
};

init();
