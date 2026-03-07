import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { getConn } from '../../lib/duckdb.js';
import { getFieldsForTable } from '../../lib/query.js';
import { getThemeColor } from '../../lib/themes.js';

function tableNameForKey(key) {
  return key.replace('/', '_');
}

function renderRowOnMap(row, layer, color, key, extraFields) {
  const geomType = (row.geom_type || '').toUpperCase();
  let leafletObj;

  if (geomType.includes('POINT') && row.centroid_lat && row.centroid_lon) {
    leafletObj = L.circleMarker(
      [Number(row.centroid_lat), Number(row.centroid_lon)],
      { radius: 3, fillColor: color.fill, color: color.stroke, weight: 1, fillOpacity: 0.95 },
    );
  } else if (geomType.includes('POLYGON') && row.geojson) {
    const isDivisions = key.startsWith('divisions/');
    leafletObj = L.geoJSON(JSON.parse(row.geojson), {
      style: { fillColor: color.fill, color: color.stroke, weight: 1, opacity: 0.75, fillOpacity: isDivisions ? 0.06 : 0.18 },
    });
  } else if (geomType.includes('LINE') && row.geojson) {
    leafletObj = L.geoJSON(JSON.parse(row.geojson), {
      style: { color: color.fill, weight: 3, opacity: 0.95 },
    });
  } else if (row.geojson) {
    leafletObj = L.geoJSON(JSON.parse(row.geojson), {
      style: { fillColor: color.fill, color: color.stroke, weight: 1, opacity: 0.6, fillOpacity: 0.12 },
    });
  }

  if (leafletObj) {
    const name = row.display_name || row.id || '?';
    const [, _type] = key.split('/');
    let popup = `<small style="color:#888">${_type}</small><br><b>${name}</b>`;
    for (let i = 0; i < extraFields.length; i++) {
      const val = row[`_f${i}`];
      if (val != null && val !== '') popup += `<br><small>${extraFields[i].label}: ${val}</small>`;
    }
    leafletObj.bindPopup(popup);
    leafletObj.addTo(layer);
  }
}

export default function SnapviewMapOverlay({ sv, onClose }) {
  const mapDivRef = useRef(null);
  const leafletMapRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!mapDivRef.current) return;

    const m = L.map(mapDivRef.current, { preferCanvas: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(m);
    leafletMapRef.current = m;

    const { bbox } = sv;
    m.fitBounds([[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]], { padding: [20, 20] });

    (async () => {
      const conn = getConn();
      if (!conn) { setLoading(false); return; }

      let total = 0;
      const dataLayer = L.layerGroup().addTo(m);

      for (const key of sv.keys) {
        const tableName = tableNameForKey(key);
        const color = getThemeColor(key) || { fill: '#888', stroke: '#666' };
        try {
          const fields = await getFieldsForTable(conn, tableName, key);
          const cap = sv.cap || 3000;
          const result = await conn.query(
            `SELECT ${fields.selectParts.join(', ')} FROM "${tableName}" LIMIT ${cap}`,
          );
          const rows = result.toArray();
          for (const row of rows) {
            renderRowOnMap(row, dataLayer, color, key, fields.extraFields);
            total++;
          }
        } catch (e) {
          setError(e.message || String(e));
        }
      }

      setCount(total);
      setLoading(false);
    })();

    return () => {
      m.remove();
      leafletMapRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = sv.keys.map(k => k.split('/')[1]).join(', ');

  return (
    <div className="sv-map-overlay" onClick={onClose}>
      <div className="sv-map-overlay-inner" onClick={e => e.stopPropagation()}>
        <div className="sv-map-overlay-header">
          <span className="sv-map-overlay-title">{title}</span>
          {loading && <span className="sv-map-overlay-status loading">Loading…</span>}
          {!loading && !error && (
            <span className="sv-map-overlay-status">{count.toLocaleString()} features</span>
          )}
          {error && <span className="sv-map-overlay-status error" title={error}>Error</span>}
          <button className="sv-map-overlay-close" onClick={onClose}>&times;</button>
        </div>
        <div ref={mapDivRef} className="sv-map-overlay-map" />
      </div>
    </div>
  );
}
