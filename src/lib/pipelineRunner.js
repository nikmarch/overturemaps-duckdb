// Reactive pipeline executor
//
// Subscribes to pipeline state changes, compiles SQL, runs query,
// renders results on a single Leaflet layer group.

import L from 'leaflet';
import { useStore } from './store.js';
import { getConn } from './duckdb.js';
import { getMap } from './map.js';
import { compilePipeline } from './pipeline.js';
import { getThemeColor } from './themes.js';
import { renderFeature } from './render.js';
import { THEME_FIELDS } from './constants.js';
import { tableHasFts } from './fts.js';

let pipelineLayer = null;
let debounceTimer = null;

export function initPipelineRunner() {
  // React to pipeline, search, limit, bbox override, or SQL override changes
  useStore.subscribe(
    s => ({
      p: s.pipeline,
      s: s.pipelineSearch,
      l: s.pipelineLimit,
      o: s.sqlOverride,
      b: s.pipelineBbox,
    }),
    () => debouncedRun(),
    { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );

  // No map moveend — pipeline only reruns when state changes.
  // Data is loaded for the drawn bbox; no viewport-based re-queries.
}

function debouncedRun(ms = 300) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runPipeline, ms);
}

export async function runPipeline() {
  const state = useStore.getState();
  const { pipeline, pipelineSearch, pipelineLimit, sqlOverride, pipelineBbox } = state;

  if (pipeline.length === 0) {
    clearPipelineLayer();
    useStore.setState({ compiledSql: '', pipelineResult: null });
    return;
  }

  // Use drawn bbox (data is loaded for this area)
  const bbox = pipelineBbox;

  const conn = getConn();

  // Resolve which tables have FTS indexes
  const ftsTables = new Set();
  if (pipelineSearch && conn) {
    const tables = new Set(pipeline.map(n => n.table));
    await Promise.all([...tables].map(async t => {
      if (await tableHasFts(conn, t)) ftsTables.add(t);
    }));
  }

  const compiled = compilePipeline(pipeline, {
    search: pipelineSearch,
    limit: pipelineLimit,
    bbox,
    ftsTables,
  });

  const sql = sqlOverride || compiled;
  useStore.setState({ compiledSql: compiled, pipelineRunning: true });

  if (!conn || !sql) {
    useStore.setState({ pipelineRunning: false });
    return;
  }

  // Clear previous results
  clearPipelineLayer();
  const map = getMap();
  if (!map) return;
  pipelineLayer = L.layerGroup().addTo(map);

  const t0 = performance.now();
  try {
    const res = await conn.query(sql);
    const rows = res.toArray();

    // Group by _source and render with appropriate colors
    const bySource = {};
    for (const row of rows) {
      const src = row._source || '';
      (bySource[src] ||= []).push(row);
    }

    let totalRendered = 0;
    for (const [src, srcRows] of Object.entries(bySource)) {
      const color = getThemeColor(src);
      const defs = THEME_FIELDS[src] || [];
      const fakeState = { key: src, layer: pipelineLayer, markers: [] };

      for (let i = 0; i < srcRows.length; i++) {
        renderFeature(srcRows[i], fakeState, color, defs);
        // Yield to browser every 500 rows
        if (i > 0 && i % 500 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
      totalRendered += fakeState.markers.length;
    }

    const durationMs = Math.round(performance.now() - t0);
    const fmtMs = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
    useStore.setState({
      pipelineResult: { count: totalRendered, durationMs },
      pipelineRunning: false,
      status: { text: `${totalRendered.toLocaleString()} results (${fmtMs})`, type: 'success' },
    });
  } catch (e) {
    const durationMs = Math.round(performance.now() - t0);
    useStore.setState({
      pipelineResult: { error: e.message, durationMs },
      pipelineRunning: false,
      status: { text: `Query error: ${e.message}`, type: 'error' },
    });
  }
}

function clearPipelineLayer() {
  if (pipelineLayer) {
    pipelineLayer.remove();
    pipelineLayer = null;
  }
}
