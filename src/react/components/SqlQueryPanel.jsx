import { useState, useCallback, useRef, useEffect } from 'react';
import L from 'leaflet';
import { getConn } from '../../lib/duckdb.js';
import { getMap, getBbox } from '../../lib/map.js';

function tableNameForKey(key) {
  return key.replace('/', '_');
}

function defaultQuery(sv) {
  if (!sv?.keys?.length) return 'SHOW TABLES';
  const tables = sv.keys.map(tableNameForKey);
  const cap = sv.cap || 3000;
  const bbox = getBbox();
  const where =
    `WHERE centroid_lon >= ${bbox.xmin} AND centroid_lon <= ${bbox.xmax}\n  ` +
    `AND centroid_lat >= ${bbox.ymin} AND centroid_lat <= ${bbox.ymax}`;

  if (tables.length === 1) {
    return (
      `SELECT id, display_name, geom_type, geojson, centroid_lon, centroid_lat\n` +
      `FROM "${tables[0]}"\n` +
      `${where}\n` +
      `LIMIT ${cap}`
    );
  }

  const perTable = Math.ceil(cap / tables.length);
  return tables
    .map(t =>
      `(SELECT id, display_name, geom_type, geojson, centroid_lon, centroid_lat, '${t}' AS source\n` +
      ` FROM "${t}"\n` +
      ` ${where}\n` +
      ` LIMIT ${perTable})`
    )
    .join('\nUNION ALL\n');
}

function cellValue(val) {
  if (val == null) return '';
  if (typeof val === 'bigint') return String(val);
  if (val instanceof Uint8Array || ArrayBuffer.isView(val)) return '[binary]';
  if (typeof val === 'object') {
    try { return JSON.stringify(val); } catch { return '[object]'; }
  }
  return String(val);
}

function truncate(val, max = 120) {
  const s = cellValue(val);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export default function SqlQueryPanel({ sv, onClose }) {
  const [query, setQuery] = useState(() => defaultQuery(sv));
  const [results, setResults] = useState(null);
  const [mode, setMode] = useState('table');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [mapCount, setMapCount] = useState(0);
  const [editorOpen, setEditorOpen] = useState(true);
  const queryLayerRef = useRef(null);

  function clearMapLayer() {
    if (queryLayerRef.current) {
      queryLayerRef.current.remove();
      queryLayerRef.current = null;
    }
    setMapCount(0);
  }

  useEffect(() => () => clearMapLayer(), []);

  function renderRowsOnMap(rows) {
    clearMapLayer();
    const map = getMap();
    if (!map) return 0;
    const layer = L.layerGroup().addTo(map);
    queryLayerRef.current = layer;
    const fill = '#e74c3c';
    let count = 0;
    for (const row of rows) {
      try {
        if (row.geojson) {
          L.geoJSON(JSON.parse(cellValue(row.geojson)), {
            style: { color: fill, fillColor: fill, weight: 1.5, fillOpacity: 0.25, opacity: 0.8 },
            pointToLayer: (_f, latlng) =>
              L.circleMarker(latlng, { radius: 4, fillColor: fill, color: fill, weight: 1, fillOpacity: 0.9 }),
          }).addTo(layer);
          count++;
        } else if (row.centroid_lon != null && row.centroid_lat != null) {
          L.circleMarker([Number(row.centroid_lat), Number(row.centroid_lon)], {
            radius: 4, fillColor: fill, color: fill, weight: 1, fillOpacity: 0.9,
          }).addTo(layer);
          count++;
        }
      } catch { /* skip bad rows */ }
    }
    setMapCount(count);
    return count;
  }

  const runQuery = useCallback(async () => {
    const conn = getConn();
    if (!conn || !query.trim()) return;
    setRunning(true);
    setError(null);
    clearMapLayer();
    try {
      const result = await conn.query(query);
      const rows = result.toArray();
      const columns = result.schema?.fields?.map(f => f.name) ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
      const newResults = { columns, rows };
      setResults(newResults);
      if (mode === 'map') renderRowsOnMap(rows);
      setEditorOpen(false);
    } catch (e) {
      setError(e.message || String(e));
      setResults(null);
    } finally {
      setRunning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode]);

  function handleModeSwitch(newMode) {
    setMode(newMode);
    if (newMode === 'map' && results) renderRowsOnMap(results.rows);
    else if (newMode === 'table') clearMapLayer();
  }

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }

  const tables = (sv?.keys ?? []).map(tableNameForKey);
  const hasResults = results || error;

  return (
    <div className="sv-query" onClick={e => e.stopPropagation()}>

      {/* ── Editor ── */}
      <div className="sv-query-editor-header" onClick={() => setEditorOpen(o => !o)}>
        <span className="sv-query-sql-label">SQL</span>
        <span className="sv-query-tables-hint">{tables.join(', ')}</span>
        <span className="sv-query-chevron">{editorOpen ? '▲' : '▼'}</span>
        <button
          className="sv-query-close"
          title="Close"
          onClick={e => { e.stopPropagation(); onClose(); }}
        >&times;</button>
      </div>

      {editorOpen && (
        <div className="sv-query-editor-body">
          <textarea
            className="sv-query-textarea"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            rows={6}
            placeholder="SELECT * FROM ..."
          />
          <div className="sv-query-run-row">
            <button className="sv-query-run" onClick={runQuery} disabled={running}>
              {running ? 'Running…' : '▶ Run'}
            </button>
            <span className="sv-query-shortcut">Ctrl+Enter</span>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {hasResults && (
        <div className="sv-query-results-section">
          <div className="sv-query-mode-bar">
            <button
              className={`sv-query-mode-tab ${mode === 'table' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('table')}
            >
              <span className="sv-query-mode-icon">▤</span> Table
              {results && mode === 'table' && (
                <span className="sv-query-mode-count">{results.rows.length.toLocaleString()}</span>
              )}
            </button>
            <button
              className={`sv-query-mode-tab ${mode === 'map' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('map')}
            >
              <span className="sv-query-mode-icon">◉</span> Map
              {results && mode === 'map' && mapCount > 0 && (
                <span className="sv-query-mode-count">{mapCount.toLocaleString()}</span>
              )}
            </button>
          </div>

          {error && <div className="sv-query-error">{error}</div>}

          {results && mode === 'table' && (
            <div className="sv-query-table-wrap">
              <table className="sv-query-table">
                <thead>
                  <tr>{results.columns.map(c => <th key={c}>{c}</th>)}</tr>
                </thead>
                <tbody>
                  {results.rows.map((row, i) => (
                    <tr key={i}>
                      {results.columns.map(c => (
                        <td key={c} title={cellValue(row[c])}>{truncate(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {results && mode === 'map' && (
            <div className="sv-query-map-status">
              {mapCount > 0
                ? `${mapCount.toLocaleString()} of ${results.rows.length.toLocaleString()} rows rendered on map`
                : 'No renderable rows — need geojson or centroid_lon/centroid_lat columns'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
