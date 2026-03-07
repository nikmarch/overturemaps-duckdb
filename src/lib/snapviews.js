import L from 'leaflet';
import { getMap } from './map.js';
import { useStore } from './store.js';
import { getThemeColor } from './themes.js';

let snapviewsLayer = null;
let showSnapviews = true;

// Remove any stale snapview localStorage keys from previous versions
for (const key of Object.keys(localStorage)) {
  if (key.startsWith('overture_snapviews_')) localStorage.removeItem(key);
}

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

export function clearSnapviews() {
  useStore.setState({ snapviews: [] });
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
  for (const [, overlay] of overlays) {
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
