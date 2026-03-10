import { useState, useCallback } from 'react';
import { useStore } from '../../lib/store.js';
import { runPipeline } from '../../lib/pipelineRunner.js';

export default function SqlPanel() {
  const compiledSql = useStore(s => s.compiledSql);
  const sqlOverride = useStore(s => s.sqlOverride);
  const running = useStore(s => s.pipelineRunning);
  const pipeline = useStore(s => s.pipeline);

  const [open, setOpen] = useState(false);

  const sql = sqlOverride ?? compiledSql;
  const isOverridden = sqlOverride != null;

  const handleChange = useCallback((e) => {
    useStore.setState({ sqlOverride: e.target.value });
  }, []);

  const handleReset = useCallback(() => {
    useStore.setState({ sqlOverride: null });
  }, []);

  const handleRun = useCallback(() => {
    runPipeline();
  }, []);

  function handleKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  }

  if (pipeline.length === 0 && !compiledSql) return null;

  return (
    <>
      <button
        className={`sql-panel-btn${open ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        title="Show SQL"
      >
        SQL
      </button>

      {open && (
        <div className="sql-panel">
          <div className="sql-panel-header">
            <span className="sql-panel-title">
              {isOverridden ? 'SQL (edited)' : 'SQL (auto)'}
            </span>
            {isOverridden && (
              <button className="sql-panel-reset" onClick={handleReset}>Reset</button>
            )}
            <button className="sql-panel-close" onClick={() => setOpen(false)}>&times;</button>
          </div>
          <textarea
            className="sql-panel-textarea"
            value={sql}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            rows={10}
          />
          <div className="sql-panel-footer">
            <button className="sql-panel-run" onClick={handleRun} disabled={running}>
              {running ? '...' : '\u25B6 Run'}
            </button>
            <span className="sql-panel-hint">Ctrl+Enter</span>
          </div>
        </div>
      )}
    </>
  );
}
