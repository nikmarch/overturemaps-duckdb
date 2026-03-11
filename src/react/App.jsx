import { useEffect, useState, useCallback } from 'react';
import FilterPipeline from './components/FilterPipeline';
import SqlPanel from './components/SqlPanel';
import TablePanel from './components/TablePanel';
import LoadModal from './components/LoadModal';
import ProgressOverlay from './components/ProgressOverlay';
import QueryStatusHud from './components/QueryStatusHud';
import { loadArea, initSnapviewHistory, restoreFromUrl, initUrlSync, clearCache } from '../lib/controller.js';
import { initMap } from '../lib/map.js';
import { initDuckDB } from '../lib/duckdb.js';
import { initSessionTable, restoreSession, initSessionSync } from '../lib/sessionState.js';
import { loadReleases } from '../lib/themes.js';
import { initSnapviewsLayer } from '../lib/snapviews.js';
import { initPipelineRunner } from '../lib/pipelineRunner.js';
import { startDraw } from '../lib/drawBbox.js';
import { useStore } from '../lib/store.js';

export default function App() {
  const [modalOpen, setModalOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const hasPipeline = useStore(s => s.pipeline.length > 0);

  useEffect(() => {
    async function init() {
      try {
        useStore.setState({ status: { text: 'Loading DuckDB...', type: 'loading' } });
        await initDuckDB();

        initMap('map');
        initSnapviewsLayer();
        initPipelineRunner();

        // Set up DuckDB session table and restore persisted state
        await initSessionTable();
        const sessionRestored = await restoreSession();

        await loadReleases();
        await initSnapviewHistory();

        // URL takes priority over session state
        const urlRestored = await restoreFromUrl();
        initUrlSync();
        initSessionSync();

        setInitialized(true);
      } catch (e) {
        useStore.setState({ status: { text: `Init error: ${e.message}`, type: 'error' } });
        console.error(e);
      }
    }
    init();
  }, []);

  const handleDraw = useCallback(() => {
    setDrawing(true);
    startDraw((bbox) => {
      setDrawing(false);
      setModalOpen(true);
    });
  }, []);

  function handleLoad(keys) {
    const bbox = useStore.getState().pipelineBbox;
    if (bbox) loadArea(keys, bbox);
  }

  return (
    <>
      <div id="map" />
      <ProgressOverlay />
      <QueryStatusHud />
      <SqlPanel />
      {hasPipeline && (
        <button
          className={`table-panel-btn${tableOpen ? ' active' : ''}`}
          onClick={() => setTableOpen(o => !o)}
          title="Show results as table"
        >
          Table
        </button>
      )}
      <div className="bottom-right-btns">
        <button
          className="clear-cache-btn"
          onClick={clearCache}
          title="Clear all cached data"
        >
          Clear Cache
        </button>
        <button
          className="load-area-btn"
          onClick={handleDraw}
          title="Draw rectangle to select area and load themes"
        >
          {drawing ? 'Drawing...' : 'Select Area'}
        </button>
      </div>
      <LoadModal open={modalOpen} onClose={() => setModalOpen(false)} onLoad={handleLoad} />
      <FilterPipeline />
      {tableOpen && <TablePanel onClose={() => setTableOpen(false)} />}
    </>
  );
}
