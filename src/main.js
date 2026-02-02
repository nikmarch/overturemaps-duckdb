import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

const $ = id => document.getElementById(id);
const USE_LOCAL_WORKER = false;
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


let lastLimit = parseInt($('limitSlider').value);
$('limitSlider').oninput = () => {
  $('limitValue').textContent = parseInt($('limitSlider').value).toLocaleString();
  const newLimit = parseInt($('limitSlider').value);
  if (newLimit !== lastLimit) {
    placesBbox = null;
    buildingsBbox = null;
    lastLimit = newLimit;
  }
};
$('distanceSlider').oninput = () => $('distanceValue').textContent = $('distanceSlider').value + 'm';
$('catHeader').onclick = () => $('categories').classList.toggle('visible');
$('loadPlacesBtn').onclick = loadPlaces;
$('loadBuildingsBtn').onclick = loadBuildings;
$('intersectCheck').onchange = findIntersections;
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

function updateStats() {
  const cached = [];
  if (cachedPlacesCount) cached.push(`${cachedPlacesCount.toLocaleString()} places`);
  if (cachedBuildingsCount) cached.push(`${cachedBuildingsCount.toLocaleString()} buildings`);
  $('cachedStats').textContent = cached.length ? cached.join(', ') : '-';

  const shown = [];
  if (placeMarkers.length) shown.push(`${placeMarkers.length.toLocaleString()} places`);
  if (buildingMarkers.length) shown.push(`${buildingMarkers.length.toLocaleString()} buildings`);
  $('shownStats').textContent = shown.length ? shown.join(', ') : '-';
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
  updateStats();
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
      log('Getting filtered file list...');
      const { files: smartFiles, total } = await getSmartFilteredFiles('places', bbox);

      await conn.query(`DROP TABLE IF EXISTS places`);
      await conn.query(`CREATE TABLE places (id VARCHAR, name VARCHAR, cat VARCHAR, lon DOUBLE, lat DOUBLE, geometry GEOMETRY, bbox STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE))`);

      if (smartFiles.length > 0) {
        const batchSize = 2;
        let totalLoaded = 0;
        const catCounts = {};

        for (let i = 0; i < smartFiles.length && totalLoaded < limit; i += batchSize) {
          const batch = smartFiles.slice(i, i + batchSize);
          const remaining = limit - totalLoaded;
          log(`Loading places (${i + batch.length}/${smartFiles.length} files, ${total} total)...`);

          const files = batch.map(f => `'${f}'`).join(',');
          await conn.query(`
            INSERT INTO places
            SELECT id, names.primary as name, categories.primary as cat,
                   ST_X(geometry) as lon, ST_Y(geometry) as lat, geometry, bbox
            FROM read_parquet([${files}], hive_partitioning=false)
            WHERE ${bboxFilter(bbox)}
            LIMIT ${remaining}`);

          const newRows = (await conn.query(`
            SELECT id, name, cat, lon, lat FROM places
            WHERE ${pointFilter(bbox)}
            LIMIT ${limit} OFFSET ${totalLoaded}
          `)).toArray();

          for (const r of newRows) {
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
          totalLoaded += newRows.length;
          updateStats();
        }

        buildCategoryUI(Object.entries(catCounts).sort((a, b) => b[1] - a[1]));
      }
      placesBbox = { ...bbox };
    } else {
      log('Querying cached places...');
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
    }

    await updateCachedCounts();
    log(`Loaded ${placeMarkers.length.toLocaleString()} places`, 'success');
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
    console.error(e);
  } finally {
    $('loadPlacesBtn').disabled = false;
  }
}

async function loadBuildingsFromFiles(bbox, files, total, d) {
  await conn.query(`CREATE TABLE buildings (id VARCHAR, name VARCHAR, geojson VARCHAR, geometry GEOMETRY, bbox STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE))`);

  const batchSize = 5;
  const seenIds = new Set();

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    log(`Loading buildings (${i + batch.length}/${files.length} files, ${total} total)...`);

    const fileList = batch.map(f => `'${f}'`).join(',');
    await conn.query(`
      INSERT INTO buildings
      SELECT DISTINCT id, names.primary as name, ST_AsGeoJSON(geometry) as geojson, geometry, bbox
      FROM read_parquet([${fileList}], hive_partitioning=false) b
      WHERE ${bboxFilter(bbox, 'b')}`);

    const spatialCondition = d > 0
      ? `ST_DWithin(b.geometry, p.geometry, ${d})`
      : `ST_Contains(b.geometry, p.geometry)`;
    const newRows = (await conn.query(`
      SELECT DISTINCT b.id, b.geojson FROM buildings b
      JOIN places p ON b.bbox.xmax >= p.lon - ${d} AND b.bbox.xmin <= p.lon + ${d}
                   AND b.bbox.ymax >= p.lat - ${d} AND b.bbox.ymin <= p.lat + ${d}
      WHERE ${bboxFilter(bbox, 'b')} AND ${pointFilter(bbox, 'p')} AND ${spatialCondition}
    `)).toArray();

    for (const r of newRows) {
      if (r.geojson && !seenIds.has(r.id)) {
        seenIds.add(r.id);
        renderBuilding(r.geojson, r.id);
      }
    }
    updateStats();
  }
}

async function getSmartFilteredFiles(dataType, bbox) {
  const url = `${PROXY}/files/${dataType}?xmin=${bbox.xmin}&xmax=${bbox.xmax}&ymin=${bbox.ymin}&ymax=${bbox.ymax}`;
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
        const { files, total } = await getSmartFilteredFiles('buildings', bbox);
        if (files.length > 0) {
          await loadBuildingsFromFiles(bbox, files, total, d);
        } else {
          await conn.query(`CREATE TABLE buildings (id VARCHAR, name VARCHAR, geojson VARCHAR, geometry GEOMETRY, bbox STRUCT(xmin DOUBLE, xmax DOUBLE, ymin DOUBLE, ymax DOUBLE))`);
        }
      } else {
        const files = await listFiles('buildings', 'building');
        await loadBuildingsFromFiles(bbox, files, files.length, d);
      }

      buildingsBbox = { ...bbox };
    } else {
      log('Querying cached buildings...');
      const spatialCondition = d > 0
        ? `ST_DWithin(b.geometry, p.geometry, ${d})`
        : `ST_Contains(b.geometry, p.geometry)`;
      const rows = (await conn.query(`
        SELECT DISTINCT b.id, b.geojson FROM buildings b
        JOIN places p ON b.bbox.xmax >= p.lon - ${d} AND b.bbox.xmin <= p.lon + ${d}
                     AND b.bbox.ymax >= p.lat - ${d} AND b.bbox.ymin <= p.lat + ${d}
        WHERE ${bboxFilter(bbox, 'b')} AND ${pointFilter(bbox, 'p')} AND ${spatialCondition}
      `)).toArray();

      for (const r of rows) if (r.geojson) renderBuilding(r.geojson, r.id);
    }

    await updateCachedCounts();
    log(`Loaded ${buildingMarkers.length.toLocaleString()} buildings`, 'success');
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
      if (!placesLayer.hasLayer(marker)) placesLayer.addLayer(marker);
    }
    for (const { layer } of buildingMarkers) {
      layer.setStyle({ fillColor: '#3388ff', color: '#2266cc' });
      if (!buildingsLayer.hasLayer(layer)) buildingsLayer.addLayer(layer);
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

    const placesWithBuildings = new Set(
      (await conn.query(`
        SELECT DISTINCT p.id FROM places p
        JOIN buildings b ON b.bbox.xmax >= p.lon AND b.bbox.xmin <= p.lon
                       AND b.bbox.ymax >= p.lat AND b.bbox.ymin <= p.lat
        WHERE ${pointFilter(bbox, 'p')} AND ST_Contains(b.geometry, p.geometry)
      `)).toArray().map(r => r.id)
    );

    const buildingsWithPlaces = new Set(
      (await conn.query(`
        SELECT DISTINCT b.id FROM buildings b
        JOIN places p ON b.bbox.xmax >= p.lon AND b.bbox.xmin <= p.lon
                     AND b.bbox.ymax >= p.lat AND b.bbox.ymin <= p.lat
        WHERE ${pointFilter(bbox, 'p')} AND ST_Contains(b.geometry, p.geometry)
      `)).toArray().map(r => r.id)
    );

    let matched = 0, unmatched = 0;
    for (const { marker, id } of placeMarkers) {
      if (placesWithBuildings.has(id)) {
        marker.setStyle({ fillColor: '#27ae60', color: '#1e8449' });
        if (!placesLayer.hasLayer(marker)) placesLayer.addLayer(marker);
        matched++;
      } else {
        marker.setStyle({ fillColor: '#e74c3c', color: '#c0392b' });
        if (!placesLayer.hasLayer(marker)) placesLayer.addLayer(marker);
        unmatched++;
      }
    }

    let containingBuildings = 0;
    for (const { layer, id } of buildingMarkers) {
      if (buildingsWithPlaces.has(id)) {
        layer.setStyle({ fillColor: '#27ae60', color: '#1e8449' });
        containingBuildings++;
      } else {
        layer.setStyle({ fillColor: '#3388ff', color: '#2266cc' });
      }
      if (!buildingsLayer.hasLayer(layer)) buildingsLayer.addLayer(layer);
    }

    log(`${matched} places matched | ${containingBuildings} buildings contain places`, 'success');
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
