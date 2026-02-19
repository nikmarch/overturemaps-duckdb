import { useState, useMemo, useRef, useCallback } from 'react';
import { useStore, updateSnapviewCap } from '../../lib/store.js';
import { restoreSnapview, deleteSnapview, toggleSnapviewTheme, setHighlightIntersections, onSnapviewCapChange, refreshViewport } from '../../lib/controller.js';
import { getThemeColor } from '../../lib/themes.js';

function formatTs(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${time} ${date}`;
}

function formatDuration(ms) {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function shortKeys(keys) {
  return keys.map(k => k.split('/')[1]).join(', ');
}

function progressPct(sv) {
  if (!sv.progress || sv.progress.total === 0) return 0;
  return (sv.progress.loaded / sv.progress.total) * 100;
}

function progressText(sv) {
  if (!sv.progress) return '';
  const p = sv.progress;
  const currentType = p.currentKey ? p.currentKey.split('/')[1] : '';
  const ts = sv.themeStats[p.currentKey];
  let fileInfo = '';
  if (ts && ts.filesTotal) {
    fileInfo = ` (${ts.filesLoaded || 0}/${ts.filesTotal} files)`;
  }
  return `Loading ${currentType}${fileInfo}`;
}

function statsText(sv) {
  const parts = [];
  if (sv.totalRows != null) parts.push(`${sv.totalRows.toLocaleString()} rows`);
  if (sv.totalFiles != null && sv.totalFiles > 0) parts.push(`${sv.totalFiles} files`);
  return parts.join(' \u00b7 ');
}

export default function SnapviewHistory() {
  const [expandedId, setExpandedId] = useState(null);
  const snapviews = useStore(s => s.snapviews);
  const sortedSnapviews = useMemo(
    () => [...snapviews].sort((a, b) => b.ts - a.ts),
    [snapviews],
  );
  const activeSnapview = useStore(s => s.activeSnapview);
  const themeUi = useStore(s => s.themeUi);
  const highlightIntersections = useStore(s => s.highlightIntersections);

  function handleDelete(e, svId) {
    e.stopPropagation();
    if (expandedId === svId) setExpandedId(null);
    deleteSnapview(svId);
  }

  function handleHeaderClick(sv) {
    setExpandedId(expandedId === sv.id ? null : sv.id);
  }

  function handleThemeToggle(e, sv, key) {
    e.stopPropagation();
    const checked = e.target.checked;
    toggleSnapviewTheme(sv.id, key, checked);
  }

  function handleRestore(e, sv) {
    e.stopPropagation();
    restoreSnapview(sv);
  }

  function handleIntersections(e) {
    e.stopPropagation();
    setHighlightIntersections(!highlightIntersections);
  }

  function themeRowCount(sv, key) {
    // Prefer live themeUi rowCount (updated after cap changes / re-renders)
    const live = themeUi[key]?.rowCount;
    if (live != null) return live.toLocaleString();
    // Fall back to snapview's static themeStats
    const ts = sv.themeStats[key];
    if (ts && ts.rowCount != null) return ts.rowCount.toLocaleString();
    return '?';
  }

  // Debounced cap change: update store immediately for slider feedback,
  // but only trigger expensive re-render after user stops dragging
  const capTimerRef = useRef(null);
  const handleCapChange = useCallback((svId, value) => {
    // Immediate store update so slider moves smoothly
    updateSnapviewCap(svId, value);
    // Debounce the expensive re-render
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    capTimerRef.current = setTimeout(() => {
      onSnapviewCapChange(svId, value);
    }, 300);
  }, []);

  if (sortedSnapviews.length === 0) return null;

  return (
    <div className="snapview-panel">
      <div className="snapview-panel-header">
        <span className="snapview-panel-title">Snapviews</span>
        <span className="snapview-badge">{sortedSnapviews.length}</span>
      </div>
      <div className="snapview-list">
        {sortedSnapviews.map(sv => {
          const isExpanded = expandedId === sv.id;
          const itemClasses = [
            'snapview-item',
            activeSnapview === sv.id ? 'active' : '',
            sv.status === 'loading' ? 'loading' : '',
            sv.status === 'error' ? 'error' : '',
            isExpanded ? 'expanded' : '',
          ].filter(Boolean).join(' ');

          return (
            <div key={sv.id} className={itemClasses}>
              <div
                className="snapview-header"
                role="button"
                tabIndex={0}
                onClick={() => handleHeaderClick(sv)}
                onKeyDown={(e) => e.key === 'Enter' && handleHeaderClick(sv)}
              >
                <div className="snapview-dots">
                  {sv.keys.slice(0, 4).map(key => {
                    const color = getThemeColor(key);
                    return (
                      <span
                        key={key}
                        className={`snapview-dot ${sv.status === 'loading' ? 'pulse' : ''}`}
                        style={{ background: color?.fill || '#999' }}
                      />
                    );
                  })}
                </div>
                <span className="snapview-info">
                  <span className="snapview-keys">{shortKeys(sv.keys)}</span>

                  {sv.status === 'loading' && (
                    <>
                      <div className="snapview-progress">
                        <div className="snapview-progress-bar" style={{ width: `${progressPct(sv)}%` }} />
                        <span className="snapview-progress-text">
                          {sv.progress.loaded}/{sv.progress.total} themes
                        </span>
                      </div>
                      <span className="snapview-loading-detail">{progressText(sv)}</span>
                    </>
                  )}
                  {sv.status === 'error' && (
                    <span className="snapview-error-text">Error: {sv.error || 'unknown'}</span>
                  )}
                  {sv.status === 'done' && (
                    <span className="snapview-stats">
                      {statsText(sv)} &middot; {formatDuration(sv.totalTimeMs)} &middot; {formatTs(sv.ts)}
                    </span>
                  )}
                </span>
                {sv.status === 'done' && (
                  <button
                    className="snapview-refresh-btn"
                    title="Re-render for current viewport (uses cached data)"
                    onClick={(e) => { e.stopPropagation(); refreshViewport(sv.id); }}
                  >&#x21bb;</button>
                )}
                <button
                  className="snapview-delete-btn"
                  title="Delete snapview"
                  onClick={(e) => handleDelete(e, sv.id)}
                >&times;</button>
              </div>

              {isExpanded && sv.status === 'done' && (
                <div className="snapview-expanded">
                  <div className="snapview-theme-list">
                    {sv.keys.map(key => {
                      const color = getThemeColor(key);
                      const enabled = themeUi[key]?.enabled ?? false;
                      return (
                        <label key={key} className="snapview-theme-row" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => handleThemeToggle(e, sv, key)}
                          />
                          <span className="snapview-theme-dot" style={{ background: color?.fill || '#999' }} />
                          <span className="snapview-theme-name">{key.split('/')[1]}</span>
                          <span className="snapview-theme-count">{themeRowCount(sv, key)} rows</span>
                        </label>
                      );
                    })}
                  </div>
                  <div className="snapview-cap-row" onClick={(e) => e.stopPropagation()}>
                    <span className="snapview-cap-label">Cap</span>
                    <input
                      type="range"
                      className="snapview-cap-slider"
                      min="500"
                      max="50000"
                      step="500"
                      value={sv.cap || 3000}
                      onChange={(e) => handleCapChange(sv.id, parseInt(e.target.value, 10))}
                    />
                    <span className="snapview-cap-value">{(sv.cap || 3000).toLocaleString()}</span>
                  </div>
                  <div className="snapview-actions">
                    <button className="snapview-action-btn" onClick={(e) => handleRestore(e, sv)}>
                      Restore viewport
                    </button>
                    <button
                      className={`snapview-action-btn ${highlightIntersections ? 'active-toggle' : ''}`}
                      onClick={handleIntersections}
                    >
                      {highlightIntersections ? 'Hide' : 'Show'} intersections
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
