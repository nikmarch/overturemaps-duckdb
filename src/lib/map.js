import L from 'leaflet';
import { DEFAULT_VIEW, DEFAULT_ZOOM } from './constants.js';

let map = null;

export function initMap(elementId) {
  const [z, lat, lon] = (location.hash.slice(1) || '').split('/').map(Number);
  const hasHash = !isNaN(lat) && !isNaN(lon);

  map = L.map(elementId).setView(
    hasHash ? [lat, lon] : DEFAULT_VIEW,
    hasHash && !isNaN(z) ? z : DEFAULT_ZOOM,
  );
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

  map.on('moveend', () => {
    const c = map.getCenter();
    history.replaceState(null, '', `#${map.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
  });

  return map;
}

export function getMap() {
  return map;
}

export function getBbox() {
  const b = map.getBounds();
  return { xmin: b.getWest(), xmax: b.getEast(), ymin: b.getSouth(), ymax: b.getNorth() };
}

export function bboxContains(outer, inner) {
  return outer && outer.xmin <= inner.xmin && outer.xmax >= inner.xmax &&
    outer.ymin <= inner.ymin && outer.ymax >= inner.ymax;
}

export function getViewportString() {
  const b = map.getBounds();
  return `${b.getSouth().toFixed(2)},${b.getWest().toFixed(2)} → ${b.getNorth().toFixed(2)},${b.getEast().toFixed(2)} z${map.getZoom()}`;
}

export function lockMap() {
  if (!map) return;
  map.dragging.disable();
  map.touchZoom.disable();
  map.doubleClickZoom.disable();
  map.scrollWheelZoom.disable();
  map.boxZoom.disable();
  map.keyboard.disable();
  if (map.tap) map.tap.disable();
  map.getContainer().classList.add('map-locked');
}

export function unlockMap() {
  if (!map) return;
  map.dragging.enable();
  map.touchZoom.enable();
  map.doubleClickZoom.enable();
  map.scrollWheelZoom.enable();
  map.boxZoom.enable();
  map.keyboard.enable();
  if (map.tap) map.tap.enable();
  map.getContainer().classList.remove('map-locked');
}
