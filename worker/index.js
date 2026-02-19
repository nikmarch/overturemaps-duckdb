import { parquetMetadataAsync } from 'hyparquet';

const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';

// URL type -> Overture theme/type
const TYPE_MAP = {
  buildings: { theme: 'buildings', type: 'building' },
  places: { theme: 'places', type: 'place' },
};

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

    // GET /releases
    if (url.pathname === '/releases') {
      return handleReleases(request, ctx);
    }

    // GET /index/:release/:type
    // Returns 200 {status: "ready", index: {...}} or 202 {status:"building"}
    const indexMatch = url.pathname.match(/^\/index\/([^/]+)\/(buildings|places)$/);
    if (indexMatch) {
      const release = indexMatch[1];
      const dataType = indexMatch[2];
      return handleIndex(request, ctx, { release, dataType });
    }

    // GET /files/:type?release=...&xmin=...&xmax=...&ymin=...&ymax=...
    const filesMatch = url.pathname.match(/^\/files\/(buildings|places)$/);
    if (filesMatch) {
      const dataType = filesMatch[1];
      const release = url.searchParams.get('release');
      if (!release) {
        return json(
          { error: 'Missing required query param: release' },
          { status: 400, headers: corsHeaders },
        );
      }
      return handleFiles(request, ctx, { release, dataType, url });
    }

    // Otherwise: S3 proxy (same-origin + Range passthrough + cache listing XML)
    return handleS3Proxy(request, url);
  },
};

function json(body, init = {}) {
  const headers = { ...(init.headers || {}), 'Content-Type': 'application/json', ...corsHeaders };
  return new Response(JSON.stringify(body), { ...init, headers });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheKeyUrl(kind, parts) {
  // Cache API keys are URLs; use a fake stable origin.
  return `https://cache.local/${kind}/${parts.join('/')}`;
}

async function handleReleases(request, ctx) {
  const cache = caches.default;
  const key = new Request(cacheKeyUrl('releases', ['v1']));
  const cached = await cache.match(key);
  if (cached) {
    const res = new Response(cached.body, cached);
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  // Best effort: ask S3 for common prefixes under release/
  const listUrl = `${S3_BASE}/?prefix=release/&delimiter=/&max-keys=1000`;
  const s3Res = await fetch(listUrl);
  const xml = await s3Res.text();

  const releases = extractReleasesFromS3Listing(xml);
  const res = json({ releases }, {
    headers: {
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      'X-Cache': 'MISS',
    },
  });

  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

function extractReleasesFromS3Listing(xml) {
  // Prefer CommonPrefixes entries.
  const prefixes = [...xml.matchAll(/<Prefix>(release\/[^<]+)<\/Prefix>/g)].map((m) => m[1]);
  // If delimiter works, we'll see: release/2026-01-21.0/
  // If not, we might see actual object keys. We normalize both.

  const versions = new Set();

  for (const p of prefixes) {
    const m = p.match(/^release\/([^/]+)\//);
    if (m) versions.add(m[1]);
  }

  // Fallback: infer from <Key> entries.
  if (versions.size === 0) {
    const keys = [...xml.matchAll(/<Key>(release\/[^<]+)<\/Key>/g)].map((m) => m[1]);
    for (const k of keys) {
      const m = k.match(/^release\/([^/]+)\//);
      if (m) versions.add(m[1]);
    }
  }

  return [...versions].sort().reverse();
}

async function handleIndex(request, ctx, { release, dataType }) {
  const cache = caches.default;
  const key = new Request(cacheKeyUrl('index', ['v1', release, dataType]));
  const cached = await cache.match(key);
  if (cached) {
    const res = new Response(cached.body, cached);
    res.headers.set('X-Cache', 'HIT');
    return res;
  }

  // Build in background; caller polls.
  ctx.waitUntil(buildAndCacheIndex(cache, key, { release, dataType }));
  return json(
    { status: 'building', release, type: dataType },
    {
      status: 202,
      headers: {
        'Retry-After': '3',
        'Cache-Control': 'no-store',
        'X-Cache': 'MISS',
      },
    },
  );
}

async function buildAndCacheIndex(cache, keyRequest, { release, dataType }) {
  // Small delay to increase the chance that duplicate requests share work via cache fill,
  // without requiring locks/DO.
  await sleep(50);

  const already = await cache.match(keyRequest);
  if (already) return;

  const { theme, type } = TYPE_MAP[dataType];
  const files = await listFiles({ release, theme, type });

  // Concurrency limit to avoid blowing Worker resources.
  const concurrency = 5;
  const index = {};

  for (let i = 0; i < files.length; i += concurrency) {
    const batch = files.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (file) => {
        try {
          const fileUrl = `${S3_BASE}/${file}`;
          const asyncBuffer = await createAsyncBuffer(fileUrl);
          const metadata = await parquetMetadataAsync(asyncBuffer);
          index[file] = extractBboxFromMetadata(metadata);
        } catch (_e) {
          // Best-effort: if we fail, include the file with a world bbox so it doesn't get dropped.
          index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
        }
      }),
    );
  }

  const res = json(
    { status: 'ready', release, type: dataType, index },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=259200, stale-while-revalidate=604800', // 3 days + SWR 7d
      },
    },
  );

  await cache.put(keyRequest, res);
}

async function handleFiles(request, ctx, { release, dataType, url }) {
  const cache = caches.default;
  const indexKey = new Request(cacheKeyUrl('index', ['v1', release, dataType]));
  const cached = await cache.match(indexKey);

  if (!cached) {
    // Kick off build and tell client to wait.
    ctx.waitUntil(buildAndCacheIndex(cache, indexKey, { release, dataType }));
    return json(
      { status: 'building', release, type: dataType },
      {
        status: 202,
        headers: {
          'Retry-After': '3',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  const { index } = await cached.json();

  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  let files = Object.keys(index);
  const totalFiles = files.length;

  if (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax)) {
    files = files.filter((f) => {
      const fb = index[f];
      return fb.xmax >= xmin && fb.xmin <= xmax && fb.ymax >= ymin && fb.ymin <= ymax;
    });
  }

  // Return URLs relative to this same-origin proxy.
  return json(files.map((f) => `${url.origin}/${f}`), {
    headers: {
      'X-Total-Files': totalFiles.toString(),
      'X-Filtered-Files': files.length.toString(),
      'Cache-Control': 'no-store',
    },
  });
}

async function handleS3Proxy(request, url) {
  const cache = caches.default;
  const isListing = url.search.includes('prefix=');

  if (isListing) {
    const cached = await cache.match(request);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set('X-Cache', 'HIT');
      return response;
    }
  }

  const s3Url = `${S3_BASE}${url.pathname}${url.search}`;
  const s3Request = { method: request.method, headers: {} };

  if (request.headers.has('Range')) {
    s3Request.headers['Range'] = request.headers.get('Range');
  }

  const s3Response = await fetch(s3Url, s3Request);
  const responseHeaders = { ...corsHeaders };
  responseHeaders['Content-Type'] = s3Response.headers.get('Content-Type') || 'application/octet-stream';

  ['Content-Length', 'Content-Range', 'Accept-Ranges'].forEach((h) => {
    if (s3Response.headers.has(h)) responseHeaders[h] = s3Response.headers.get(h);
  });

  responseHeaders['Cache-Control'] = isListing ? 'public, s-maxage=86400' : 'no-store';

  const response = new Response(s3Response.body, {
    status: s3Response.status,
    headers: responseHeaders,
  });

  if (isListing && s3Response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}

async function listFiles({ release, theme, type }) {
  const prefix = `release/${release}/theme=${theme}/type=${type}/`;
  let files = [];
  let marker = '';

  while (true) {
    const listUrl = `${S3_BASE}/?prefix=${prefix}&max-keys=1000${marker ? '&marker=' + marker : ''}`;
    const response = await fetch(listUrl);
    const xml = await response.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
    files.push(...keys);
    if (!xml.includes('<IsTruncated>true</IsTruncated>')) break;
    marker = encodeURIComponent(keys[keys.length - 1]);
  }

  return files;
}

async function createAsyncBuffer(url) {
  const res = await fetch(url, { method: 'HEAD' });
  const fileSize = parseInt(res.headers.get('Content-Length'));

  return {
    byteLength: fileSize,
    async slice(start, end) {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end - 1}` },
      });
      return await res.arrayBuffer();
    },
  };
}

function extractBboxFromMetadata(metadata) {
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;

  for (const rowGroup of metadata.row_groups || []) {
    for (const col of rowGroup.columns || []) {
      const stats = col.meta_data?.statistics;
      const pathParts = col.meta_data?.path_in_schema || [];
      const path = pathParts.join('.').toLowerCase();

      if (!stats) continue;

      const minVal = stats.min_value ?? stats.min;
      const maxVal = stats.max_value ?? stats.max;

      if (path.includes('xmin') && minVal != null) {
        const val = typeof minVal === 'number' ? minVal : parseDoubleFromBuffer(minVal);
        if (!isNaN(val)) xmin = Math.min(xmin, val);
      }
      if (path.includes('xmax') && maxVal != null) {
        const val = typeof maxVal === 'number' ? maxVal : parseDoubleFromBuffer(maxVal);
        if (!isNaN(val)) xmax = Math.max(xmax, val);
      }
      if (path.includes('ymin') && minVal != null) {
        const val = typeof minVal === 'number' ? minVal : parseDoubleFromBuffer(minVal);
        if (!isNaN(val)) ymin = Math.min(ymin, val);
      }
      if (path.includes('ymax') && maxVal != null) {
        const val = typeof maxVal === 'number' ? maxVal : parseDoubleFromBuffer(maxVal);
        if (!isNaN(val)) ymax = Math.max(ymax, val);
      }
    }
  }

  if (xmin === Infinity) return { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
  return { xmin, xmax, ymin, ymax };
}

function parseDoubleFromBuffer(buf) {
  if (!buf || buf.length < 8) return NaN;
  const view = new DataView(buf.buffer || new Uint8Array(buf).buffer);
  return view.getFloat64(0, true);
}
