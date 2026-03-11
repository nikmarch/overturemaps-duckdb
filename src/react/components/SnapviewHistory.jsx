import { useState, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../../lib/store.js';
import { deleteSnapview, reloadFromMeta, clearCache } from '../../lib/controller.js';
import { getThemeColor, rerenderAllEnabled } from '../../lib/themes.js';
import { getMap } from '../../lib/map.js';
import AnalysisPanel from './AnalysisPanel.jsx';
import SnapviewTableView from './SnapviewTableView.jsx';

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

  const [panelOpen, setPanelOpen] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [tableViewSv, setTableViewSv] = useState(null);

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

  function toggleCard(sv) {
    const opening = expandedId !== sv.id;
    setExpandedId(prev => prev === sv.id ? null : sv.id);
    if (opening && sv.bbox) {
      const map = getMap();
      if (map) {
        map.fitBounds(
          [[sv.bbox.ymin, sv.bbox.xmin], [sv.bbox.ymax, sv.bbox.xmax]],
          { padding: [20, 20], animate: true },
        );
      }
    }
  }

  return (
    <>
      <div className={`snapview-panel${panelOpen ? '' : ' collapsed'}`}>
        {/* Panel header */}
        <div className="sv-panel-header" onClick={() => setPanelOpen(o => !o)}>
          <span className="sv-panel-toggle">{panelOpen ? '▼' : '▶'}</span>
          <span className="sv-panel-title">Snapviews</span>
          <span className="sv-panel-count">{sortedSnapviews.length}</span>
          <button
            className="sv-clear-cache-btn"
            title="Clear all cache"
            onClick={e => { e.stopPropagation(); clearCache(); }}
          >&#x1F5D1;</button>
        </div>

        {panelOpen && (
          <>
            <div className="snapview-list">
              {sortedSnapviews.map(sv => {
                const isDone = sv.status === 'done';
                const hasData = sv.hasData !== false;
                const isExpanded = expandedId === sv.id;

                return (
                  <div key={sv.id} className={`sv-card ${sv.status}${isExpanded ? ' expanded' : ''}`}>

                    {/* Header row — always visible, click to expand/collapse */}
                    <div
                      className={`sv-card-row${!hasData && !isDone ? '' : ''}`}
                      onClick={() => {
                        if (!hasData && isDone) {
                          reloadFromMeta(sv);
                        } else {
                          toggleCard(sv);
                        }
                      }}
                    >
                      {isDone && hasData && (
                        <span className="sv-card-chevron">{isExpanded ? '▼' : '▶'}</span>
                      )}

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
                        {isDone && !isExpanded && (
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

                    {/* Expanded content */}
                    {isExpanded && isDone && hasData && (
                      <>
                        {/* Per-theme meta chips */}
                        {sv.keys.length > 0 && (
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

                        {/* Actions row */}
                        <div className="sv-card-actions">
                          <button
                            className="sv-card-table-btn"
                            onClick={e => { e.stopPropagation(); setTableViewSv(sv); }}
                          >▤ Table</button>
                        </div>

                        {/* Analysis panel scoped to this snapview */}
                        <AnalysisPanel />
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Global cap slider */}
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
          </>
        )}
      </div>

      {/* Table view overlay */}
      {tableViewSv && (
        <SnapviewTableView sv={tableViewSv} onClose={() => setTableViewSv(null)} />
      )}
    </>
  );
}
