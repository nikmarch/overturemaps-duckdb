import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

const $ = id => document.getElementById(id);
// Use local worker for development: set USE_LOCAL_WORKER=true or access via localhost/zarbazan
const USE_LOCAL_WORKER = false; // CI sets this to false for production
const isLocal = USE_LOCAL_WORKER || ['localhost', 'zarbazan'].includes(location.hostname);
const PROXY = isLocal ? 'http://localhost:8787' : 'https://overture-s3-proxy.nik-d71.workers.dev';
const RELEASE = '2026-01-21.0';
const CACHE_KEY = `overture_files_${RELEASE}_${location.origin}`;

let conn = null;
let placeMarkers = [];
let buildingMarkers = [];
let placesBbox = null;
let buildingsBbox = null;
const placesLayer = L.layerGroup();
const buildingsLayer = L.layerGroup();
const fileCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');

const DEFAULT_VIEW = [34.05, -118.25];
const DEFAULT_ZOOM = 14;

const [z, lat, lon] = (location.hash.slice(1) || '').split('/').map(Number);
const hasHash = !isNaN(lat) && !isNaN(lon);

const map = L.map('map').setView(
  hasHash ? [lat, lon] : DEFAULT_VIEW,
  hasHash && !isNaN(z) ? z : DEFAULT_ZOOM
);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
placesLayer.addTo(map);
buildingsLayer.addTo(map);

if (!hasHash && navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    pos => map.setView([pos.coords.latitude, pos.coords.longitude], DEFAULT_ZOOM),
    () => {}
  );
}

$('limitSlider').oninput = () => $('limitValue').textContent = parseInt($('limitSlider').value).toLocaleString();
$('distanceSlider').oninput = () => $('distanceValue').textContent = $('distanceSlider').value + 'm';
$('catHeader').onclick = () => $('categories').classList.toggle('visible');
$('loadPlacesBtn').onclick = loadPlaces;
$('loadBuildingsBtn').onclick = loadBuildings;
$('intersectCheck').onchange = findIntersections;
$('collapseBtn').onclick = () => {
  const body = $('controlsBody');
  const btn = $('collapseBtn');
  body.classList.toggle('collapsed');
  btn.textContent = body.classList.contains('collapsed') ? '+' : '−';
};

map.on('moveend', () => {
  const c = map.getCenter();
  history.replaceState(null, '', `#${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
});

// Cached table counts
let cachedPlacesCount = 0;
let cachedBuildingsCount = 0;

async function updateCachedCounts() {
  try {
    const tables = (await conn.query(`SHOW TABLES`)).toArray().map(t => t.name);
    if (tables.includes('places')) {
      cachedPlacesCount = Number((await conn.query(`SELECT COUNT(*) as c FROM places`)).toArray()[0].c);
    }
    if (tables.includes('buildings')) {
      cachedBuildingsCount = Number((await conn.query(`SELECT COUNT(*) as c FROM buildings`)).toArray()[0].c);
    }
  } catch (e) { /* ignore */ }
}

function log(msg, type = 'loading') {
  const shown = [];
  if (placeMarkers.length) shown.push(`${placeMarkers.length.toLocaleString()}p`);
  if (buildingMarkers.length) shown.push(`${buildingMarkers.length.toLocaleString()}b`);

  const cached = [];
  if (cachedPlacesCount) cached.push(`${cachedPlacesCount.toLocaleString()}p`);
  if (cachedBuildingsCount) cached.push(`${cachedBuildingsCount.toLocaleString()}b`);

  let totalsHtml = '';
  if (shown.length || cached.length) {
    const parts = [];
    if (shown.length) parts.push(`shown: ${shown.join('/')}`);
    if (cached.length) parts.push(`cached: ${cached.join('/')}`);
    totalsHtml = `<span class="status-totals">${parts.join(' | ')}</span>`;
  }

  $('status').innerHTML = `<div class="spinner"></div><span>${msg}</span>${totalsHtml}`;
  $('status').className = type;

  if (type === 'loading') {
    $('controlsBody').classList.remove('collapsed');
    $('collapseBtn').textContent = '−';
  }
}

function getBbox() {
  const b = map.getBounds();
  return { xmin: b.getWest(), xmax: b.getEast(), ymin: b.getSouth(), ymax: b.getNorth() };
}

function bboxContains(outer, inner) {
  return outer && outer.xmin <= inner.xmin && outer.xmax >= inner.xmax &&
    outer.ymin <= inner.ymin && outer.ymax >= inner.ymax;
}

function bboxFilter(bbox, alias = '') {
  const p = alias ? alias + '.' : '';
  return `${p}bbox.xmin >= ${bbox.xmin} AND ${p}bbox.xmax <= ${bbox.xmax} AND ${p}bbox.ymin >= ${bbox.ymin} AND ${p}bbox.ymax <= ${bbox.ymax}`;
}

function pointFilter(bbox, alias = '') {
  const p = alias ? alias + '.' : '';
  return `${p}lon >= ${bbox.xmin} AND ${p}lon <= ${bbox.xmax} AND ${p}lat >= ${bbox.ymin} AND ${p}lat <= ${bbox.ymax}`;
}

async function listFiles(theme, type) {
  const key = `${theme}/${type}`;
  if (fileCache[key]) return fileCache[key];

  let files = [], marker = '';
  while (true) {
    const url = `${PROXY}/?prefix=release/${RELEASE}/theme=${theme}/type=${type}/&max-keys=1000${marker ? '&marker=' + marker : ''}`;
    const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
    const keys = [...xml.querySelectorAll('Key')].map(k => k.textContent);
    files.push(...keys.map(k => `${PROXY}/${k}`));
    if (xml.querySelector('IsTruncated')?.textContent !== 'true') break;
    marker = encodeURIComponent(keys[keys.length - 1]);
  }
  fileCache[key] = files;
  localStorage.setItem(CACHE_KEY, JSON.stringify(fileCache));
  return files;
}

function renderBuilding(geojson, id) {
  const layer = L.geoJSON(JSON.parse(geojson), {
    style: { fillColor: '#3388ff', color: '#2266cc', weight: 1, fillOpacity: 0.5 }
  });
  layer.addTo(buildingsLayer);
  buildingMarkers.push({ layer, id, geojson });
}

function filterPlaces() {
  const checked = new Set([...$('categories').querySelectorAll('input[data-cat]:checked')].map(cb => cb.dataset.cat));
  let visible = 0;
  for (const { marker, cat } of placeMarkers) {
    if (checked.has(cat)) {
      if (!placesLayer.hasLayer(marker)) placesLayer.addLayer(marker);
      visible++;
    } else {
      placesLayer.removeLayer(marker);
    }
  }
  log(`${visible.toLocaleString()} places visible`, 'success');
}

function buildCategoryUI(catCounts) {
  const container = $('categories');
  container.innerHTML = '';

  const btns = document.createElement('div');
  btns.className = 'cat-buttons';
  btns.innerHTML = `<button type="button">All</button><button type="button">None</button>`;
  btns.children[0].onclick = () => { container.querySelectorAll('input').forEach(c => c.checked = true); filterPlaces(); };
  btns.children[1].onclick = () => { container.querySelectorAll('input').forEach(c => c.checked = false); filterPlaces(); };
  container.appendChild(btns);

  for (const [cat, cnt] of catCounts) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = true;
    input.dataset.cat = cat;
    input.onchange = filterPlaces;
    label.appendChild(input);
    label.append(` ${cat || 'uncategorized'} `);
    const span = document.createElement('span');
    span.className = 'cat-count';
    span.textContent = `(${cnt})`;
    label.appendChild(span);
    container.appendChild(label);
  }

  $('catCount').textContent = `(${catCounts.length})`;
  $('catSection').style.display = 'block';
  container.classList.add('visible');
}

async function loadPlaces() {
  const bbox = getBbox();
  const limit = parseInt($('limitSlider').value);
  const useCache = bboxContains(placesBbox, bbox);

  placesLayer.clearLayers();
  placeMarkers = [];
  $('loadPlacesBtn').disabled = true;

  try {
    if (!useCache) {
      const fileList = await listFiles('places', 'place');
      log(`Loading places (${fileList.length} files)...`);
      const files = fileList.map(f => `'${f}'`).join(',');
      await conn.query(`DROP TABLE IF EXISTS places`);
      await conn.query(`
        CREATE TABLE places AS
        SELECT id, names.primary as name, categories.primary as cat,
               ST_X(geometry) as lon, ST_Y(geometry) as lat, geometry, bbox
        FROM read_parquet([${files}], hive_partitioning=false)
        WHERE ${bboxFilter(bbox)}
        LIMIT ${limit}`);
      placesBbox = { ...bbox };
    } else {
      log('Querying cached places...');
    }

    const rows = (await conn.query(`SELECT id, name, cat, lon, lat FROM places WHERE ${pointFilter(bbox)}`)).toArray();
    const catCounts = {};

    for (const r of rows) {
      const cat = r.cat || '';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
      if (r.lat && r.lon) {
        const marker = L.circleMarker([Number(r.lat), Number(r.lon)], {
          radius: 5, fillColor: '#e74c3c', color: '#c0392b', weight: 1, fillOpacity: 0.8
        }).bindPopup(`<b>${r.name || '?'}</b><br>${cat}`);
        marker.addTo(placesLayer);
        placeMarkers.push({ marker, cat, id: r.id, lat: r.lat, lon: r.lon });
      }
    }

    buildCategoryUI(Object.entries(catCounts).sort((a, b) => b[1] - a[1]));
    await updateCachedCounts();
    log(`Loaded ${placeMarkers.length} places`, 'success');
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
    console.error(e);
  } finally {
    $('loadPlacesBtn').disabled = false;
  }
}

async function loadBuildingsFromFiles(bbox, files, label) {
  const fileList = files.map(f => `'${f}'`).join(',');
  const start = performance.now();
  await conn.query(`
    CREATE TABLE buildings AS
    SELECT DISTINCT id, names.primary as name, ST_AsGeoJSON(geometry) as geojson, geometry, bbox
    FROM read_parquet([${fileList}], hive_partitioning=false) b
    WHERE ${bboxFilter(bbox, 'b')}`);
  console.log(`${label}: ${((performance.now() - start) / 1000).toFixed(1)}s, ${files.length} files`);
}

async function getSmartFilteredFiles(bbox) {
  const url = `${PROXY}/files/buildings?xmin=${bbox.xmin}&xmax=${bbox.xmax}&ymin=${bbox.ymin}&ymax=${bbox.ymax}`;
  const response = await fetch(url);
  const files = await response.json();
  const total = response.headers.get('X-Total-Files') || '?';
  return { files, total };
}

async function loadBuildings() {
  const bbox = getBbox();
  const d = parseInt($('distanceSlider').value) / 111000;
  const useCache = bboxContains(buildingsBbox, bbox);
  const mode = document.querySelector('input[name="loadMode"]:checked')?.value || 'smart';

  buildingsLayer.clearLayers();
  buildingMarkers = [];
  $('loadBuildingsBtn').disabled = true;

  try {
    const tables = (await conn.query(`SHOW TABLES`)).toArray();
    if (!tables.some(t => t.name === 'places')) {
      log('Load places first', 'error');
      return;
    }

    if (!useCache) {
      await conn.query(`DROP TABLE IF EXISTS buildings`);

      if (mode === 'smart') {
        log('Getting filtered file list...');
        const { files, total } = await getSmartFilteredFiles(bbox);
        log(`Loading buildings (${files.length}/${total} files)...`);
        if (files.length > 0) {
          await loadBuildingsFromFiles(bbox, files, 'Smart filter');
        } else {
          await conn.query(`CREATE TABLE buildings (id VARCHAR, name VARCHAR, geojson VARCHAR, geometry GEOMETRY, bbox STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE))`);
        }
      } else {
        const files = await listFiles('buildings', 'building');
        log(`Loading buildings (${files.length} files)...`);
        await loadBuildingsFromFiles(bbox, files, 'All files');
      }

      buildingsBbox = { ...bbox };
    } else {
      log('Querying cached buildings...');
    }

    const rows = (await conn.query(`
      SELECT DISTINCT b.id, b.geojson FROM buildings b
      JOIN places p ON b.bbox.xmax >= p.bbox.xmin - ${d} AND b.bbox.xmin <= p.bbox.xmax + ${d}
                   AND b.bbox.ymax >= p.bbox.ymin - ${d} AND b.bbox.ymin <= p.bbox.ymax + ${d}
      WHERE ${bboxFilter(bbox, 'b')} AND ${pointFilter(bbox, 'p')}
    `)).toArray();

    for (const r of rows) if (r.geojson) renderBuilding(r.geojson, r.id);

    await updateCachedCounts();
    log(`Loaded ${buildingMarkers.length} buildings`, 'success');
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
    console.error(e);
  } finally {
    $('loadBuildingsBtn').disabled = false;
  }
}

async function findIntersections() {
  const checked = $('intersectCheck').checked;
  const bbox = getBbox();
  const d = parseInt($('distanceSlider').value) / 111000;

  $('legend').style.display = checked ? 'block' : 'none';

  if (!checked) {
    for (const { marker } of placeMarkers) {
      marker.setStyle({ fillColor: '#e74c3c', color: '#c0392b' });
    }
    for (const { layer } of buildingMarkers) {
      layer.setStyle({ fillColor: '#3388ff', color: '#2266cc' });
    }
    log(`${placeMarkers.length} places, ${buildingMarkers.length} buildings`, 'success');
    return;
  }

  try {
    const tables = (await conn.query(`SHOW TABLES`)).toArray();
    if (!tables.some(t => t.name === 'buildings')) {
      log('Load buildings first', 'error');
      $('intersectCheck').checked = false;
      return;
    }

    log('Finding intersections...');

    // Find places that have nearby buildings
    const placesWithBuildings = new Set(
      (await conn.query(`
        SELECT DISTINCT p.id FROM places p
        JOIN buildings b ON b.bbox.xmax >= p.bbox.xmin - ${d} AND b.bbox.xmin <= p.bbox.xmax + ${d}
                       AND b.bbox.ymax >= p.bbox.ymin - ${d} AND b.bbox.ymin <= p.bbox.ymax + ${d}
        WHERE ${pointFilter(bbox, 'p')}
      `)).toArray().map(r => r.id)
    );

    // Find buildings that have nearby places
    const buildingsWithPlaces = new Set(
      (await conn.query(`
        SELECT DISTINCT b.id FROM buildings b
        JOIN places p ON b.bbox.xmax >= p.bbox.xmin - ${d} AND b.bbox.xmin <= p.bbox.xmax + ${d}
                     AND b.bbox.ymax >= p.bbox.ymin - ${d} AND b.bbox.ymin <= p.bbox.ymax + ${d}
        WHERE ${pointFilter(bbox, 'p')}
      `)).toArray().map(r => r.id)
    );

    let matched = 0, unmatched = 0;
    for (const { marker, id } of placeMarkers) {
      if (placesWithBuildings.has(id)) {
        marker.setStyle({ fillColor: '#27ae60', color: '#1e8449' }); // green
        matched++;
      } else {
        marker.setStyle({ fillColor: '#e74c3c', color: '#c0392b' }); // red
        unmatched++;
      }
    }

    for (const { layer, id } of buildingMarkers) {
      if (buildingsWithPlaces.has(id)) {
        layer.setStyle({ fillColor: '#27ae60', color: '#1e8449' }); // green
      } else {
        layer.setStyle({ fillColor: '#3388ff', color: '#2266cc' }); // blue
      }
    }

    log(`${matched} matched, ${unmatched} unmatched places`, 'success');
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
    console.error(e);
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

    $('loadPlacesBtn').disabled = false;
    $('loadBuildingsBtn').disabled = false;

    if (!fileCache['places/place']) {
      log('Caching file lists...');
      await listFiles('places', 'place');
      await listFiles('buildings', 'building');
    }
    log('Ready', 'success');
  } catch (e) {
    log(`Init error: ${e.message}`, 'error');
    console.error(e);
  }
}

init();
