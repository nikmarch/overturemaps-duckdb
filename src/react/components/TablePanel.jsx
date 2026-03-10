import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../lib/store.js';
import { getConn } from '../../lib/duckdb.js';

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
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}

// Columns to hide from the table (large/redundant for tabular view)
const HIDDEN_COLS = new Set(['geojson', 'geometry']);

export default function TablePanel({ onClose }) {
  // Use the same SQL the pipeline runner compiled (includes FTS resolution)
  const compiledSql = useStore(s => s.compiledSql);
  const sqlOverride = useStore(s => s.sqlOverride);

  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [elapsed, setElapsed] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sql = sqlOverride || compiledSql;

  const runQuery = useCallback(async () => {
    const conn = getConn();
    if (!conn) return;

    setLoading(true);
    setError(null);
    const t0 = performance.now();

    try {
      if (!sql) { setLoading(false); return; }

      const res = await conn.query(sql);
      const allRows = res.toArray();
      const allCols = res.schema?.fields?.map(f => f.name)
        ?? (allRows.length > 0 ? Object.keys(allRows[0]) : []);

      setColumns(allCols.filter(c => !HIDDEN_COLS.has(c)));
      setRows(allRows);
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError(e.message || String(e));
      setRows([]);
      setColumns([]);
      setElapsed(Math.round(performance.now() - t0));
    } finally {
      setLoading(false);
    }
  }, [sql]);

  useEffect(() => { runQuery(); }, [runQuery]);

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSort(col) {
    if (sortCol === col) {
      setSortAsc(a => !a);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  }

  const sortedRows = sortCol
    ? [...rows].sort((a, b) => {
        const va = a[sortCol], vb = b[sortCol];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
        const sa = String(va), sb = String(vb);
        return sortAsc ? sa.localeCompare(sb) : sb.localeCompare(sa);
      })
    : rows;

  return (
    <div className="table-panel-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="table-panel">
        <div className="table-panel-header">
          <span className="table-panel-title">Results</span>
          {!loading && rows.length > 0 && (
            <span className="table-panel-stats">
              {rows.length.toLocaleString()} rows
              {elapsed != null && ` \u00B7 ${elapsed < 1000 ? elapsed + 'ms' : (elapsed / 1000).toFixed(1) + 's'}`}
            </span>
          )}
          {loading && <span className="table-panel-stats">Loading...</span>}
          <button className="table-panel-close" onClick={onClose}>&times;</button>
        </div>

        {error && <div className="table-panel-error">{error}</div>}

        {!loading && rows.length === 0 && !error && (
          <div className="table-panel-empty">No results</div>
        )}

        {columns.length > 0 && (
          <div className="table-panel-scroll">
            <table className="table-panel-table">
              <thead>
                <tr>
                  {columns.map(c => (
                    <th key={c} onClick={() => handleSort(c)} className="table-panel-th">
                      {c}
                      {sortCol === c && (
                        <span className="table-panel-sort">{sortAsc ? ' \u25B2' : ' \u25BC'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr key={i}>
                    {columns.map(c => (
                      <td key={c} title={cellValue(row[c])}>{truncate(row[c])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
