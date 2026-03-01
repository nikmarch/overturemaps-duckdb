/**
 * Geohash utilities for CDN-cacheable tile requests.
 */

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohashEncode(lat, lon, precision = 6) {
  let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  let hash = '';
  let isLon = true;
  let bit = 0;
  let ch = 0;

  while (hash.length < precision) {
    if (isLon) {
      const mid = (minLon + maxLon) / 2;
      if (lon >= mid) { ch = (ch << 1) | 1; minLon = mid; }
      else            { ch = ch << 1;       maxLon = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; minLat = mid; }
      else            { ch = ch << 1;       maxLat = mid; }
    }
    isLon = !isLon;
    if (++bit === 5) { hash += BASE32[ch]; ch = 0; bit = 0; }
  }
  return hash;
}

export function geohashDecodeBbox(hash) {
  let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  let isLon = true;

  for (const c of hash) {
    const val = BASE32.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      if (isLon) {
        const mid = (minLon + maxLon) / 2;
        if (val & (1 << bit)) minLon = mid; else maxLon = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (val & (1 << bit)) minLat = mid; else maxLat = mid;
      }
      isLon = !isLon;
    }
  }
  return { ymin: minLat, xmin: minLon, ymax: maxLat, xmax: maxLon };
}

export function geohashesForBbox(bbox, precision) {
  const hashes = new Set();
  // Get cell dimensions from a sample point
  const sample = geohashDecodeBbox(geohashEncode(bbox.ymin, bbox.xmin, precision));
  const stepLat = sample.ymax - sample.ymin;
  const stepLon = sample.xmax - sample.xmin;

  // Snap start to cell boundary before bbox, iterate past bbox end
  // to catch all cells that intersect the viewport
  const latStart = Math.floor(bbox.ymin / stepLat) * stepLat;
  const lonStart = Math.floor(bbox.xmin / stepLon) * stepLon;

  for (let lat = latStart; lat < bbox.ymax; lat += stepLat) {
    for (let lon = lonStart; lon < bbox.xmax; lon += stepLon) {
      // Use cell center to encode — avoids boundary ambiguity
      hashes.add(geohashEncode(lat + stepLat / 2, lon + stepLon / 2, precision));
    }
  }
  return [...hashes];
}

/**
 * Base precision from zoom level.
 * Themes can shift this up/down via PRECISION_OFFSET.
 */
function basePrecision(zoom) {
  if (zoom >= 16) return 6;
  if (zoom >= 12) return 5;
  if (zoom >= 8) return 4;
  return 3;
}

// Per-theme offset: negative = coarser (bigger tiles), positive = finer (smaller tiles)
const PRECISION_OFFSET = {
  'divisions/division':          -1,
  'divisions/division_area':     -2,
  'divisions/division_boundary': -1,
  'base/land':                   -1,
  'base/land_cover':             -1,
  'base/water':                  -1,
  'base/bathymetry':             -1,
  'addresses/address':            1,
};

export function precisionForZoom(zoom, themeKey) {
  const base = basePrecision(zoom);
  const offset = PRECISION_OFFSET[themeKey] || 0;
  return Math.max(1, Math.min(6, base + offset));
}
