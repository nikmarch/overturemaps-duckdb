import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { getConn } from '../../lib/duckdb.js';
import { getMap } from '../../lib/map.js';
import { ftsSearchTable, listUserTables } from '../../lib/fts.js';
import { getThemeColor } from '../../lib/themes.js';
import { renderFeature } from '../../lib/render.js';

const LIMIT = 10;
const DEBOUNCE_MS = 200;

function formatSource(tableName) {
  // theme/type tables are stored as theme_type
  return String(tableName || '').replace(/_/g, '/');
}

export default function MapSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const markerRef = useRef(null);
  const overlayRef = useRef(null);

  const trimmed = useMemo(() => q.trim(), [q]);

  useEffect(() => {
    const map = getMap();
    if (!map) return;
    overlayRef.current = L.layerGroup().addTo(map);
    return () => {
      overlayRef.current?.remove();
      overlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      const query = trimmed;
      if (!query) {
        setResults([]);
        setOpen(false);
        return;
      }

      const conn = getConn();
      if (!conn) return;

      setLoading(true);
      try {
        const tables = await listUserTables(conn);
        const all = [];

        for (const tableName of tables) {
          const rows = await ftsSearchTable(conn, tableName, query, LIMIT);
          for (const r of rows) all.push(r);
          if (all.length >= LIMIT) break;
        }

        if (!cancelled) {
          setResults(all.slice(0, LIMIT));
          setOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [trimmed]);

  function clearHighlight() {
    if (markerRef.current) {
      markerRef.current.remove();
      markerRef.current = null;
    }
    if (overlayRef.current) {
      overlayRef.current.clearLayers();
    }
  }

  function highlight(lat, lon) {
    clearHighlight();
    const map = getMap();
    if (!map) return;

    markerRef.current = L.circleMarker([lat, lon], {
      radius: 10,
      weight: 3,
      color: '#000',
      fillColor: '#fff',
      fillOpacity: 0.9,
    }).addTo(map);

    setTimeout(clearHighlight, 2500);
  }

  function onPick(r) {
    const map = getMap();
    if (!map) return;

    (async () => {
      const conn = getConn();
      const tableName = r.source_table;
      const id = String(r.id);

      // Prefer: load full feature and mimic the popup "zoom to" behavior.
      // Fallback: jump to centroid.
      try {
        const rows = (await conn.query(`
          SELECT id, display_name, centroid_lon, centroid_lat, geom_type, geojson
          FROM "${tableName}"
          WHERE id = '${id.replace(/'/g, "''")}';
        `)).toArray();
        const row = rows?.[0];
        if (row) {
          clearHighlight();

          const key = formatSource(tableName);
          const color = getThemeColor(key);
          const state = { key, layer: overlayRef.current, markers: [] };
          renderFeature(row, state, color, []);

          const layer = state.markers?.[0]?.layer;
          if (layer) {
            if (layer.getLatLng) {
              map.setView(layer.getLatLng(), Math.max(map.getZoom(), 16));
            } else {
              const bounds = layer.getBounds?.();
              if (bounds && bounds.isValid && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [0, 0] });
              }
            }
            layer.openPopup?.();
            return;
          }
        }
      } catch {
        // ignore
      }

      const lat = Number(r.centroid_lat);
      const lon = Number(r.centroid_lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        map.setView([lat, lon], Math.max(map.getZoom(), 16));
        highlight(lat, lon);
      }
    })();

    setOpen(false);
  }

  return (
    <div className="map-search">
      <input
        className="map-search__input"
        value={q}
        placeholder="Search places…"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        spellCheck={false}
      />

      {loading && trimmed && (
        <div className="map-search__loading">Searching…</div>
      )}

      {open && results.length > 0 && (
        <div className="map-search__results">
          {results.map((r) => (
            <button
              key={`${r.source_table}:${r.id}`}
              className="map-search__result"
              onMouseDown={(e) => e.preventDefault()} // keep focus so clicks register
              onClick={() => onPick(r)}
              title={formatSource(r.source_table)}
            >
              <div className="map-search__name">{r.display_name || '(no name)'}</div>
              <div className="map-search__meta">{formatSource(r.source_table)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
