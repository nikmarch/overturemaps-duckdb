import L from 'leaflet';
import { getMap } from './map.js';
import { snapviews as snapviewsStore } from './stores.js';

const SNAPVIEWS_KEY_PREFIX = `overture_snapviews_${location.origin}`;
let snapviews = [];
let snapviewsLayer = null;
let showSnapviews = true;
let currentRelease = null;

export function initSnapviewsLayer() {
  const map = getMap();
  snapviewsLayer = L.layerGroup();
  snapviewsLayer.addTo(map);
}

function storageKey() {
  return `${SNAPVIEWS_KEY_PREFIX}_${currentRelease || 'unknown'}`;
}

export function setSnapviewRelease(release) {
  currentRelease = release;
  loadSnapviews();
  renderSnapviews();
}

function loadSnapviews() {
  try {
    snapviews = JSON.parse(localStorage.getItem(storageKey()) || '[]');
  } catch {
    snapviews = [];
  }
  snapviewsStore.set(snapviews);
}

function saveSnapviews() {
  localStorage.setItem(storageKey(), JSON.stringify(snapviews));
  snapviewsStore.set(snapviews);
}

export function addSnapview({ key, bbox, limit, cached, color, loadTimeMs, rowCount, fileCount }) {
  const sv = { key, bbox, limit, cached: !!cached, color, loadTimeMs, rowCount, fileCount, ts: Date.now() };
  snapviews.unshift(sv);
  snapviews = snapviews.slice(0, 50);
  saveSnapviews();
  renderSnapviews();
}

export function clearSnapviews() {
  snapviews = [];
  localStorage.removeItem(storageKey());
  snapviewsStore.set([]);
  renderSnapviews();
}

export function setShowSnapviews(v) {
  showSnapviews = !!v;
  renderSnapviews();
}

export function renderSnapviews() {
  if (!snapviewsLayer) return;
  snapviewsLayer.clearLayers();
  if (!showSnapviews) return;

  const map = getMap();

  for (const sv of snapviews) {
    const { bbox, color, cached } = sv;
    const bounds = [[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]];
    const rect = L.rectangle(bounds, {
      color: color?.stroke || '#000',
      weight: 1.3,
      fillColor: color?.fill || '#000',
      fillOpacity: cached ? 0.015 : 0.04,
      dashArray: cached ? '2 6' : '6 6',
      interactive: true,
    });

    const formatTs = (ms) => new Date(ms).toLocaleString();

    rect.bindPopup(
      `<b>${sv.key}</b>` +
      `<br><small>${cached ? 'cached query' : 'fresh load'}</small>` +
      `<br><small>limit: ${Number(sv.limit).toLocaleString()}</small>` +
      `<br><small>time: ${formatTs(sv.ts)}</small>` +
      `<br><a href="javascript:void(0)" class="zoom-to">zoom to viewport</a>`
    );

    rect.on('popupopen', (e) => {
      const el = e.popup.getElement();
      const a = el && el.querySelector('a.zoom-to');
      if (!a) return;
      a.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        map.fitBounds(bounds, { padding: [0, 0] });
      };
    });

    rect.addTo(snapviewsLayer);
  }
}

export function listSnapviews() {
  return snapviews;
}
