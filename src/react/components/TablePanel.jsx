import { useState, useMemo, useEffect } from 'react';
import { useStore } from '../../lib/store.js';

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
  const rows = useStore(s => s.pipelineRows);
  const result = useStore(s => s.pipelineResult);
  const running = useStore(s => s.pipelineRunning);

  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  const columns = useMemo(() => {
    if (!rows || rows.length === 0) return [];
    return Object.keys(rows[0]).filter(c => !HIDDEN_COLS.has(c));
  }, [rows]);

  // Default sort by _score when search results arrive
  const hasScore = columns.includes('_score');
  useEffect(() => {
    if (hasScore && sortCol !== '_score') {
      setSortCol('_score');
      setSortAsc(false);
    } else if (!hasScore && sortCol === '_score') {
      setSortCol(null);
    }
  }, [hasScore]);

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

  const sortedRows = useMemo(() => {
    if (!rows) return [];
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va;
      const sa = String(va), sb = String(vb);
      return sortAsc ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
  }, [rows, sortCol, sortAsc]);

  const elapsed = result?.durationMs;

  return (
    <div className="table-panel-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="table-panel">
        <div className="table-panel-header">
          <span className="table-panel-title">Results</span>
          {!running && sortedRows.length > 0 && (
            <span className="table-panel-stats">
              {sortedRows.length.toLocaleString()} rows
              {elapsed != null && ` \u00B7 ${elapsed < 1000 ? elapsed + 'ms' : (elapsed / 1000).toFixed(1) + 's'}`}
            </span>
          )}
          {running && <span className="table-panel-stats">Loading...</span>}
          <button className="table-panel-close" onClick={onClose}>&times;</button>
        </div>

        {result?.error && <div className="table-panel-error">{result.error}</div>}

        {!running && sortedRows.length === 0 && !result?.error && (
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
