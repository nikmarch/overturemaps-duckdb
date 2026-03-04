import { useRef, useCallback, useMemo } from 'react';
import { useStore } from '../../lib/store.js';
import { deleteSnapview, reloadFromMeta } from '../../lib/controller.js';
import { getThemeColor, rerenderAllEnabled } from '../../lib/themes.js';
import AnalysisPanel from './AnalysisPanel.jsx';

function formatTs(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (!ms) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function shortKeys(keys) {
  return keys.map(k => k.split('/')[1]).join(', ');
}

function progressPct(sv) {
  if (!sv.progress || sv.progress.total === 0) return 0;
  return (sv.progress.loaded / sv.progress.total) * 100;
}

export default function SnapviewHistory() {
  const snapviews = useStore(s => s.snapviews);
  const viewportCap = useStore(s => s.viewportCap);
  const themeUi = useStore(s => s.themeUi);

  const sortedSnapviews = useMemo(
    () => [...snapviews].sort((a, b) => b.ts - a.ts),
    [snapviews],
  );

  const capTimerRef = useRef(null);
  const handleCapChange = useCallback((value) => {
    useStore.setState({ viewportCap: value });
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    capTimerRef.current = setTimeout(() => rerenderAllEnabled(value), 300);
  }, []);

  const hasLiveData = sortedSnapviews.some(sv => sv.status === 'done' && sv.hasData !== false);

  if (sortedSnapviews.length === 0) return null;

  return (
    <div className="snapview-panel">
      <div className="snapview-list">
        {sortedSnapviews.map(sv => {
          const isDone = sv.status === 'done';
          const hasData = sv.hasData !== false;

          return (
            <div key={sv.id} className={`sv-card ${sv.status}`}>

              {/* ── Header row ── */}
              <div
                className={`sv-card-row${!hasData ? ' clickable' : ''}`}
                role={!hasData ? 'button' : undefined}
                tabIndex={!hasData ? 0 : undefined}
                onClick={!hasData ? () => reloadFromMeta(sv) : undefined}
                onKeyDown={!hasData ? (e => e.key === 'Enter' && reloadFromMeta(sv)) : undefined}
                title={!hasData ? 'Click to reload this area' : undefined}
              >
                <div className="sv-card-dots">
                  {sv.keys.slice(0, 4).map(key => (
                    <span
                      key={key}
                      className={`sv-dot${sv.status === 'loading' ? ' pulse' : ''}`}
                      style={{ background: getThemeColor(key)?.fill || '#999' }}
                    />
                  ))}
                </div>

                <div className="sv-card-info">
                  <span className="sv-card-keys">{shortKeys(sv.keys)}</span>

                  {sv.status === 'loading' && (
                    <div className="sv-card-progress">
                      <div className="sv-card-progress-fill" style={{ width: `${progressPct(sv)}%` }} />
                      <span className="sv-card-progress-text">{sv.progress.loaded}/{sv.progress.total}</span>
                    </div>
                  )}
                  {sv.status === 'error' && (
                    <span className="sv-card-sub error">{sv.error || 'error'}</span>
                  )}
                  {isDone && (
                    <span className="sv-card-sub">
                      {sv.totalRows != null && `${sv.totalRows.toLocaleString()} · `}
                      {formatDuration(sv.totalTimeMs)}
                      {sv.totalTimeMs ? ' · ' : ''}
                      {formatTs(sv.ts)}
                      {!hasData ? ' · saved' : ''}
                    </span>
                  )}
                </div>

                <button
                  className="sv-card-delete"
                  onClick={e => { e.stopPropagation(); deleteSnapview(sv.id); }}
                >&times;</button>
              </div>

              {/* ── Per-theme meta chips (always visible) ── */}
              {isDone && hasData && sv.keys.length > 0 && (
                <div className="sv-card-meta">
                  {sv.keys.map(key => {
                    const color = getThemeColor(key);
                    const live = themeUi[key]?.rowCount;
                    const stored = sv.themeStats[key]?.rowCount;
                    const count = live ?? stored;
                    return (
                      <span key={key} className="sv-meta-chip">
                        <span className="sv-meta-dot" style={{ background: color?.fill || '#999' }} />
                        {key.split('/')[1]}
                        {count != null && <span className="sv-meta-count">{count.toLocaleString()}</span>}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Global cap slider ── */}
      {hasLiveData && (
        <div className="sv-cap-row">
          <span className="sv-cap-label">Cap</span>
          <input
            type="range" className="sv-cap-slider"
            min="500" max="50000" step="500"
            value={viewportCap}
            onChange={e => handleCapChange(parseInt(e.target.value, 10))}
          />
          <span className="sv-cap-value">{viewportCap.toLocaleString()}</span>
        </div>
      )}

      {/* ── Analysis panel ── */}
      <AnalysisPanel />
    </div>
  );
}
