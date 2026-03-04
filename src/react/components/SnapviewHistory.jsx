import { useState, useMemo, useRef, useCallback } from 'react';
import { useStore, updateSnapviewCap } from '../../lib/store.js';
import { deleteSnapview, toggleSnapviewTheme, onSnapviewCapChange, reloadFromMeta } from '../../lib/controller.js';
import { getThemeColor } from '../../lib/themes.js';
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
  const [expandedId, setExpandedId] = useState(null);
  const snapviews = useStore(s => s.snapviews);
  const sortedSnapviews = useMemo(
    () => [...snapviews].sort((a, b) => b.ts - a.ts),
    [snapviews],
  );
  const themeUi = useStore(s => s.themeUi);

  const capTimerRef = useRef(null);
  const handleCapChange = useCallback((svId, value) => {
    updateSnapviewCap(svId, value);
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    capTimerRef.current = setTimeout(() => onSnapviewCapChange(svId, value), 300);
  }, []);

  function handleCardClick(sv) {
    if (sv.hasData === false) {
      reloadFromMeta(sv);
      return;
    }
    setExpandedId(expandedId === sv.id ? null : sv.id);
  }

  if (sortedSnapviews.length === 0) return null;

  return (
    <div className="snapview-panel">
      <div className="snapview-list">
        {sortedSnapviews.map(sv => {
          const isExpanded = expandedId === sv.id;
          const isDone = sv.status === 'done';
          const hasData = sv.hasData !== false;

          return (
            <div key={sv.id} className={`sv-card ${sv.status}${isExpanded ? ' expanded' : ''}`}>

              {/* ── Header row ── */}
              <div
                className="sv-card-row"
                role="button"
                tabIndex={0}
                onClick={() => handleCardClick(sv)}
                onKeyDown={e => e.key === 'Enter' && handleCardClick(sv)}
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

              {/* ── Expanded: theme toggles + cap ── */}
              {isExpanded && isDone && hasData && (
                <div className="sv-card-expanded" onClick={e => e.stopPropagation()}>
                  {sv.keys.map(key => {
                    const color = getThemeColor(key);
                    const enabled = themeUi[key]?.enabled ?? false;
                    const ts = sv.themeStats[key];
                    const live = themeUi[key]?.rowCount;
                    const count = live ?? ts?.rowCount;
                    return (
                      <label key={key} className="sv-theme-row">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={e => toggleSnapviewTheme(sv.id, key, e.target.checked)}
                        />
                        <span className="sv-theme-dot" style={{ background: color?.fill || '#999' }} />
                        <span className="sv-theme-name">{key.split('/')[1]}</span>
                        {count != null && <span className="sv-theme-count">{count.toLocaleString()}</span>}
                      </label>
                    );
                  })}
                  <div className="sv-cap-row">
                    <span className="sv-cap-label">Cap</span>
                    <input
                      type="range" className="sv-cap-slider"
                      min="500" max="50000" step="500"
                      value={sv.cap || 3000}
                      onChange={e => handleCapChange(sv.id, parseInt(e.target.value, 10))}
                    />
                    <span className="sv-cap-value">{(sv.cap || 3000).toLocaleString()}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Global analysis panel — appears when any snapview has live data ── */}
      <AnalysisPanel />
    </div>
  );
}
