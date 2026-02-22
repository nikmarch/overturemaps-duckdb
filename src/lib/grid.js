/**
 * Deterministic spatial grid math for CDN-cacheable tile requests.
 * All arithmetic uses * 1e6 / 1e6 rounding to avoid floating-point drift.
 */

export function resolutionForZoom(zoom) {
  if (zoom >= 14) return 0.01;
  if (zoom >= 10) return 0.1;
  return 1.0;
}

export function cellOrigin(coord, res) {
  return Math.round(Math.floor(coord / res) * res * 1e6) / 1e6;
}

export function cellBbox(lat, lon, res) {
  return {
    ymin: lat,
    xmin: lon,
    ymax: Math.round((lat + res) * 1e6) / 1e6,
    xmax: Math.round((lon + res) * 1e6) / 1e6,
  };
}

export function viewportCells(bbox, resolution) {
  const cells = [];
  const latStart = cellOrigin(bbox.ymin, resolution);
  const lonStart = cellOrigin(bbox.xmin, resolution);
  const latEnd = bbox.ymax;
  const lonEnd = bbox.xmax;

  for (let lat = latStart; lat < latEnd; lat = Math.round((lat + resolution) * 1e6) / 1e6) {
    for (let lon = lonStart; lon < lonEnd; lon = Math.round((lon + resolution) * 1e6) / 1e6) {
      cells.push({ lat, lon });
    }
  }
  return cells;
}
