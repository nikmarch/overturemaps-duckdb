import { parquetMetadataAsync } from 'hyparquet';
import { init, DuckDB, tableToIPC } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';

// ── Inline geohash decode (used by handleTile) ──────────────────────────────

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohashDecodeBbox(hash) {
  let minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  let isLon = true;
  for (const c of hash) {
    const val = BASE32.indexOf(c);
    for (let bit = 4; bit >= 0; bit--) {
      if (isLon) {
        const mid = (minLon + maxLon) / 2;
        if (val & (1 << bit)) minLon = mid; else maxLon = mid;
      } else {
        const mid = (minLat + maxLat) / 2;
        if (val & (1 << bit)) minLat = mid; else maxLat = mid;
      }
      isLon = !isLon;
    }
  }
  return { ymin: minLat, xmin: minLon, ymax: maxLat, xmax: maxLon };
}

// Cache TTLs: production = 1 day, dev/preview = 1 minute
function cacheTtl(env) {
  return env.ENVIRONMENT === 'production' ? 86400 : 60;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Accept-Ranges, X-Total-Files, X-Filtered-Files, X-Cache, X-Index-Status, X-Row-Count, Retry-After',
};

// ── Lazy DuckDB init (once per isolate) ──────────────────────────────────────

let dbInstance = null;
let connInstance = null;
let initDone = false;

async function ensureDb() {
  if (connInstance) return connInstance;
  if (!initDone) {
    await init({ wasmModule });
    initDone = true;
  }
  dbInstance = new DuckDB({ customConfig: { memory_limit: '100MB' } });
  connInstance = dbInstance.connect();
  return connInstance;
}

function resetDb() {
  try { if (connInstance) connInstance.close(); } catch {}
  try { if (dbInstance) dbInstance.close(); } catch {}
  connInstance = null;
  dbInstance = null;
}

// Mutex to serialize DuckDB queries within a single isolate.
// In production each request gets its own isolate so this is a no-op.
// In local wrangler dev, concurrent requests share one isolate and
// WASM can't handle parallel queries.
let queryLock = Promise.resolve();

function withLock(fn) {
  const prev = queryLock;
  let resolve;
  queryLock = new Promise(r => { resolve = r; });
  return prev.then(fn).finally(resolve);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // Strip /api/ prefix (nginx dev proxy and direct access both work)
    if (url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice(4);
    }

    const ttl = cacheTtl(env);

    if (url.pathname === '/releases') return handleReleases(ctx, ttl);
    if (url.pathname === '/themes') return handleThemes(ctx, url, ttl);
    if (url.pathname === '/files') return handleFiles(ctx, url, ttl);
    if (url.pathname === '/query/exec' && request.method === 'POST') return handleQueryExec(request);
    if (url.pathname === '/query' && request.method === 'POST') return handleQuery(request);

    // Tile data: geohash-based cells for CDN caching
    const tilesMatch = url.pathname.match(
      /^\/tiles\/([^/]+\/[^/]+)\/([0-9b-hjkmnp-z]{1,12})\.arrow$/
    );
    if (tilesMatch && request.method === 'GET') {
      return handleTile(ctx, url, tilesMatch, request, env, ttl);
    }

    // S3 proxy: passthrough for /release/... parquet files and listing XML
    return handleS3Proxy(request, ctx, url, ttl);
  },
};

// ── POST /query/exec — single-file Arrow IPC executor ───────────────────────

async function handleQueryExec(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { file, columns, where, limit } = body;
  if (!file || !Array.isArray(columns) || !where || !limit) {
    return json({ error: 'Missing required fields: file, columns, where, limit' }, { status: 400 });
  }

  try {
    const table = await withLock(() => runQueryArrow(file, columns, where, limit));
    const ipc = tableToIPC(table, { format: 'stream' });
    return new Response(ipc, {
      headers: {
        'Content-Type': 'application/vnd.apache.arrow.stream',
        'X-Row-Count': String(table.numRows),
        ...corsHeaders,
      },
    });
  } catch (e) {
    resetDb();
    return json({ error: e.message }, { status: 500 });
  }
}

// ── POST /query — orchestrator (streams framed Arrow IPC) ───────────────────
// Binary frame format per file:
//   [4-byte LE uint32 length][Arrow IPC bytes]
// Error frame:
//   [4-byte 0x00000000][4-byte LE error-json-length][error JSON bytes]

async function handleQuery(request) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { files, columns, where, limit } = body;

  if (!Array.isArray(files) || !Array.isArray(columns) || !where || !limit) {
    return json({ error: 'Missing required fields: files, columns, where, limit' }, { status: 400 });
  }

  if (files.length === 0) {
    return new Response(new Uint8Array(0), {
      headers: { 'Content-Type': 'application/vnd.apache.arrow.stream', ...corsHeaders },
    });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Adaptive per-file row cap: starts at 5000, scales up on success (max 10000),
  // halves on OOM (floor 500). Retries the same file once with a smaller limit.
  let perFileMax = 5000;

  const streamWork = withLock(async () => {
    let totalRows = 0;
    for (let i = 0; i < files.length && totalRows < limit; i++) {
      const remaining = Math.min(limit - totalRows, perFileMax);
      try {
        const table = await runQueryArrow(files[i], columns, where, remaining);
        const ipcBytes = new Uint8Array(tableToIPC(table, { format: 'stream' }));
        totalRows += table.numRows;

        // Write data frame: [4-byte length][Arrow IPC bytes]
        const lenBuf = new ArrayBuffer(4);
        new DataView(lenBuf).setUint32(0, ipcBytes.byteLength, true);
        await writer.write(new Uint8Array(lenBuf));
        await writer.write(ipcBytes);

        // Success — try increasing limit for next file (up to 10000)
        if (perFileMax < 10000) perFileMax = Math.min(perFileMax * 2, 10000);
      } catch (e) {
        resetDb();

        if (e.message?.includes('Out of Memory') && remaining > 500) {
          // Halve the limit and retry this file
          perFileMax = Math.max(500, Math.floor(remaining / 2));
          i--; // retry same file
          continue;
        }

        // Write error frame: [4-byte 0x00000000][4-byte error-json-length][error JSON]
        const errJson = new TextEncoder().encode(JSON.stringify({ error: e.message, file: i }));
        const errHeader = new ArrayBuffer(8);
        const errView = new DataView(errHeader);
        errView.setUint32(0, 0, true); // zero signals error frame
        errView.setUint32(4, errJson.byteLength, true);
        await writer.write(new Uint8Array(errHeader));
        await writer.write(errJson);
      }
      // Free WASM memory between files to stay within 128MB isolate
      resetDb();
    }
  });

  streamWork.finally(() => writer.close());

  return new Response(readable, {
    headers: { 'Content-Type': 'application/vnd.apache.arrow.stream', ...corsHeaders },
  });
}

async function runQueryArrow(file, columns, where, limit) {
  const conn = await ensureDb();
  const url = `'${S3_BASE}/${file}'`;
  const sql = `SELECT ${columns.join(', ')} FROM read_parquet([${url}], hive_partitioning=false) WHERE ${where} LIMIT ${limit}`;
  return conn.queryArrow(sql);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(body, init = {}) {
  const headers = { ...(init.headers || {}), 'Content-Type': 'application/json', ...corsHeaders };
  return new Response(JSON.stringify(body), { ...init, headers });
}

function cacheKey(kind, parts) {
  return new Request(`https://cache.local/${kind}/${parts.join('/')}`);
}

async function cachedJson(cache, key) {
  const hit = await cache.match(key);
  if (!hit) return null;
  return { data: await hit.json(), response: hit };
}

// ── GET /releases ───────────────────────────────────────────────────────────

async function handleReleases(ctx, ttl) {
  const cache = caches.default;
  const key = cacheKey('releases', ['v1']);
  const hit = await cache.match(key);
  if (hit) return withCacheHeader(hit, 'HIT');

  const listUrl = `${S3_BASE}/?prefix=release/&delimiter=/&max-keys=1000`;
  const xml = await (await fetch(listUrl)).text();
  const releases = extractReleases(xml);

  const res = json(releases, {
    headers: { 'Cache-Control': `public, s-maxage=${ttl}`, 'X-Cache': 'MISS' },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

function extractReleases(xml) {
  const prefixes = [...xml.matchAll(/<Prefix>(release\/[^<]+)<\/Prefix>/g)].map(m => m[1]);
  const versions = new Set();
  for (const p of prefixes) {
    const m = p.match(/^release\/([^/]+)\//);
    if (m) versions.add(m[1]);
  }
  if (versions.size === 0) {
    const keys = [...xml.matchAll(/<Key>(release\/[^<]+)<\/Key>/g)].map(m => m[1]);
    for (const k of keys) {
      const m = k.match(/^release\/([^/]+)\//);
      if (m) versions.add(m[1]);
    }
  }
  return [...versions].sort().reverse();
}

// ── GET /themes?release=X ───────────────────────────────────────────────────

async function handleThemes(ctx, url, ttl) {
  const release = url.searchParams.get('release');
  if (!release) return json({ error: 'Missing ?release' }, { status: 400 });

  const cache = caches.default;
  const key = cacheKey('themes', [release]);
  const hit = await cache.match(key);
  if (hit) return withCacheHeader(hit, 'HIT');

  const listUrl = `${S3_BASE}/?prefix=release/${release}/&delimiter=/&max-keys=1000`;
  const xml = await (await fetch(listUrl)).text();

  const themePrefixes = [...xml.matchAll(/<Prefix>(release\/[^<]+)<\/Prefix>/g)].map(m => m[1]);
  const themes = [];

  for (const tp of themePrefixes) {
    const themeMatch = tp.match(/theme=([^/]+)/);
    if (!themeMatch) continue;
    const theme = themeMatch[1];

    const typeListUrl = `${S3_BASE}/?prefix=${tp}&delimiter=/&max-keys=1000`;
    const typeXml = await (await fetch(typeListUrl)).text();
    const typePrefixes = [...typeXml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)].map(m => m[1]);

    for (const tyP of typePrefixes) {
      const typeMatch = tyP.match(/type=([^/]+)/);
      if (typeMatch) themes.push({ theme, type: typeMatch[1] });
    }
  }

  const res = json(themes, {
    headers: { 'Cache-Control': `public, s-maxage=${ttl}`, 'X-Cache': 'MISS' },
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// ── GET /files?release=X&theme=T&type=Y[&xmin&xmax&ymin&ymax] ──────────────

async function getFilteredFiles(ctx, release, theme, type, bbox, ttl) {
  const cache = caches.default;
  const indexKey = cacheKey('index', [release, theme, type]);
  const hit = await cachedJson(cache, indexKey);

  let index;
  let indexReady = true;
  if (hit) {
    index = hit.data;
  } else {
    const files = await listS3Files({ release, theme, type });
    index = Object.fromEntries(files.map(f => [f, { xmin: -180, xmax: 180, ymin: -90, ymax: 90 }]));
    indexReady = false;

    ctx.waitUntil(
      buildBboxIndex(files).then(built => {
        const indexRes = json(built, {
          headers: { 'Cache-Control': `public, s-maxage=${ttl}` },
        });
        return cache.put(indexKey, indexRes);
      }),
    );
  }

  let files = Object.keys(index);
  const totalFiles = files.length;

  if (indexReady && bbox) {
    files = files.filter(f => {
      const b = index[f];
      return b.xmax >= bbox.xmin && b.xmin <= bbox.xmax && b.ymax >= bbox.ymin && b.ymin <= bbox.ymax;
    });
  }

  return { files, totalFiles, indexReady, cacheHit: !!hit };
}

async function handleFiles(ctx, url, ttl) {
  const release = url.searchParams.get('release');
  const theme = url.searchParams.get('theme');
  const type = url.searchParams.get('type');
  if (!release || !theme || !type) {
    return json({ error: 'Missing required params: release, theme, type' }, { status: 400 });
  }

  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  const bbox = (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax))
    ? { xmin, xmax, ymin, ymax } : null;

  const { files, totalFiles, indexReady, cacheHit } = await getFilteredFiles(ctx, release, theme, type, bbox, ttl);

  return json(files, {
    headers: {
      'X-Total-Files': totalFiles.toString(),
      'X-Filtered-Files': files.length.toString(),
      'X-Cache': cacheHit ? 'HIT' : 'MISS',
      'X-Index-Status': indexReady ? 'ready' : 'building',
      'Cache-Control': 'no-store',
    },
  });
}

// ── Tile theme constants (mirrored from src/lib/constants.js + query.js) ─────

const TILE_THEME_FIELDS = {
  'places/place': [
    { sql: 'categories.primary', label: 'Category' },
    { sql: 'ROUND(confidence, 2)', label: 'Confidence' },
    { sql: 'websites[1]', label: 'Website' },
    { sql: 'phones[1]', label: 'Phone' },
  ],
  'buildings/building': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
    { sql: 'ROUND(height, 1)', label: 'Height' },
    { sql: 'num_floors', label: 'Floors' },
  ],
  'buildings/building_part': [
    { sql: 'ROUND(height, 1)', label: 'Height' },
    { sql: 'num_floors', label: 'Floors' },
  ],
  'addresses/address': [
    { sql: 'number', label: 'Number' },
    { sql: 'street', label: 'Street' },
    { sql: 'postcode', label: 'Postcode' },
    { sql: 'country', label: 'Country' },
  ],
  'transportation/segment': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
    { sql: 'subclass', label: 'Subclass' },
  ],
  'base/infrastructure': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
  ],
  'base/land': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
    { sql: 'elevation', label: 'Elevation' },
  ],
  'base/land_cover': [
    { sql: 'subtype', label: 'Subtype' },
  ],
  'base/land_use': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
  ],
  'base/water': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
    { sql: 'is_salt', label: 'Salt' },
    { sql: 'is_intermittent', label: 'Intermittent' },
  ],
  'base/bathymetry': [
    { sql: 'depth', label: 'Depth' },
  ],
  'divisions/division': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'country', label: 'Country' },
    { sql: 'population', label: 'Population' },
    { sql: 'sources[1].record_id', label: 'OSM record' },
    { sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM relation id' },
  ],
  'divisions/division_area': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'country', label: 'Country' },
    { sql: 'sources[1].record_id', label: 'OSM record' },
    { sql: "regexp_replace(sources[1].record_id, '@.*', '')", label: 'OSM relation id' },
  ],
  'divisions/division_boundary': [
    { sql: 'subtype', label: 'Subtype' },
    { sql: 'class', label: 'Class' },
  ],
};

const TILE_HAS_NAMES = new Set([
  'places/place', 'buildings/building', 'buildings/building_part',
  'transportation/segment', 'base/infrastructure', 'base/land',
  'base/land_use', 'base/water', 'divisions/division',
  'divisions/division_area',
]);

function buildTileColumns(themeKey) {
  const defs = TILE_THEME_FIELDS[themeKey] || [];
  const displayNameCol = TILE_HAS_NAMES.has(themeKey)
    ? "COALESCE(CAST(names.primary AS VARCHAR), '') as display_name"
    : "'' as display_name";

  return [
    'id',
    displayNameCol,
    'hex(geometry) as geometry_wkb',
    'bbox.xmin as bbox_xmin',
    'bbox.xmax as bbox_xmax',
    'bbox.ymin as bbox_ymin',
    'bbox.ymax as bbox_ymax',
    '(bbox.xmin + bbox.xmax) / 2 as centroid_lon',
    '(bbox.ymin + bbox.ymax) / 2 as centroid_lat',
    ...defs.map((f, i) => `CAST(${f.sql} AS VARCHAR) as _f${i}`),
  ];
}

// ── GET /tiles/{theme}/{type}/{geohash}.arrow ────────────────────────────────

async function handleTile(ctx, url, match, request, env, ttl) {
  const release = url.searchParams.get('release');
  if (!release) return json({ error: 'Missing ?release' }, { status: 400 });

  const themeKey = match[1]; // e.g. "places/place"
  const geohash = match[2];
  const [theme, type] = themeKey.split('/');
  const bbox = geohashDecodeBbox(geohash);

  // Use cached bbox index to find overlapping files, fall back to full list
  const files = await getTileFiles(release, theme, type, bbox);

  if (files.length === 0) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'public, max-age=2592000', ...corsHeaders },
    });
  }

  const columns = buildTileColumns(themeKey);
  const where = `bbox.xmax >= ${bbox.xmin} AND bbox.xmin <= ${bbox.xmax} AND bbox.ymax >= ${bbox.ymin} AND bbox.ymin <= ${bbox.ymax}`;
  const limit = 50000;

  // Query DuckDB directly — self-fetch to *.workers.dev returns 404 inside CF Workers
  const frames = await tileQueryLocal(files, columns, where, limit);

  if (frames.length === 0) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'public, max-age=2592000', ...corsHeaders },
    });
  }

  // Assemble framed response: [4-byte LE length][Arrow IPC bytes] per frame
  let totalLen = 0;
  for (const f of frames) totalLen += 4 + f.byteLength;
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const f of frames) {
    view.setUint32(offset, f.byteLength, true);
    out.set(f, offset + 4);
    offset += 4 + f.byteLength;
  }

  return new Response(out, {
    headers: {
      'Content-Type': 'application/vnd.apache.arrow.stream',
      'Cache-Control': 'public, max-age=2592000',
      ...corsHeaders,
    },
  });
}

// Query DuckDB directly for tile data
async function tileQueryLocal(files, columns, where, limit) {
  const frames = [];
  let totalRows = 0;
  let perFileMax = 5000;

  await withLock(async () => {
    for (let i = 0; i < files.length && totalRows < limit; i++) {
      const remaining = Math.min(limit - totalRows, perFileMax);
      try {
        const table = await runQueryArrow(files[i], columns, where, remaining);
        if (table.numRows > 0) {
          frames.push(new Uint8Array(tableToIPC(table, { format: 'stream' })));
          totalRows += table.numRows;
        }
        if (perFileMax < 10000) perFileMax = Math.min(perFileMax * 2, 10000);
      } catch (e) {
        resetDb();
        if (e.message?.includes('Out of Memory') && remaining > 500) {
          perFileMax = Math.max(500, Math.floor(remaining / 2));
          i--;
          continue;
        }
      }
      resetDb();
    }
  });
  return frames;
}

async function getTileFiles(release, theme, type, bbox) {
  const cache = caches.default;
  const indexKey = cacheKey('index', [release, theme, type]);
  const hit = await cachedJson(cache, indexKey);
  if (hit) {
    return Object.keys(hit.data).filter(f => {
      const b = hit.data[f];
      return b.xmax >= bbox.xmin && b.xmin <= bbox.xmax && b.ymax >= bbox.ymin && b.ymin <= bbox.ymax;
    });
  }

  // No index yet — return all files, DuckDB WHERE clause filters at query time
  return listS3Files({ release, theme, type });
}

async function buildBboxIndex(files) {
  const concurrency = 5;
  const index = {};

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async file => {
        try {
          const buf = await createAsyncBuffer(`${S3_BASE}/${file}`);
          const meta = await parquetMetadataAsync(buf);
          index[file] = extractBbox(meta);
        } catch {
          index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
        }
      }),
    );
  }

  return index;
}

// ── S3 Proxy ────────────────────────────────────────────────────────────────

async function handleS3Proxy(request, ctx, url, ttl) {
  const cache = caches.default;
  const isListing = url.search.includes('prefix=');

  if (isListing) {
    const cached = await cache.match(request);
    if (cached) return withCacheHeader(cached, 'HIT');
  }

  const s3Url = `${S3_BASE}${url.pathname}${url.search}`;
  const headers = {};
  if (request.headers.has('Range')) headers['Range'] = request.headers.get('Range');

  const s3Res = await fetch(s3Url, { method: request.method, headers });
  const resHeaders = { ...corsHeaders };
  resHeaders['Content-Type'] = s3Res.headers.get('Content-Type') || 'application/octet-stream';
  for (const h of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
    if (s3Res.headers.has(h)) resHeaders[h] = s3Res.headers.get(h);
  }
  resHeaders['Cache-Control'] = isListing ? `public, s-maxage=${ttl}` : 'no-store';

  const response = new Response(s3Res.body, { status: s3Res.status, headers: resHeaders });
  if (isListing && s3Res.ok) ctx.waitUntil(cache.put(request, response.clone()));
  return response;
}

// ── S3 listing ──────────────────────────────────────────────────────────────

async function listS3Files({ release, theme, type }) {
  const prefix = `release/${release}/theme=${theme}/type=${type}/`;
  const files = [];
  let marker = '';

  while (true) {
    const listUrl = `${S3_BASE}/?prefix=${prefix}&max-keys=1000${marker ? '&marker=' + marker : ''}`;
    const xml = await (await fetch(listUrl)).text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    files.push(...keys);
    if (!xml.includes('<IsTruncated>true</IsTruncated>')) break;
    marker = encodeURIComponent(keys[keys.length - 1]);
  }

  return files;
}

// ── Parquet bbox extraction ─────────────────────────────────────────────────

async function createAsyncBuffer(url) {
  const res = await fetch(url, { method: 'HEAD' });
  const byteLength = parseInt(res.headers.get('Content-Length'));
  return {
    byteLength,
    async slice(start, end) {
      const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      return await res.arrayBuffer();
    },
  };
}

function extractBbox(metadata) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;

  for (const rg of metadata.row_groups || []) {
    for (const col of rg.columns || []) {
      const stats = col.meta_data?.statistics;
      const path = (col.meta_data?.path_in_schema || []).join('.').toLowerCase();
      if (!stats) continue;

      const minVal = stats.min_value ?? stats.min;
      const maxVal = stats.max_value ?? stats.max;

      if (path.includes('xmin') && minVal != null) {
        const v = typeof minVal === 'number' ? minVal : parseDouble(minVal);
        if (!isNaN(v)) xmin = Math.min(xmin, v);
      }
      if (path.includes('xmax') && maxVal != null) {
        const v = typeof maxVal === 'number' ? maxVal : parseDouble(maxVal);
        if (!isNaN(v)) xmax = Math.max(xmax, v);
      }
      if (path.includes('ymin') && minVal != null) {
        const v = typeof minVal === 'number' ? minVal : parseDouble(minVal);
        if (!isNaN(v)) ymin = Math.min(ymin, v);
      }
      if (path.includes('ymax') && maxVal != null) {
        const v = typeof maxVal === 'number' ? maxVal : parseDouble(maxVal);
        if (!isNaN(v)) ymax = Math.max(ymax, v);
      }
    }
  }

  if (xmin === Infinity) return { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
  return { xmin, xmax, ymin, ymax };
}

function parseDouble(buf) {
  if (!buf || buf.length < 8) return NaN;
  const view = new DataView(buf.buffer || new Uint8Array(buf).buffer);
  return view.getFloat64(0, true);
}

// ── Utilities ───────────────────────────────────────────────────────────────

function withCacheHeader(response, value) {
  const res = new Response(response.body, response);
  res.headers.set('X-Cache', value);
  return res;
}
