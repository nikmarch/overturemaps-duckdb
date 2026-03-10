import { useMemo } from 'react';
import { useStore } from '../../lib/store.js';

function fmtMs(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function QueryStatusHud() {
  const list = useStore(s => s.queryStatus || []);

  const rows = useMemo(() => list.slice(0, 6), [list]);
  if (!rows.length) return null;

  return (
    <div className="query-hud">
      {rows.map(r => {
        const running = r.ok == null;
        const cls = running ? 'running' : (r.ok ? 'ok' : 'err');
        return (
          <div key={r.id} className={`query-hud__row ${cls}`} title={r.sqlPreview}>
            <span className="query-hud__label">{r.label}</span>
            <span className="query-hud__ms">{running ? '…' : fmtMs(r.ms)}</span>
          </div>
        );
      })}
    </div>
  );
}
