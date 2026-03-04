import { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { useStore } from '../../lib/store.js';
import { getConn } from '../../lib/duckdb.js';
import { getMap } from '../../lib/map.js';
import { getThemeColor, setThemeLayersVisible } from '../../lib/themes.js';

const RESULT_COLOR = '#f97316';   // orange — matched rows
const IXN_COLOR    = '#7c3aed';   // purple — ST_Intersection geometries

const MODES = [
  { id: 'intersect', label: 'Intersect' },
  { id: 'within',    label: 'Within'    },
  { id: 'exclude',   label: 'Exclude'   },
  { id: 'custom',    label: 'Custom'    },
];

function buildQuery(mode, tableA, tableB, distance, customSql) {
  if (mode === 'custom') return customSql;

  const cols    = 'a.id, a.display_name, a.geom_type, a.geojson, a.centroid_lon, a.centroid_lat';
  const geomA   = 'ST_GeomFromGeoJSON(a.geojson)';
  const geomB   = 'ST_GeomFromGeoJSON(b.geojson)';
  const distDeg = (distance / 111320).toFixed(6);
  const preFlt  = `ABS(a.centroid_lon - b.centroid_lon) < 0.2\n  AND ABS(a.centroid_lat - b.centroid_lat) < 0.2`;

  switch (mode) {
    case 'intersect':
      return `SELECT ${cols}\nFROM "${tableA}" a\nJOIN "${tableB}" b\n  ON ${preFlt}\n  AND ST_Intersects(${geomA}, ${geomB})\nLIMIT 2000`;
    case 'within':
      return `SELECT ${cols}\nFROM "${tableA}" a\nWHERE EXISTS (\n  SELECT 1 FROM "${tableB}" b\n  WHERE ${preFlt}\n    AND ST_Distance(${geomA}, ${geomB}) < ${distDeg}\n)\nLIMIT 2000`;
    case 'exclude':
      return `SELECT ${cols}\nFROM "${tableA}" a\nWHERE NOT EXISTS (\n  SELECT 1 FROM "${tableB}" b\n  WHERE ${preFlt}\n    AND ST_Distance(${geomA}, ${geomB}) < ${distDeg}\n)\nLIMIT 2000`;
    default:
      return '';
  }
}

// Render Table A / Table B as dimmed background context
async function renderContext(conn, tableName, fill, layer, cap = 2000) {
  const res = await conn.query(
    `SELECT geom_type, geojson, centroid_lon, centroid_lat FROM "${tableName}" LIMIT ${cap}`
  );
  for (const row of res.toArray()) {
    const gt = (row.geom_type || '').toUpperCase();
    try {
      if (gt.includes('POINT') && row.centroid_lat != null) {
        L.circleMarker([+row.centroid_lat, +row.centroid_lon], {
          radius: 3, fillColor: fill, color: fill, weight: 1, fillOpacity: 0.35, opacity: 0.4,
        }).addTo(layer);
      } else if (row.geojson) {
        L.geoJSON(JSON.parse(row.geojson), {
          style: { fillColor: fill, color: fill, weight: 1, fillOpacity: 0.08, opacity: 0.3 },
          pointToLayer: (_f, ll) => L.circleMarker(ll, {
            radius: 3, fillColor: fill, color: fill, weight: 1, fillOpacity: 0.35, opacity: 0.4,
          }),
        }).addTo(layer);
      }
    } catch { /* skip */ }
  }
}

// Render matched result rows highlighted in orange
function renderResults(rows, layer) {
  let count = 0;
  for (const row of rows) {
    try {
      if (row.geojson) {
        L.geoJSON(JSON.parse(typeof row.geojson === 'string' ? row.geojson : String(row.geojson)), {
          style: { color: RESULT_COLOR, fillColor: RESULT_COLOR, weight: 2, fillOpacity: 0.45, opacity: 0.9 },
          pointToLayer: (_f, ll) => L.circleMarker(ll, {
            radius: 5, fillColor: RESULT_COLOR, color: '#fff', weight: 1.5, fillOpacity: 0.95,
          }),
        }).addTo(layer);
        count++;
      } else if (row.centroid_lon != null && row.centroid_lat != null) {
        L.circleMarker([+row.centroid_lat, +row.centroid_lon], {
          radius: 5, fillColor: RESULT_COLOR, color: '#fff', weight: 1.5, fillOpacity: 0.95,
        }).addTo(layer);
        count++;
      }
    } catch { /* skip */ }
  }
  return count;
}

// For Intersect mode: compute and render the actual intersection geometries
async function renderIntersectionGeoms(conn, tableA, tableB, layer) {
  const geomA  = 'ST_GeomFromGeoJSON(a.geojson)';
  const geomB  = 'ST_GeomFromGeoJSON(b.geojson)';
  const preFlt = `ABS(a.centroid_lon - b.centroid_lon) < 0.2 AND ABS(a.centroid_lat - b.centroid_lat) < 0.2`;
  try {
    const res = await conn.query(
      `SELECT ST_AsGeoJSON(ST_Intersection(${geomA}, ${geomB})) AS ixn_geojson\n` +
      `FROM "${tableA}" a JOIN "${tableB}" b\n` +
      `  ON ${preFlt} AND ST_Intersects(${geomA}, ${geomB})\nLIMIT 500`
    );
    for (const row of res.toArray()) {
      if (!row.ixn_geojson) continue;
      try {
        const geo = JSON.parse(row.ixn_geojson);
        // Skip empty or point-only intersections
        if (!geo || geo.type === 'Point' || geo.type === 'MultiPoint') continue;
        if (geo.type === 'GeometryCollection' && !geo.geometries?.length) continue;
        L.geoJSON(geo, {
          style: { fillColor: IXN_COLOR, color: IXN_COLOR, weight: 2, fillOpacity: 0.45, opacity: 0.85 },
        }).addTo(layer);
      } catch { /* skip unparseable */ }
    }
  } catch { /* ST_Intersection may not apply to all geometry combos */ }
}

export default function AnalysisPanel() {
  const snapviews = useStore(s => s.snapviews);

  const tables = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const sv of snapviews) {
      if (sv.status === 'done' && sv.hasData !== false) {
        for (const key of sv.keys) {
          const t = key.replace('/', '_');
          if (!seen.has(t)) {
            seen.add(t);
            result.push({ key, table: t, label: key.split('/')[1], color: getThemeColor(key) });
          }
        }
      }
    }
    return result;
  }, [snapviews]);

  const [mode, setMode] = useState('intersect');
  const [tableA, setTableA] = useState('');
  const [tableB, setTableB] = useState('');
  const [distance, setDistance] = useState(100);
  const [customSql, setCustomSql] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (tables.length > 0 && !tableA) setTableA(tables[0].table);
    if (tables.length > 1 && !tableB) setTableB(tables[1].table);
    else if (tables.length === 1 && !tableB) setTableB(tables[0].table);
  }, [tables]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
    setThemeLayersVisible(true);
  }, []);

  function handleModeChange(m) {
    if (m === 'custom' && mode !== 'custom') {
      setCustomSql(buildQuery(mode, tableA, tableB, distance, ''));
      setSqlOpen(true);
    }
    setMode(m);
  }

  async function run() {
    const conn = getConn();
    const q = buildQuery(mode, tableA, tableB, distance, customSql);
    if (!conn || !q.trim()) return;

    setRunning(true);
    setError(null);
    setResult(null);

    // Clear previous layer
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }

    const isPreset = mode !== 'custom';
    if (isPreset) setThemeLayersVisible(false);

    try {
      const layer = L.layerGroup().addTo(getMap());
      layerRef.current = layer;

      if (isPreset) {
        // Render Table A and Table B as dimmed context
        const colorA = tables.find(t => t.table === tableA)?.color || { fill: '#888' };
        const colorB = tables.find(t => t.table === tableB)?.color || { fill: '#888' };
        await renderContext(conn, tableA, colorA.fill, layer);
        if (tableB !== tableA) await renderContext(conn, tableB, colorB.fill, layer);
      }

      // Run main query → highlighted results
      const res = await conn.query(q);
      const rows = res.toArray();
      const count = renderResults(rows, layer);

      // Intersect mode: also draw the actual intersection geometries
      if (mode === 'intersect') {
        await renderIntersectionGeoms(conn, tableA, tableB, layer);
      }

      setResult({ count, total: rows.length });
    } catch (e) {
      setError(e.message || String(e));
      if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
      if (isPreset) setThemeLayersVisible(true);
    } finally {
      setRunning(false);
    }
  }

  function clear() {
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
    setThemeLayersVisible(true);
    setResult(null);
    setError(null);
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  }

  if (tables.length === 0) return null;

  const isCustom = mode === 'custom';
  const needsDistance = mode === 'within' || mode === 'exclude';
  const displaySql = isCustom ? customSql : buildQuery(mode, tableA, tableB, distance, '');

  return (
    <div className="analysis-panel" onClick={e => e.stopPropagation()}>
      <div className="analysis-mode-bar">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`analysis-mode-tab ${mode === m.id ? 'active' : ''}`}
            onClick={() => handleModeChange(m.id)}
          >{m.label}</button>
        ))}
        {result && (
          <button className="analysis-clear" onClick={clear} title="Clear results from map">
            ×&thinsp;{result.count.toLocaleString()}
          </button>
        )}
      </div>

      {!isCustom && (
        <div className="analysis-form">
          <div className="analysis-row">
            <select className="analysis-select" value={tableA} onChange={e => setTableA(e.target.value)}>
              {tables.map(t => <option key={t.table} value={t.table}>{t.label}</option>)}
            </select>
            <span className="analysis-connector">
              {mode === 'intersect' ? '∩' : mode === 'within' ? '⊂' : '∖'}
            </span>
            <select className="analysis-select" value={tableB} onChange={e => setTableB(e.target.value)}>
              {tables.map(t => <option key={t.table} value={t.table}>{t.label}</option>)}
            </select>
            {needsDistance && (
              <div className="analysis-distance">
                <input
                  type="number" className="analysis-dist-input"
                  value={distance} min={1} step={50}
                  onChange={e => setDistance(Number(e.target.value))}
                />
                <span className="analysis-dist-unit">m</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="analysis-sql-section">
        <button className="analysis-sql-toggle" onClick={() => setSqlOpen(o => !o)}>
          SQL {sqlOpen ? '▲' : '▼'}
        </button>
        {sqlOpen && (
          <textarea
            className={`analysis-sql${isCustom ? '' : ' readonly'}`}
            value={displaySql}
            onChange={isCustom ? e => setCustomSql(e.target.value) : undefined}
            readOnly={!isCustom}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            rows={5}
          />
        )}
      </div>

      <div className="analysis-footer">
        <button className="analysis-run" onClick={run} disabled={running}>
          {running ? '…' : '▶ Run'}
        </button>
        <span className="analysis-hint">Ctrl+Enter</span>
        {error && <span className="analysis-error" title={error}>Error</span>}
        {result && !error && (
          <span className="analysis-count">
            {result.count.toLocaleString()} results
            {result.total !== result.count ? ` / ${result.total.toLocaleString()} rows` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
