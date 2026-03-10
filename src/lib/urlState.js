// URL state encoding/decoding for shareable links.
//
// Encodes a snapview as compressed base64url in the URL hash:
//   #zoom/lat/lon?sv=<compressed>
//
// The sv (snapview) payload contains:
//   { t: theme keys, b: bbox, q: SQL query, s: search, l: limit }
//
// On restore: loads themes for bbox, waits for tables, runs the SQL.

import { useStore } from './store.js';

// ── Compression helpers (browser-native deflate) ──

async function compress(str) {
  const buf = new TextEncoder().encode(str);
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(buf);
  writer.close();
  const chunks = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

async function decompress(buf) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(buf);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return new TextDecoder().decode(out);
}

function toBase64Url(buf) {
  let s = '';
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = s + '==='.slice(0, (4 - s.length % 4) % 4);
  const bin = atob(padded);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf;
}

// ── Hash helpers ──

function getHashBase() {
  return (location.hash.split('?')[0]); // #z/lat/lon
}

function getHashParam() {
  const hash = location.hash;
  const idx = hash.indexOf('?sv=');
  return idx === -1 ? null : hash.slice(idx + 4);
}

// ── Encode snapview state to URL ──

function buildSvPayload() {
  const s = useStore.getState();

  // Need either a pipeline or SQL override to have something worth sharing
  if (s.pipeline.length === 0 && !s.sqlOverride) return null;

  const sv = {};

  // Theme keys (tables to load)
  const keys = [...new Set(s.pipeline.map(n => n.key))];
  if (keys.length > 0) sv.t = keys;

  // Bbox (required to know what area to load)
  if (s.pipelineBbox) sv.b = s.pipelineBbox;

  // The SQL to run — prefer sqlOverride, fall back to compiledSql
  const sql = s.sqlOverride || s.compiledSql;
  if (sql) sv.q = sql;

  // Search + limit only if non-default
  if (s.pipelineSearch) sv.s = s.pipelineSearch;
  if (s.pipelineLimit !== 3000) sv.l = s.pipelineLimit;

  return sv;
}

export async function encodeStateToUrl() {
  const sv = buildSvPayload();
  if (!sv) return;

  const json = JSON.stringify(sv);
  const compressed = await compress(json);
  const encoded = toBase64Url(compressed);

  history.replaceState(null, '', `${getHashBase()}?sv=${encoded}`);
}

export function clearUrlState() {
  history.replaceState(null, '', getHashBase());
}

// ── Decode snapview state from URL ──

export async function decodeStateFromUrl() {
  const encoded = getHashParam();
  if (!encoded) return null;

  try {
    const buf = fromBase64Url(encoded);
    const json = await decompress(buf);
    const sv = JSON.parse(json);

    return {
      themeKeys: sv.t || [],
      bbox: sv.b || null,
      sql: sv.q || null,
      search: sv.s || '',
      limit: sv.l || 3000,
    };
  } catch (e) {
    console.warn('Failed to decode URL state:', e);
    return null;
  }
}

// ── Sync: update URL when pipeline changes ──

let syncTimer = null;

export function initUrlSync() {
  useStore.subscribe(
    s => ({
      p: s.pipeline,
      s: s.pipelineSearch,
      l: s.pipelineLimit,
      o: s.sqlOverride,
      c: s.compiledSql,
      b: s.pipelineBbox,
    }),
    () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        const s = useStore.getState();
        if (s.pipeline.length > 0 || s.sqlOverride) {
          encodeStateToUrl();
        } else {
          clearUrlState();
        }
      }, 500);
    },
    { equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
}
