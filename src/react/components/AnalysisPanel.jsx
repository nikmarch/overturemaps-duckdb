import { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import { useStore } from '../../lib/store.js';
import { getConn } from '../../lib/duckdb.js';
import { getMap } from '../../lib/map.js';
import { getThemeColor, setThemeLayersVisible } from '../../lib/themes.js';
import { THEME_FIELDS } from '../../lib/constants.js';
import { renderFeature } from '../../lib/render.js';
import { buildShowQuery, buildQuery, buildMatchedBQuery } from '../../lib/analysisQueries.js';

const COLOR_A   = { fill: '#f97316', stroke: '#c2410c' };
const COLOR_B   = { fill: '#06b6d4', stroke: '#0e7490' };
const IXN_COLOR = '#7c3aed';

const MODES = [
  { id: 'show',      label: 'Show'      },
  { id: 'intersect', label: 'Intersect' },
  { id: 'within',    label: 'Within'    },
  { id: 'exclude',   label: 'Exclude'   },
];

// tableA is stored as "theme_type"; key is "theme/type" (first _ only)
function tableToKey(tableName) {
  return tableName.replace('_', '/');
}

function renderRows(rows, layer, color, keyHint = '') {
  const defs = THEME_FIELDS[keyHint] || [];
  const state = { key: keyHint, layer, markers: [] };
  let count = 0;
  for (const row of rows) {
    try {
      renderFeature(row, state, color, defs);
      count++;
    } catch { /* skip */ }
  }
  return count;
}

async function renderIntersectionGeoms(conn, tableA, tableB, layer) {
  const preFlt = `ABS(a.centroid_lon - b.centroid_lon) < 0.2 AND ABS(a.centroid_lat - b.centroid_lat) < 0.2`;
  try {
    const res = await conn.query(
      `SELECT ST_AsGeoJSON(ST_Intersection(a.geometry, b.geometry)) AS ixn_geojson\n` +
      `FROM "${tableA}" a JOIN "${tableB}" b\n` +
      `  ON ${preFlt} AND ST_Intersects(a.geometry, b.geometry)\nLIMIT 500`
    );
    for (const row of res.toArray()) {
      if (!row.ixn_geojson) continue;
      try {
        const geo = JSON.parse(row.ixn_geojson);
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
  const viewportCap = useStore(s => s.viewportCap);

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

  const [mode, setMode] = useState('show');
  const [tableA, setTableA] = useState('');
  const [tableB, setTableB] = useState('');
  const [distance, setDistance] = useState(100);
  const [sql, setSql] = useState('');
  const [sqlOpen, setSqlOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const layerRef = useRef(null);
  const timerRef = useRef(null);
  const startRef = useRef(null);

  // Seed tables on first load
  useEffect(() => {
    if (tables.length > 0 && !tableA) setTableA(tables[0].table);
    if (tables.length > 1 && !tableB) setTableB(tables[1].table);
    else if (tables.length === 1 && !tableB) setTableB(tables[0].table);
  }, [tables]); // eslint-disable-line react-hooks/exhaustive-deps

  // Regenerate SQL whenever controls change
  useEffect(() => {
    if (mode === 'show') {
      if (tables.length > 0) setSql(buildShowQuery(tables, viewportCap));
    } else {
      if (tableA) setSql(buildQuery(mode, tableA, tableB, distance, viewportCap));
    }
  }, [mode, tableA, tableB, distance, viewportCap, tables]);

  useEffect(() => () => {
    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
    if (timerRef.current) clearInterval(timerRef.current);
    setThemeLayersVisible(true);
  }, []);

  async function run() {
    const conn = getConn();
    if (!conn || !sql.trim()) return;

    setRunning(true);
    setError(null);
    setResult(null);
    startRef.current = performance.now();
    setElapsed(0);
    timerRef.current = setInterval(() => {
      setElapsed(Math.round(performance.now() - startRef.current));
    }, 100);

    if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
    setThemeLayersVisible(false);

    try {
      const layer = L.layerGroup().addTo(getMap());
      layerRef.current = layer;

      const res = await conn.query(sql);
      const rows = res.toArray();

      if (mode === 'show') {
        let count = 0;
        const bySource = {};
        for (const row of rows) {
          const src = row._source || '';
          (bySource[src] ||= []).push(row);
        }
        for (const [src, srcRows] of Object.entries(bySource)) {
          const c = getThemeColor(src) || COLOR_A;
          count += renderRows(srcRows, layer, c, src);
        }
        setResult({ count, total: rows.length, durationMs: Math.round(performance.now() - startRef.current) });
      } else {
        const keyA = tableToKey(tableA);
        const count = renderRows(rows, layer, COLOR_A, keyA);

        const bq = buildMatchedBQuery(mode, tableA, tableB, distance, viewportCap);
        if (bq && tableB !== tableA) {
          const bRes = await conn.query(bq);
          renderRows(bRes.toArray(), layer, COLOR_B, tableToKey(tableB));
        }

        if (mode === 'intersect') {
          await renderIntersectionGeoms(conn, tableA, tableB, layer);
        }

        setResult({ count, total: rows.length, durationMs: Math.round(performance.now() - startRef.current) });
      }
    } catch (e) {
      setError(e.message || String(e));
      setElapsed(Math.round(performance.now() - startRef.current));
      if (layerRef.current) { layerRef.current.remove(); layerRef.current = null; }
      setThemeLayersVisible(true);
    } finally {
      clearInterval(timerRef.current);
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

  const isSpatial = mode !== 'show';
  const needsDistance = mode === 'within' || mode === 'exclude';

  return (
    <div className="analysis-panel" onClick={e => e.stopPropagation()}>
      <div className="analysis-mode-bar">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`analysis-mode-tab ${mode === m.id ? 'active' : ''}`}
            onClick={() => setMode(m.id)}
          >{m.label}</button>
        ))}
        {result && (
          <button className="analysis-clear" onClick={clear} title="Clear results from map">
            ×&thinsp;{result.count.toLocaleString()}
          </button>
        )}
      </div>

      <div className="analysis-form">
        <div className="analysis-row">
          {isSpatial && (
            <>
              <select className="analysis-select" value={tableA} onChange={e => setTableA(e.target.value)}>
                {tables.map(t => <option key={t.table} value={t.table}>{t.label}</option>)}
              </select>
              <span className="analysis-connector">
                {mode === 'intersect' ? '∩' : mode === 'within' ? '⊂' : '∖'}
              </span>
              <select className="analysis-select" value={tableB} onChange={e => setTableB(e.target.value)}>
                {tables.map(t => <option key={t.table} value={t.table}>{t.label}</option>)}
              </select>
            </>
          )}
          {needsDistance && (
            <div className="analysis-distance">
              <input
                type="number" className="analysis-dist-input"
                value={distance} min={1} step={5}
                onChange={e => setDistance(Number(e.target.value))}
              />
              <span className="analysis-dist-unit">m</span>
            </div>
          )}
        </div>
      </div>

      <div className="analysis-sql-section">
        <button className="analysis-sql-toggle" onClick={() => setSqlOpen(o => !o)}>
          SQL {sqlOpen ? '▲' : '▼'}
        </button>
        {sqlOpen && (
          <textarea
            className="analysis-sql"
            value={sql}
            onChange={e => setSql(e.target.value)}
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
        {running && elapsed != null && (
          <span className="analysis-elapsed">{(elapsed / 1000).toFixed(1)}s</span>
        )}
        {!running && <span className="analysis-hint">Ctrl+Enter</span>}
        {error && <span className="analysis-error" title={error}>Error</span>}
        {result && !error && (
          <span className="analysis-count">
            {result.count.toLocaleString()} results
            {result.total !== result.count ? ` / ${result.total.toLocaleString()} rows` : ''}
            {' · '}{result.durationMs < 1000 ? `${result.durationMs}ms` : `${(result.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>
    </div>
  );
}
