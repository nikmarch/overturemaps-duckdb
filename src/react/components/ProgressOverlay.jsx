import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../lib/store.js';

const QUIPS = [
  'Crunching parquet files...',
  'DuckDB is doing its best...',
  'Your browser is a database now...',
  'SELECT patience FROM user LIMIT 1...',
  'Turning cloud data into map dots...',
  'WebAssembly goes brrr...',
];

function pickQuip(prev) {
  let q;
  do { q = QUIPS[Math.floor(Math.random() * QUIPS.length)]; } while (q === prev && QUIPS.length > 1);
  return q;
}

function ElapsedTimer() {
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(performance.now());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.round((performance.now() - t0.current) / 100) / 10), 100);
    return () => clearInterval(id);
  }, []);
  return <span className="progress-elapsed">{elapsed.toFixed(1)}s</span>;
}

export default function ProgressOverlay() {
  const status = useStore(s => s.status);
  const pipelineRunning = useStore(s => s.pipelineRunning);
  const themeUi = useStore(s => s.themeUi);

  const [quip, setQuip] = useState('');
  const intervalRef = useRef(null);

  // Compute loading themes
  const loadingThemes = Object.entries(themeUi)
    .filter(([, ui]) => ui.loading)
    .map(([key, ui]) => ({ key, label: key.split('/')[1], ...ui }));

  const isDataLoading = loadingThemes.length > 0;
  const isVisible = isDataLoading || pipelineRunning;

  // Rotate quips during data loading
  useEffect(() => {
    if (isDataLoading) {
      setQuip(pickQuip(''));
      intervalRef.current = setInterval(() => setQuip(prev => pickQuip(prev)), 4000);
    } else {
      clearInterval(intervalRef.current);
      setQuip('');
    }
    return () => clearInterval(intervalRef.current);
  }, [isDataLoading]);

  if (!isVisible) return null;

  return (
    <div className="progress-overlay">
      <div className="progress-card">
        {/* Data loading section */}
        {isDataLoading && (
          <div className="progress-section">
            <div className="progress-section-header">
              <div className="progress-spinner" />
              <span className="progress-title">Loading data</span>
            </div>
            {loadingThemes.map(t => {
              const pct = t.filesTotal > 0
                ? Math.round((t.filesLoaded || 0) / t.filesTotal * 100)
                : 0;
              return (
                <div key={t.key} className="progress-theme">
                  <span className="progress-theme-name">{t.label}</span>
                  <div className="progress-bar">
                    <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="progress-theme-pct">
                    {t.metaText || (t.filesTotal > 0 ? `${t.filesLoaded || 0}/${t.filesTotal}` : '')}
                  </span>
                </div>
              );
            })}
            {quip && <div className="progress-quip">{quip}</div>}
          </div>
        )}

        {/* Pipeline query section */}
        {pipelineRunning && (
          <div className="progress-section">
            <div className="progress-section-header">
              <div className="progress-spinner" />
              <span className="progress-title">Running query</span>
              <ElapsedTimer />
            </div>
          </div>
        )}

        {/* Init / other status messages */}
        {!isDataLoading && !pipelineRunning && status.type === 'loading' && (
          <div className="progress-section">
            <div className="progress-section-header">
              <div className="progress-spinner" />
              <span className="progress-title">{status.text}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
