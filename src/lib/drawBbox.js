// Rectangle bbox drawing tool
//
// Lets the user draw a rectangle on the map by clicking and dragging.
// Stores the result in pipelineBbox. While drawing, map panning is disabled.

import L from 'leaflet';
import { getMap } from './map.js';
import { useStore } from './store.js';

let active = false;
let rectLayer = null;
let startLatLng = null;
let previewRect = null;
let drawCallback = null;

const RECT_STYLE = {
  color: '#1a73e8',
  weight: 2,
  fillColor: '#1a73e8',
  fillOpacity: 0.08,
  dashArray: '6 4',
};

const PREVIEW_STYLE = {
  color: '#1a73e8',
  weight: 1.5,
  fillColor: '#1a73e8',
  fillOpacity: 0.12,
  dashArray: '4 4',
};

export function isDrawActive() {
  return active;
}

export function startDraw(onComplete) {
  const map = getMap();
  if (!map || active) return;
  drawCallback = onComplete || null;

  // Clear previous rectangle
  if (rectLayer) { rectLayer.remove(); rectLayer = null; }

  active = true;
  map.getContainer().classList.add('map-drawing');

  // Disable map interactions during draw
  map.dragging.disable();
  map.boxZoom.disable();

  map.on('mousedown', onMouseDown);
  map.on('mousemove', onMouseMove);
  map.on('mouseup', onMouseUp);

  // Allow cancelling with Escape
  document.addEventListener('keydown', onKeyDown);
}

export function stopDraw() {
  const map = getMap();
  if (!map) return;

  active = false;
  startLatLng = null;
  map.getContainer().classList.remove('map-drawing');

  map.dragging.enable();
  map.boxZoom.enable();

  map.off('mousedown', onMouseDown);
  map.off('mousemove', onMouseMove);
  map.off('mouseup', onMouseUp);
  document.removeEventListener('keydown', onKeyDown);

  if (previewRect) {
    previewRect.remove();
    previewRect = null;
  }
}

export function clearDrawnBbox() {
  if (rectLayer) {
    rectLayer.remove();
    rectLayer = null;
  }
  useStore.setState({ pipelineBbox: null });
}

export function showBboxRect(bbox) {
  const map = getMap();
  if (!map) return;
  if (rectLayer) rectLayer.remove();
  rectLayer = L.rectangle(
    [[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]],
    RECT_STYLE,
  ).addTo(map);
}

function onMouseDown(e) {
  if (!active) return;
  // Only handle left click
  if (e.originalEvent.button !== 0) return;

  startLatLng = e.latlng;

  // Prevent map from starting a drag
  L.DomEvent.stop(e);
}

function onMouseMove(e) {
  if (!active || !startLatLng) return;

  const bounds = L.latLngBounds(startLatLng, e.latlng);

  if (previewRect) {
    previewRect.setBounds(bounds);
  } else {
    previewRect = L.rectangle(bounds, PREVIEW_STYLE).addTo(getMap());
  }
}

function onMouseUp(e) {
  if (!active || !startLatLng) return;

  const end = e.latlng;
  const bounds = L.latLngBounds(startLatLng, end);

  // Require a minimum size (not just a click)
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const dlat = Math.abs(ne.lat - sw.lat);
  const dlng = Math.abs(ne.lng - sw.lng);

  if (dlat < 0.0001 && dlng < 0.0001) {
    // Too small — ignore
    if (previewRect) { previewRect.remove(); previewRect = null; }
    startLatLng = null;
    return;
  }

  const bbox = {
    xmin: sw.lng,
    xmax: ne.lng,
    ymin: sw.lat,
    ymax: ne.lat,
  };

  // Show permanent rect
  showBboxRect(bbox);

  // Clean up preview and drawing state
  if (previewRect) { previewRect.remove(); previewRect = null; }
  stopDraw();

  // Set the bbox in the store
  useStore.setState({ pipelineBbox: bbox });

  // Notify caller (e.g. to open theme picker)
  if (drawCallback) {
    drawCallback(bbox);
    drawCallback = null;
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (previewRect) { previewRect.remove(); previewRect = null; }
    stopDraw();
  }
}
