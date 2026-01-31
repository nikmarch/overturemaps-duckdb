import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdb_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';

const $ = (id) => document.getElementById(id);
const PROXY = import.meta.env.DEV ? 'http://localhost:8080/s3' : `${location.origin}/s3`;
const RELEASE = '2026-01-21.0';

let conn = null;
let placeMarkers = [];
let buildingMarkers = [];
const placesLayer = L.layerGroup();
const buildingsLayer = L.layerGroup();
const CACHE_KEY = `overture_files_${RELEASE}`;
const fileCache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');

$('limitSlider').oninput = () => {
  $('limitValue').textContent = parseInt($('limitSlider').value).toLocaleString();
};
$('distanceSlider').oninput = () => {
  $('distanceValue').textContent = $('distanceSlider').value + 'm';
};
$('catHeader').onclick = () => $('categories').classList.toggle('visible');

// Map setup
const [z, lat, lon] = (location.hash.slice(1) || '').split('/').map(Number);
const map = L.map('map').setView(
  !isNaN(lat) && !isNaN(lon) ? [lat, lon] : [34.05, -118.25],
  !isNaN(z) ? z : 14
);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
placesLayer.addTo(map);
buildingsLayer.addTo(map);

map.on('moveend', () => {
  const c = map.getCenter();
  history.replaceState(null, '', `#${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
});

function log(msg, type = 'loading') {
  $('status').innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
  $('status').className = type;
}

function getBbox() {
  const b = map.getBounds();
  return { xmin: b.getWest(), xmax: b.getEast(), ymin: b.getSouth(), ymax: b.getNorth() };
}

function bboxWhere(bbox, prefix = '') {
  const p = prefix ? prefix + '.' : '';
  return `${p}bbox.xmin >= ${bbox.xmin} AND ${p}bbox.xmax <= ${bbox.xmax} AND ${p}bbox.ymin >= ${bbox.ymin} AND ${p}bbox.ymax <= ${bbox.ymax}`;
}

async function listFiles(theme, type) {
  const key = `${theme}/${type}`;
  if (fileCache[key]) return fileCache[key];

  let files = [];
  let marker = '';
  while (true) {
    const url = `${PROXY}/?prefix=release/${RELEASE}/theme=${theme}/type=${type}/&max-keys=1000${marker ? '&marker=' + marker : ''}`;
    const xml = new DOMParser().parseFromString(await (await fetch(url)).text(), 'text/xml');
    const keys = [...xml.querySelectorAll('Key')].map((k) => k.textContent);
    files.push(...keys.map((k) => `${PROXY}/${k}`));
    if (xml.querySelector('IsTruncated')?.textContent !== 'true') break;
    marker = encodeURIComponent(keys[keys.length - 1]);
  }
  fileCache[key] = files;
  localStorage.setItem(CACHE_KEY, JSON.stringify(fileCache));
  return files;
}

function filterPlaces() {
  const checked = new Set(
    [...$('categories').querySelectorAll('input[data-cat]:checked')].map((cb) => cb.dataset.cat)
  );
  let visiblePlaces = 0;
  for (const { marker, cat } of placeMarkers) {
    if (checked.has(cat)) {
      if (!placesLayer.hasLayer(marker)) placesLayer.addLayer(marker);
      visiblePlaces++;
    } else {
      placesLayer.removeLayer(marker);
    }
  }
  let visibleBuildings = 0;
  for (const { layer, cats } of buildingMarkers) {
    const hasVisibleCat = [...cats].some((c) => checked.has(c));
    if (hasVisibleCat) {
      if (!buildingsLayer.hasLayer(layer)) buildingsLayer.addLayer(layer);
      visibleBuildings++;
    } else {
      buildingsLayer.removeLayer(layer);
    }
  }
  log(`${visiblePlaces.toLocaleString()} places, ${visibleBuildings} buildings`, 'success');
}

function buildCategoryUI(catCounts) {
  const container = $('categories');
  container.innerHTML = '';

  const btns = document.createElement('div');
  btns.className = 'cat-buttons';
  btns.innerHTML = `<button type="button">All</button><button type="button">None</button>`;
  btns.children[0].onclick = () => {
    container.querySelectorAll('input').forEach((c) => (c.checked = true));
    filterPlaces();
  };
  btns.children[1].onclick = () => {
    container.querySelectorAll('input').forEach((c) => (c.checked = false));
    filterPlaces();
  };
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

async function loadData() {
  const bbox = getBbox();
  const limit = parseInt($('limitSlider').value);

  placesLayer.clearLayers();
  buildingsLayer.clearLayers();
  placeMarkers = [];
  $('loadBtn').disabled = true;

  try {
    log('Loading places...');
    const placeFiles = await listFiles('places', 'place');
    const placeFileList = placeFiles.map((f) => `'${f}'`).join(',');

    const q = `SELECT names.primary as name, categories.primary as cat,
        ST_X(geometry) as lon, ST_Y(geometry) as lat
        FROM read_parquet([${placeFileList}], hive_partitioning=false)
        WHERE ${bboxWhere(bbox)}
        LIMIT ${limit}`;

    const rows = (await conn.query(q)).toArray();
    log(`Rendering ${rows.length} places...`);

    const catCounts = {};
    for (const r of rows) {
      const cat = r.cat || '';
      catCounts[cat] = (catCounts[cat] || 0) + 1;
      if (r.lat && r.lon) {
        const marker = L.circleMarker([Number(r.lat), Number(r.lon)], {
          radius: 5,
          fillColor: '#e74c3c',
          color: '#c0392b',
          weight: 1,
          fillOpacity: 0.8,
        }).bindPopup(`<b>${r.name || '?'}</b><br>${cat}`);
        marker.addTo(placesLayer);
        placeMarkers.push({ marker, cat });
      }
    }

    const sortedCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    buildCategoryUI(sortedCats);

    buildingMarkers = [];
    if ($('buildingsCheck').checked) {
      log('Loading buildings...');
      const buildingFiles = await listFiles('buildings', 'building');
      const buildingFileList = buildingFiles.map((f) => `'${f}'`).join(',');

      const distMeters = parseInt($('distanceSlider').value);
      const d = distMeters / 111000;

      await conn.query(`DROP TABLE IF EXISTS temp_places`);
      await conn.query(`CREATE TEMP TABLE temp_places AS
          SELECT categories.primary as cat,
                 bbox.xmin as xmin, bbox.xmax as xmax, bbox.ymin as ymin, bbox.ymax as ymax
          FROM read_parquet([${placeFileList}], hive_partitioning=false)
          WHERE ${bboxWhere(bbox)}
          LIMIT ${limit}`);

      const bq = `SELECT ST_AsGeoJSON(b.geometry) as geojson,
             LIST(DISTINCT COALESCE(p.cat, '')) as cats
          FROM read_parquet([${buildingFileList}], hive_partitioning=false) b
          JOIN temp_places p ON
               b.bbox.xmax >= p.xmin - ${d} AND b.bbox.xmin <= p.xmax + ${d}
               AND b.bbox.ymax >= p.ymin - ${d} AND b.bbox.ymin <= p.ymax + ${d}
          WHERE ${bboxWhere(bbox, 'b')}
          GROUP BY b.geometry`;

      const buildings = (await conn.query(bq)).toArray();
      log(`Rendering ${buildings.length} buildings...`);

      for (const r of buildings) {
        if (r.geojson) {
          const layer = L.geoJSON(JSON.parse(r.geojson), {
            style: { fillColor: '#3388ff', color: '#2266cc', weight: 1, fillOpacity: 0.5 },
          });
          layer.addTo(buildingsLayer);
          const cats = new Set(r.cats || []);
          buildingMarkers.push({ layer, cats });
        }
      }
    }

    log(`${placeMarkers.length} places, ${buildingMarkers.length} buildings`, 'success');
  } catch (e) {
    log(`Error: ${e.message}`, 'error');
    console.error(e);
  } finally {
    $('loadBtn').disabled = false;
  }
}

async function init() {
  try {
    log('Loading DuckDB...');

    const bundle = {
      mainModule: duckdb_wasm,
      mainWorker: duckdb_worker,
    };

    const worker = new Worker(bundle.mainWorker, { type: 'module' });
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule);

    conn = await db.connect();
    await conn.query('INSTALL spatial; LOAD spatial;');

    log('Ready', 'success');
    $('loadBtn').disabled = false;

    if (!fileCache['places/place']) {
      log('Caching file lists...');
      await listFiles('places', 'place');
      await listFiles('buildings', 'building');
      log('Ready', 'success');
    }
  } catch (e) {
    log(`Init error: ${e.message}`, 'error');
    console.error(e);
  }
}

$('loadBtn').onclick = loadData;
init();
