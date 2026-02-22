// Minimal WKB hex parser → GeoJSON
// Handles Point, LineString, Polygon, and Multi* variants

export function parseWkb(hex) {
  if (!hex || hex.length < 10) return null;
  const bytes = hexToBytes(hex);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  function readGeometry() {
    const le = bytes[offset] === 1;
    offset += 1;
    const wkbType = le ? view.getUint32(offset, true) : view.getUint32(offset, false);
    offset += 4;

    // Strip SRID flag and Z/M flags
    const baseType = wkbType & 0xff;

    switch (baseType) {
      case 1: return readPoint(le);
      case 2: return readLineString(le);
      case 3: return readPolygon(le);
      case 4: return readMulti(le, 'MultiPoint');
      case 5: return readMulti(le, 'MultiLineString');
      case 6: return readMulti(le, 'MultiPolygon');
      case 7: return readGeometryCollection(le);
      default: return null;
    }
  }

  function readDouble(le) {
    const val = view.getFloat64(offset, le);
    offset += 8;
    return val;
  }

  function readUint32(le) {
    const val = view.getUint32(offset, le);
    offset += 4;
    return val;
  }

  function readCoord(le) {
    return [readDouble(le), readDouble(le)];
  }

  function readCoordArray(le) {
    const n = readUint32(le);
    const coords = [];
    for (let i = 0; i < n; i++) coords.push(readCoord(le));
    return coords;
  }

  function readPoint(le) {
    const coords = readCoord(le);
    return { type: 'Point', coordinates: coords };
  }

  function readLineString(le) {
    return { type: 'LineString', coordinates: readCoordArray(le) };
  }

  function readPolygon(le) {
    const numRings = readUint32(le);
    const coordinates = [];
    for (let i = 0; i < numRings; i++) coordinates.push(readCoordArray(le));
    return { type: 'Polygon', coordinates };
  }

  function readMulti(le, type) {
    const n = readUint32(le);
    const geometries = [];
    for (let i = 0; i < n; i++) geometries.push(readGeometry());
    return {
      type,
      coordinates: geometries.map(g => g.coordinates),
    };
  }

  function readGeometryCollection(le) {
    const n = readUint32(le);
    const geometries = [];
    for (let i = 0; i < n; i++) geometries.push(readGeometry());
    return { type: 'GeometryCollection', geometries };
  }

  try {
    const geojson = readGeometry();
    if (!geojson) return null;
    const geomType = geojson.type.toUpperCase();
    return { type: geojson.type, geom_type: geomType, geojson };
  } catch {
    return null;
  }
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
