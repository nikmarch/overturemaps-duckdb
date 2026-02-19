import L from 'leaflet';
import { getMap } from './map.js';
import { snapviews as snapviewsStore } from './stores.js';
import { getThemeColor } from './themes.js';

const SNAPVIEWS_KEY_PREFIX = `overture_snapviews_${location.origin}`;
let snapviewsLayer = null;
let showSnapviews = true;
let currentRelease = null;

// Live Leaflet objects: Map<snapviewId, { rect, tooltip }>
const overlays = new Map();

export function initSnapviewsLayer() {
  const map = getMap();
  snapviewsLayer = L.layerGroup();
  snapviewsLayer.addTo(map);

  // Subscribe to store changes and sync map overlays
  snapviewsStore.subscribe(list => syncMapOverlays(list));
}

function storageKey() {
  return `${SNAPVIEWS_KEY_PREFIX}_${currentRelease || 'unknown'}`;
}

export function setSnapviewRelease(release) {
  currentRelease = release;
  loadSnapviewsFromStorage();
}

function loadSnapviewsFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey()) || '[]');
    // Migrate old format: if entries have 'key' instead of 'keys', convert
    const migrated = raw.map(sv => {
      if (sv.keys) return sv; // already new format
      // Old format: { key, bbox, ... } — skip, can't migrate meaningfully
      return null;
    }).filter(Boolean);
    snapviewsStore.set(migrated);
  } catch {
    snapviewsStore.set([]);
  }
}

export function saveSnapviews(list) {
  localStorage.setItem(storageKey(), JSON.stringify(list));
}

// Auto-persist on changes
snapviewsStore.subscribe(list => {
  if (currentRelease) saveSnapviews(list);
});

export function clearSnapviews() {
  snapviewsStore.set([]);
  localStorage.removeItem(storageKey());
}

export function setShowSnapviews(v) {
  showSnapviews = !!v;
  if (!snapviewsLayer) return;
  if (!showSnapviews) {
    snapviewsLayer.clearLayers();
    overlays.clear();
  } else {
    // Re-sync
    let list;
    snapviewsStore.subscribe(l => { list = l; })();
    syncMapOverlays(list || []);
  }
}

function getSnapviewColor(sv) {
  // Use the first theme's color
  if (sv.keys.length > 0) {
    const c = getThemeColor(sv.keys[0]);
    return c;
  }
  return { fill: '#888', stroke: '#666' };
}

function getStatusStyle(sv) {
  const color = getSnapviewColor(sv);
  switch (sv.status) {
    case 'loading':
      return {
        color: color.stroke,
        weight: 1.5,
        fillColor: color.fill,
        fillOpacity: 0.06,
        dashArray: '6 4',
        interactive: true,
      };
    case 'done':
      return {
        color: color.stroke,
        weight: 1.3,
        fillColor: color.fill,
        fillOpacity: 0.03,
        dashArray: null,
        interactive: true,
      };
    case 'error':
      return {
        color: '#e74c3c',
        weight: 1.5,
        fillColor: '#e74c3c',
        fillOpacity: 0.04,
        dashArray: '6 4',
        interactive: true,
      };
    default:
      return {
        color: color.stroke,
        weight: 1,
        fillColor: color.fill,
        fillOpacity: 0.02,
        interactive: true,
      };
  }
}

function getTooltipContent(sv) {
  if (sv.status === 'loading') {
    const p = sv.progress;
    const currentType = p.currentKey ? p.currentKey.split('/')[1] : '';
    // Show file-level progress if available for current key
    const ts = sv.themeStats[p.currentKey];
    let fileInfo = '';
    if (ts && ts.filesTotal) {
      fileInfo = ` (${ts.filesLoaded || 0}/${ts.filesTotal} files)`;
    }
    return `Loading ${p.loaded}/${p.total}${currentType ? ' \u00b7 ' + currentType : ''}${fileInfo}`;
  }
  if (sv.status === 'error') {
    return `Error: ${sv.error || 'unknown'}`;
  }
  // done
  const rows = sv.totalRows != null ? sv.totalRows.toLocaleString() + ' rows' : '';
  const keys = sv.keys.map(k => k.split('/')[1]).join(', ');
  return `${keys}${rows ? ' \u00b7 ' + rows : ''}`;
}

function syncMapOverlays(list) {
  if (!snapviewsLayer || !showSnapviews) return;

  const map = getMap();
  const currentIds = new Set(list.map(sv => sv.id));

  // Remove overlays for snapviews that no longer exist
  for (const [id, overlay] of overlays) {
    if (!currentIds.has(id)) {
      snapviewsLayer.removeLayer(overlay.rect);
      overlays.delete(id);
    }
  }

  // Add or update overlays
  for (const sv of list) {
    if (!sv.id || !sv.bbox) continue;
    const bounds = [[sv.bbox.ymin, sv.bbox.xmin], [sv.bbox.ymax, sv.bbox.xmax]];
    const style = getStatusStyle(sv);
    const content = getTooltipContent(sv);

    const existing = overlays.get(sv.id);
    if (existing) {
      // Update style and tooltip
      existing.rect.setStyle(style);
      existing.tooltip.setContent(content);
    } else {
      // Create new
      const rect = L.rectangle(bounds, style);

      const tooltip = L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'snapview-label',
      });
      tooltip.setContent(content);
      rect.bindTooltip(tooltip);

      rect.on('click', () => {
        map.fitBounds(bounds, { padding: [0, 0] });
      });

      rect.addTo(snapviewsLayer);
      overlays.set(sv.id, { rect, tooltip });
    }
  }
}
