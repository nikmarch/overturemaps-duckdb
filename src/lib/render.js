import L from 'leaflet';
import { getMap } from './map.js';
import { intersectionInfoByPointId, isIntersectionMode } from './intersections.js';

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function darkenHex(hex, amount = 0.22) {
  const s = hex.replace('#', '');
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const k = 1 - amount;
  const toHex = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r * k)}${toHex(g * k)}${toHex(b * k)}`;
}

function boundsAreaDeg2(bounds) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return Math.abs((ne.lat - sw.lat) * (ne.lng - sw.lng));
}

function applyZOrderBySize(layer) {
  try {
    const b = layer.getBounds?.();
    if (!b) return;
    const a = boundsAreaDeg2(b);
    if (a > 5) layer.bringToBack?.();
    else layer.bringToFront?.();
  } catch { /* ignore */ }
}

function attachZoomLink(layer, opts = {}) {
  const map = getMap();
  const pointZoom = opts.pointZoom ?? 16;
  if (!layer || !map) return;

  layer.on('popupopen', (e) => {
    const el = e.popup.getElement();
    const a = el && el.querySelector('a.zoom-to');
    if (!a) return;

    a.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (layer.getLatLng) {
        map.setView(layer.getLatLng(), Math.max(map.getZoom(), pointZoom));
        return;
      }
      const bounds = layer.getBounds?.();
      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds, { padding: [0, 0] });
      }
    };
  });
}

export function renderFeature(row, state, color, extraFields = []) {
  const geomType = (row.geom_type || '').toUpperCase();
  const intersectionMode = isIntersectionMode();
  let leafletObj;

  const isDivisions = state?.key?.startsWith?.('divisions/');
  const intersects = intersectionMode && geomType.includes('POINT') && intersectionInfoByPointId.has(row.id);

  if (geomType.includes('POINT')) {
    if (row.centroid_lat && row.centroid_lon) {
      const latlng = [Number(row.centroid_lat), Number(row.centroid_lon)];
      if (intersects) {
        leafletObj = L.marker(latlng, {
          icon: L.divIcon({
            className: 'intersection-cross',
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
        });
      } else {
        leafletObj = L.circleMarker(latlng, {
          radius: 3,
          fillColor: color.fill,
          color: color.stroke,
          weight: 1,
          fillOpacity: 0.95,
        });
      }
    }
  } else if (geomType.includes('POLYGON')) {
    if (row.geojson) {
      leafletObj = L.geoJSON(JSON.parse(row.geojson), {
        style: () => {
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
    const [_theme, _type] = (state.key || '').split('/');
    const typeLabel = (_type || '').replace(/_/g, ' ');
    let popup = `<small style="color:#888">${typeLabel} &middot; ${_theme} &middot; ${geomType}</small>`;
    popup += `<br><b>${name}</b>`;
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
    attachZoomLink(leafletObj, { pointZoom: 16 });
    leafletObj.addTo(state.layer);

    if (leafletObj.getBounds) {
      applyZOrderBySize(leafletObj);
    }

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
