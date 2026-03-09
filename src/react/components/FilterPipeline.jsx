import { useState, useRef, useCallback, useEffect } from 'react';
import { useStore, addPipelineNode, removePipelineNode, updatePipelineNode } from '../../lib/store.js';
import { getThemeColor } from '../../lib/themes.js';

const OPS = [
  { id: 'union', label: 'Union', icon: 'U' },
  { id: 'intersect', label: 'Intersect', icon: '\u2229' },
  { id: 'within', label: 'Within', icon: '\u2282' },
  { id: 'exclude', label: 'Exclude', icon: '\u2216' },
];

function fmtMs(ms) {
  if (ms == null) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function RunningTimer() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(performance.now());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.round((performance.now() - startRef.current) / 100) / 10);
    }, 100);
    return () => clearInterval(id);
  }, []);

  return <span className="pl-running-badge">{elapsed.toFixed(1)}s</span>;
}

export default function FilterPipeline() {
  const pipeline = useStore(s => s.pipeline);
  const loadedTables = useStore(s => s.loadedTables);
  const search = useStore(s => s.pipelineSearch);
  const limit = useStore(s => s.pipelineLimit);
  const result = useStore(s => s.pipelineResult);
  const running = useStore(s => s.pipelineRunning);
  const [panelOpen, setPanelOpen] = useState(true);

  const limitTimerRef = useRef(null);
  const handleLimitChange = useCallback((value) => {
    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    limitTimerRef.current = setTimeout(() => {
      useStore.setState({ pipelineLimit: value, sqlOverride: null });
    }, 200);
  }, []);

  // Build table options from loadedTables
  const tableOptions = loadedTables.map(t => {
    const key = t.replace('_', '/');
    return { table: t, key, label: t.split('_').pop() };
  });

  function handleAddNode() {
    if (tableOptions.length === 0) return;
    const t = tableOptions[0];
    addPipelineNode({
      type: 'combine',
      op: 'union',
      table: t.table,
      key: t.key,
    });
  }

  if (pipeline.length === 0 && loadedTables.length === 0) return null;

  return (
    <div className={`pipeline-panel${panelOpen ? '' : ' collapsed'}`}>
      <div className="pl-header" onClick={() => setPanelOpen(o => !o)}>
        <span className="pl-toggle">{panelOpen ? '\u25BC' : '\u25B6'}</span>
        <span className="pl-title">Pipeline</span>
        {running && <RunningTimer />}
        {!running && result && !result.error && (
          <span className="pl-result-badge">
            {result.count.toLocaleString()}
            {result.durationMs != null && <span className="pl-result-ms"> {fmtMs(result.durationMs)}</span>}
          </span>
        )}
        {!running && result?.error && <span className="pl-error-badge">err</span>}
      </div>

      {panelOpen && (
        <div className="pl-body">
          {/* Search filter — top of pipeline */}
          <div className="pl-search">
            <input
              className="pl-search-input"
              value={search}
              placeholder="Filter by name..."
              onChange={e => useStore.setState({ pipelineSearch: e.target.value, sqlOverride: null })}
              spellCheck={false}
            />
            {search && (
              <button
                className="pl-search-clear"
                onClick={() => useStore.setState({ pipelineSearch: '', sqlOverride: null })}
              >&times;</button>
            )}
          </div>

          {/* Pipeline nodes */}
          <div className="pl-nodes">
            {pipeline.map((node, idx) => {
              const color = getThemeColor(node.key);
              const isSource = node.type === 'source';
              const needsDistance = node.op === 'within' || node.op === 'exclude';

              return (
                <div key={node.id} className="pl-node">
                  {/* Op selector (not for first source) */}
                  {!isSource && (
                    <div className="pl-op-row">
                      {OPS.map(op => (
                        <button
                          key={op.id}
                          className={`pl-op-btn${node.op === op.id ? ' active' : ''}`}
                          onClick={() => updatePipelineNode(node.id, { op: op.id })}
                          title={op.label}
                        >{op.icon}</button>
                      ))}
                    </div>
                  )}

                  <div className="pl-node-row">
                    <span className="pl-node-dot" style={{ background: color?.fill || '#999' }} />
                    <select
                      className="pl-node-select"
                      value={node.table}
                      onChange={e => {
                        const key = e.target.value.replace('_', '/');
                        updatePipelineNode(node.id, { table: e.target.value, key });
                      }}
                    >
                      {tableOptions.map(t => (
                        <option key={t.table} value={t.table}>{t.label}</option>
                      ))}
                    </select>

                    {needsDistance && (
                      <div className="pl-distance">
                        <input
                          type="number"
                          className="pl-dist-input"
                          value={node.distance || 250}
                          min={1}
                          step={10}
                          onChange={e => updatePipelineNode(node.id, { distance: Number(e.target.value) })}
                        />
                        <span className="pl-dist-unit">m</span>
                      </div>
                    )}

                    <button
                      className="pl-node-delete"
                      onClick={() => removePipelineNode(node.id)}
                      title="Remove"
                    >&times;</button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add node button */}
          {tableOptions.length > 0 && (
            <button className="pl-add-btn" onClick={handleAddNode}>+ Add</button>
          )}

          {/* Limit slider */}
          <div className="pl-limit-row">
            <span className="pl-limit-label">Limit</span>
            <input
              type="range"
              className="pl-limit-slider"
              min="100"
              max="50000"
              step="100"
              defaultValue={limit}
              onChange={e => handleLimitChange(parseInt(e.target.value, 10))}
            />
            <span className="pl-limit-value">{limit.toLocaleString()}</span>
          </div>

          {/* Error display */}
          {result?.error && (
            <div className="pl-error">{result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
