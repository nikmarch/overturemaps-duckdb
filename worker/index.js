import { parquetMetadataAsync } from 'hyparquet';

const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';

// Cache TTLs: production = 1 day, dev/preview = 1 minute
function cacheTtl(env) {
  return env.ENVIRONMENT === 'production' ? 86400 : 60;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers':
    'Content-Length, Content-Range, Accept-Ranges, X-Total-Files, X-Filtered-Files, X-Cache, Retry-After',
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    const ttl = cacheTtl(env);

    if (url.pathname === '/releases') return handleReleases(ctx, ttl);
    if (url.pathname === '/themes') return handleThemes(ctx, url, ttl);
    if (url.pathname === '/files') return handleFiles(ctx, url, ttl);

    // S3 proxy: passthrough for /release/... parquet files and listing XML
    return handleS3Proxy(request, ctx, url, ttl);
  },
};

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
// Returns [{theme, type}, ...] by listing S3 prefixes for a release.

async function handleThemes(ctx, url, ttl) {
  const release = url.searchParams.get('release');
  if (!release) return json({ error: 'Missing ?release' }, { status: 400 });

  const cache = caches.default;
  const key = cacheKey('themes', [release]);
  const hit = await cache.match(key);
  if (hit) return withCacheHeader(hit, 'HIT');

  // List theme= prefixes under this release
  const listUrl = `${S3_BASE}/?prefix=release/${release}/&delimiter=/&max-keys=1000`;
  const xml = await (await fetch(listUrl)).text();

  // Prefixes look like: release/2026-02-18.0/theme=buildings/
  const themePrefixes = [...xml.matchAll(/<Prefix>(release\/[^<]+)<\/Prefix>/g)].map(m => m[1]);
  const themes = [];

  // For each theme, list type= prefixes
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
// Lists parquet files, optionally filtered by bbox using parquet metadata.

async function handleFiles(ctx, url, ttl) {
  const release = url.searchParams.get('release');
  const theme = url.searchParams.get('theme');
  const type = url.searchParams.get('type');
  if (!release || !theme || !type) {
    return json({ error: 'Missing required params: release, theme, type' }, { status: 400 });
  }

  const cache = caches.default;
  const indexKey = cacheKey('index', [release, theme, type]);
  const hit = await cachedJson(cache, indexKey);

  let index;
  if (hit) {
    index = hit.data;
  } else {
    // Build index: list all files + extract bbox from parquet metadata
    const files = await listS3Files({ release, theme, type });
    index = await buildBboxIndex(files);
    const indexRes = json(index, {
      headers: { 'Cache-Control': `public, s-maxage=${ttl}` },
    });
    ctx.waitUntil(cache.put(indexKey, indexRes));
  }

  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  let files = Object.keys(index);
  const totalFiles = files.length;

  if (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax)) {
    files = files.filter(f => {
      const b = index[f];
      return b.xmax >= xmin && b.xmin <= xmax && b.ymax >= ymin && b.ymin <= ymax;
    });
  }

  // Return bare S3 keys (UI prepends origin)
  return json(files, {
    headers: {
      'X-Total-Files': totalFiles.toString(),
      'X-Filtered-Files': files.length.toString(),
      'X-Cache': hit ? 'HIT' : 'MISS',
      'Cache-Control': 'no-store',
    },
  });
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

