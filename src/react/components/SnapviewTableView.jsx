import { useState, useEffect, useCallback } from 'react';
import { getConn } from '../../lib/duckdb.js';
import { getThemeColor } from '../../lib/themes.js';
import { useStore } from '../../lib/store.js';
import { buildNameFilterSql, tableHasFts } from '../../lib/fts.js';

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

function TableSection({ themeKey }) {
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const tableName = themeKey.replace('/', '_');
  const label = themeKey.split('/')[1];
  const color = getThemeColor(themeKey);
  const globalSearch = useStore(s => s.globalSearch);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const conn = getConn();
        if (!conn) throw new Error('No DB connection');
        const q = (useStore.getState().globalSearch || '').trim();
        let where = '';
        if (q) {
          const useFts = await tableHasFts(conn, tableName);
          where = `WHERE ${buildNameFilterSql(tableName, q, { useFts })}`;
        }
        const result = await conn.query(`SELECT * FROM "${tableName}" ${where} LIMIT 1000`);
        if (cancelled) return;
        const rows = result.toArray();
        const columns = result.schema?.fields?.map(f => f.name) ?? (rows.length > 0 ? Object.keys(rows[0]) : []);
        setData({ columns, rows });
      } catch (e) {
        if (!cancelled) setError(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tableName, globalSearch]);

  return (
    <div>
      <div className="sv-table-section-header" onClick={() => setExpanded(o => !o)}>
        <span className="sv-table-section-dot" style={{ background: color?.fill || '#999' }} />
        <span className="sv-table-section-name">{label}</span>
        {data && <span className="sv-table-section-count">{data.rows.length.toLocaleString()} rows</span>}
        <span className="sv-table-section-chevron">{expanded ? '▼' : '▶'}</span>
      </div>

      {expanded && loading && (
        <div className="sv-table-section-loading">Loading…</div>
      )}

      {expanded && error && (
        <div className="sv-table-section-error">{error}</div>
      )}

      {expanded && data && (
        <div className="sv-table-section-wrap">
          <table className="sv-query-table">
            <thead>
              <tr>{data.columns.map(c => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {data.columns.map(c => (
                    <td key={c} title={cellValue(row[c])}>{truncate(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SnapviewTableView({ sv, onClose }) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const shortKeys = sv.keys.map(k => k.split('/')[1]).join(', ');

  return (
    <div className="sv-table-overlay" onClick={onClose}>
      <div className="sv-table-overlay-inner" onClick={e => e.stopPropagation()}>
        <div className="sv-table-overlay-header">
          <span className="sv-table-overlay-title">{shortKeys}</span>
          <button className="sv-table-overlay-close" onClick={onClose}>&times;</button>
        </div>
        <div className="sv-table-overlay-body">
          {sv.keys.map(key => (
            <TableSection key={key} themeKey={key} />
          ))}
        </div>
      </div>
    </div>
  );
}
