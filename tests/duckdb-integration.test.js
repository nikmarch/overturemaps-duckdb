import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

// Use the node-blocking target so we can run DuckDB-WASM in Vitest/node.
import * as duckdb from '@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs';

const require = createRequire(import.meta.url);

function localBundles() {
  const distDir = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

  // Node bindings expect plain filesystem paths here.
  const mvpWasm = path.join(distDir, 'duckdb-mvp.wasm');
  const ehWasm = path.join(distDir, 'duckdb-eh.wasm');

  // Included for API shape completeness; node-blocking doesn't require workers.
  const mvpWorker = path.join(distDir, 'duckdb-node-mvp.worker.cjs');
  const ehWorker = path.join(distDir, 'duckdb-node-eh.worker.cjs');

  return {
    mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
    eh: { mainModule: ehWasm, mainWorker: ehWorker },
  };
}

const RUN = process.env.RUN_DUCKDB_INTEGRATION === '1';

// Note: DuckDB-WASM node-blocking currently doesn't expose the same FTS behavior
// as the browser worker build we use in the app (in our environment match_bm25
// returns NULLs even after create_fts_index). We keep this test behind an env
// flag so it can be iterated on without breaking CI/unit tests.

describe('duckdb wasm integration (fts)', () => {
  (RUN ? it : it.skip)('can create fts index and query via match_bm25', async () => {
    const bundles = localBundles();
    const logger = new duckdb.VoidLogger();

    const db = await duckdb.createDuckDB(bundles, logger, duckdb.NODE_RUNTIME);
    await db.instantiate();
    const conn = db.connect();

    try { conn.query('INSTALL fts'); } catch { /* ignore */ }
    try { conn.query('LOAD fts'); } catch { /* ignore */ }

    conn.query('CREATE TABLE t(id VARCHAR, display_name VARCHAR)');
    conn.query("INSERT INTO t VALUES ('1','Costco'), ('2','Coffee Shop'), ('3','Random')");
    conn.query("PRAGMA create_fts_index('t', 'id', 'display_name')");

    const res = conn.query("SELECT id FROM t WHERE fts_main_t.match_bm25(id, 'cost') ORDER BY id");
    const ids = res.toArray().map(r => String(r.id));
    expect(ids.length).toBeGreaterThan(0);
  });
});
