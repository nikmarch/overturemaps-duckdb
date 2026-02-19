import L from 'leaflet';
import { getMap } from './map.js';
import { useStore } from './store.js';
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

  // Subscribe to snapviews changes and sync map overlays
  useStore.subscribe(
    s => s.snapviews,
    list => syncMapOverlays(list),
  );

  // On zoom/pan, update tooltip visibility (hide when rect fits in viewport)
  map.on('moveend', () => updateTooltipVisibility());
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
    const migrated = raw.map(sv => {
      if (sv.id && sv.keys) return sv; // already new format

      // Migrate old format: { key, bbox, loadTimeMs, rowCount, fileCount, ts, ... }
      if (sv.key && sv.bbox) {
        return {
          id: sv.ts?.toString(36) || Date.now().toString(36) + Math.random().toString(36).slice(2),
          bbox: sv.bbox,
          keys: [sv.key],
          status: 'done',
          progress: { loaded: 1, total: 1, currentKey: null },
          themeStats: {
            [sv.key]: {
              status: 'done',
              rowCount: sv.rowCount || 0,
              fileCount: sv.fileCount || 0,
              loadTimeMs: sv.loadTimeMs || 0,
            },
          },
          ts: sv.ts || Date.now(),
          totalTimeMs: sv.loadTimeMs || 0,
          totalRows: sv.rowCount || 0,
          totalFiles: sv.fileCount || 0,
        };
      }
      return null;
    }).filter(Boolean);

    // Merge old-format entries that share the same bbox into single snapviews
    const byBbox = new Map();
    const merged = [];
    for (const sv of migrated) {
      if (sv.keys.length === 1 && !sv._merged) {
        const bk = [sv.bbox.xmin, sv.bbox.ymin, sv.bbox.xmax, sv.bbox.ymax].map(n => n.toFixed(5)).join(',');
        if (byBbox.has(bk)) {
          const target = byBbox.get(bk);
          if (!target.keys.includes(sv.keys[0])) {
            target.keys.push(sv.keys[0]);
            target.themeStats[sv.keys[0]] = sv.themeStats[sv.keys[0]];
            target.progress.total = target.keys.length;
            target.progress.loaded = target.keys.length;
            target.totalTimeMs += sv.totalTimeMs || 0;
            target.totalRows += sv.totalRows || 0;
            target.totalFiles += sv.totalFiles || 0;
            if (sv.ts > target.ts) target.ts = sv.ts;
          }
          continue;
        }
        byBbox.set(bk, sv);
      }
      merged.push(sv);
    }

    useStore.setState({ snapviews: merged });
  } catch {
    useStore.setState({ snapviews: [] });
  }
}

export function saveSnapviews(list) {
  localStorage.setItem(storageKey(), JSON.stringify(list));
}

// Auto-persist on changes
useStore.subscribe(
  s => s.snapviews,
  list => {
    if (currentRelease) saveSnapviews(list);
  },
);

export function clearSnapviews() {
  useStore.setState({ snapviews: [] });
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
    const list = useStore.getState().snapviews;
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
        weight: 2,
        fillColor: color.fill,
        fillOpacity: 0.15,
        dashArray: '6 4',
        className: 'snapview-loading-rect',
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
    const ts = sv.themeStats[p.currentKey];
    let fileInfo = '';
    if (ts && ts.filesTotal) {
      fileInfo = ` (${ts.filesLoaded || 0}/${ts.filesTotal} files)`;
    }
    const pct = p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
    return `<div class="snapview-loading-tooltip">
      <div class="snapview-loading-bar"><div class="snapview-loading-fill" style="width:${pct}%"></div></div>
      <span>Loading ${p.loaded}/${p.total}${currentType ? ' \u00b7 ' + currentType : ''}${fileInfo}</span>
    </div>`;
  }
  if (sv.status === 'error') {
    return `Error: ${sv.error || 'unknown'}`;
  }
  // done
  const rows = sv.totalRows != null ? sv.totalRows.toLocaleString() + ' rows' : '';
  const keys = sv.keys.map(k => k.split('/')[1]).join(', ');
  return `${keys}${rows ? ' \u00b7 ' + rows : ''}`;
}

// Check if a snapview bbox fits entirely within the current map viewport
function isFullyVisible(bbox) {
  const map = getMap();
  const mapBounds = map.getBounds();
  return mapBounds.contains(L.latLngBounds(
    [bbox.ymin, bbox.xmin],
    [bbox.ymax, bbox.xmax],
  ));
}

function updateTooltipVisibility() {
  for (const [id, overlay] of overlays) {
    if (!overlay.sv) continue;
    const sv = overlay.sv;
    const visible = isFullyVisible(sv.bbox);

    if (sv.status === 'loading') {
      // Loading: permanent tooltip, but hide if rect fits in viewport
      if (visible) {
        overlay.rect.closeTooltip();
      } else {
        overlay.rect.openTooltip();
      }
    }
    // done/error: hover only, Leaflet handles it
  }
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
    const permanent = sv.status === 'loading';

    const existing = overlays.get(sv.id);
    if (existing) {
      existing.sv = sv;
      existing.rect.setStyle(style);

      // If permanence changed (loading -> done), rebind tooltip
      if (existing.permanent !== permanent) {
        existing.rect.unbindTooltip();
        const tooltip = L.tooltip({
          permanent,
          direction: 'center',
          className: 'snapview-label',
        });
        tooltip.setContent(content);
        existing.rect.bindTooltip(tooltip);
        existing.tooltip = tooltip;
        existing.permanent = permanent;
      } else {
        existing.tooltip.setContent(content);
      }
    } else {
      // Create new
      const rect = L.rectangle(bounds, style);

      const tooltip = L.tooltip({
        permanent,
        direction: 'center',
        className: 'snapview-label',
      });
      tooltip.setContent(content);
      rect.bindTooltip(tooltip);

      rect.on('click', () => {
        map.fitBounds(bounds, { padding: [0, 0] });
      });

      rect.addTo(snapviewsLayer);
      overlays.set(sv.id, { rect, tooltip, sv, permanent });
    }
  }

  // Update visibility after syncing
  updateTooltipVisibility();
}
