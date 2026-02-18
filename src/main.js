import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

const $ = id => document.getElementById(id);
const PROXY = '/api';

const THEME_COLORS = {
  places:         { fill: '#e74c3c', stroke: '#c0392b' },
  buildings:      { fill: '#3388ff', stroke: '#2266cc' },
  transportation: { fill: '#f39c12', stroke: '#d68910' },
  base:           { fill: '#27ae60', stroke: '#1e8449' },
  addresses:      { fill: '#8e44ad', stroke: '#6c3483' },
  divisions:      { fill: '#2c3e50', stroke: '#1a252f' },
};
const DEFAULT_COLOR = { fill: '#95a5a6', stroke: '#7f8c8d' };

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
  ],
  'divisions/division_area': [
    { col: 'subtype', sql: 'subtype', label: 'Subtype' },
    { col: 'country', sql: 'country', label: 'Country' },
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

function getThemeColor(theme) {
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
  $('shownStats').textContent = shown.length ? shown.join(', ') : '-';
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
      color: color?.stroke || '#000',
      weight: 1,
      fillColor: color?.fill || '#000',
      fillOpacity: cached ? 0.03 : 0.08,
      dashArray: cached ? '4 6' : null,
      interactive: true,
    });

    rect.bindPopup(
      `<b>${fp.key}</b>` +
      `<br><small>${cached ? 'cached query' : 'fresh load'}</small>` +
      `<br><small>limit: ${Number(fp.limit).toLocaleString()}</small>` +
      `<br><small>time: ${formatTs(fp.ts)}</small>`
    );

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
  const releases = await res.json();
  const select = $('releaseSelect');
  select.innerHTML = '';
  for (const r of releases) {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    select.appendChild(opt);
  }
  select.disabled = false;
  select.onchange = () => onReleaseChange(select.value);
  if (releases.length > 0) {
    select.value = releases[0];
    await onReleaseChange(releases[0]);
  }
}

async function onReleaseChange(release) {
  currentRelease = release;

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
  buildThemeUI(themes);
  log('Ready', 'success');
}

function buildThemeUI(themes) {
  const container = $('themeList');
  container.innerHTML = '';

  for (const { theme, type } of themes) {
    const key = `${theme}/${type}`;
    const color = getThemeColor(theme);

    const layer = L.layerGroup();
    layer.addTo(map);
    themeState[key] = { layer, markers: [], bbox: null, limit: 33000, enabled: false };

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

    row.appendChild(label);
    row.appendChild(meta);
    row.appendChild(limitInput);
    container.appendChild(row);

    checkbox.onchange = () => onThemeToggle(key, checkbox.checked);
    limitInput.onchange = () => {
      themeState[key].limit = parseInt(limitInput.value) || 33000;
      themeState[key].bbox = null;
    };
  }
}

async function onThemeToggle(key, enabled) {
  themeState[key].enabled = enabled;
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
  const color = getThemeColor(theme);
  const tableName = `${theme}_${type}`;

  // Leave a visible track of what we asked the edge to load
  addFootprint({ key, bbox, limit, cached: useCache, color });

  const row = document.querySelector(`.theme-row[data-key="${key}"]`);
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

      const meta = document.querySelector(`.theme-meta[data-key="${key}"]`);
      if (meta) meta.textContent = `${filtered}/${total}`;

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

    log(`${state.markers.length.toLocaleString()} ${type}`, 'success');
  } catch (e) {
    log(`Error loading ${type}: ${e.message}`, 'error');
    console.error(e);
  } finally {
    if (row) row.classList.remove('loading');
  }
}

function renderFeature(row, state, color, extraFields = []) {
  const geomType = (row.geom_type || '').toUpperCase();
  let leafletObj;

  if (geomType.includes('POINT')) {
    if (row.centroid_lat && row.centroid_lon) {
      leafletObj = L.circleMarker(
        [Number(row.centroid_lat), Number(row.centroid_lon)],
        { radius: 5, fillColor: color.fill, color: color.stroke, weight: 1, fillOpacity: 0.8 }
      );
    }
  } else if (geomType.includes('POLYGON')) {
    if (row.geojson) {
      leafletObj = L.geoJSON(JSON.parse(row.geojson), {
        style: { fillColor: color.fill, color: color.stroke, weight: 1, fillOpacity: 0.4 }
      });
    }
  } else if (geomType.includes('LINE')) {
    if (row.geojson) {
      leafletObj = L.geoJSON(JSON.parse(row.geojson), {
        style: { color: color.fill, weight: 2, opacity: 0.8 }
      });
    }
  } else if (row.geojson) {
    leafletObj = L.geoJSON(JSON.parse(row.geojson), {
      style: { fillColor: color.fill, color: color.stroke, weight: 1, fillOpacity: 0.4 }
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
    leafletObj.bindPopup(popup);
    leafletObj.addTo(state.layer);
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
    $('footprintsCheck').onchange = () => renderFootprints();

    await loadReleases();
  } catch (e) {
    log(`Init error: ${e.message}`, 'error');
    console.error(e);
  }
}

init();
