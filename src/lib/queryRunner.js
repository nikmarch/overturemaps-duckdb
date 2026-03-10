import { useStore } from './store.js';

function now() {
  return Date.now();
}

function previewSql(sql, max = 140) {
  const s = String(sql || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

let nextId = 1;

export async function runQuery(conn, sql, { label = 'query' } = {}) {
  if (!conn) throw new Error('No DuckDB connection');

  const id = String(nextId++);
  const startedAt = now();

  useStore.setState(s => {
    const entry = {
      id,
      label,
      sqlPreview: previewSql(sql),
      startedAt,
      endedAt: null,
      ms: null,
      ok: null,
      error: null,
    };
    const next = [entry, ...(s.queryStatus || [])].slice(0, 20);
    return { queryStatus: next };
  });

  try {
    const res = await conn.query(sql);
    const endedAt = now();
    const ms = endedAt - startedAt;
    useStore.setState(s => ({
      queryStatus: (s.queryStatus || []).map(e =>
        e.id === id ? { ...e, endedAt, ms, ok: true } : e
      ),
    }));
    return res;
  } catch (e) {
    const endedAt = now();
    const ms = endedAt - startedAt;
    useStore.setState(s => ({
      queryStatus: (s.queryStatus || []).map(en =>
        en.id === id ? { ...en, endedAt, ms, ok: false, error: e?.message || String(e) } : en
      ),
    }));
    throw e;
  }
}
