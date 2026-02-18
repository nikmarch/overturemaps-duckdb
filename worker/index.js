import { parquetMetadataAsync } from 'hyparquet';

const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, X-Total-Files, X-Filtered-Files',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /releases - list available Overture releases
    if (url.pathname === '/releases') {
      return handleListReleases();
    }

    // GET /themes?release=X - list theme/type combos for a release
    if (url.pathname === '/themes') {
      const release = url.searchParams.get('release');
      if (!release) return new Response('Missing release param', { status: 400, headers: corsHeaders });
      return handleListThemes(release);
    }

    // GET /files?release=X&theme=Y&type=Z&xmin=...&xmax=...&ymin=...&ymax=...
    if (url.pathname === '/files') {
      const release = url.searchParams.get('release');
      const theme = url.searchParams.get('theme');
      const type = url.searchParams.get('type');
      if (!release || !theme || !type) {
        return new Response('Missing release/theme/type params', { status: 400, headers: corsHeaders });
      }
      const doName = `${release}/${theme}/${type}`;
      const id = env.SPATIAL_INDEX.idFromName(doName);
      const stub = env.SPATIAL_INDEX.get(id);
      return stub.fetch(request);
    }

    // GET /index/clear?release=X&theme=Y&type=Z
    if (url.pathname === '/index/clear') {
      const release = url.searchParams.get('release');
      const theme = url.searchParams.get('theme');
      const type = url.searchParams.get('type');
      if (!release || !theme || !type) {
        return new Response('Missing release/theme/type params', { status: 400, headers: corsHeaders });
      }
      const doName = `${release}/${theme}/${type}`;
      const id = env.SPATIAL_INDEX.idFromName(doName);
      const stub = env.SPATIAL_INDEX.get(id);
      await stub.fetch(new Request('http://internal/clear'));
      return new Response(JSON.stringify({ cleared: doName }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // GET /index/status?release=X&theme=Y&type=Z
    if (url.pathname === '/index/status') {
      const release = url.searchParams.get('release');
      const theme = url.searchParams.get('theme');
      const type = url.searchParams.get('type');
      if (!release || !theme || !type) {
        return new Response('Missing release/theme/type params', { status: 400, headers: corsHeaders });
      }
      const doName = `${release}/${theme}/${type}`;
      const id = env.SPATIAL_INDEX.idFromName(doName);
      const stub = env.SPATIAL_INDEX.get(id);
      const res = await stub.fetch(new Request('http://internal/status'));
      return new Response(res.body, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // S3 proxy
    return handleS3Proxy(request, url);
  }
};

async function handleListReleases() {
  const listUrl = `${S3_BASE}/?prefix=release/&delimiter=/`;
  const response = await fetch(listUrl);
  const xml = await response.text();
  const releases = [...xml.matchAll(/<Prefix>release\/([^<]+)\/<\/Prefix>/g)]
    .map(m => m[1])
    .sort()
    .reverse();
  return new Response(JSON.stringify(releases), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
  });
}

async function handleListThemes(release) {
  const prefix = `release/${release}/`;
  const listUrl = `${S3_BASE}/?prefix=${encodeURIComponent(prefix)}&delimiter=/`;
  const response = await fetch(listUrl);
  const xml = await response.text();
  const themePrefixes = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
    .map(m => m[1])
    .filter(p => p.includes('theme='));

  const results = [];
  for (const themePrefix of themePrefixes) {
    const themeMatch = themePrefix.match(/theme=([^/]+)/);
    if (!themeMatch) continue;
    const theme = themeMatch[1];

    const typeUrl = `${S3_BASE}/?prefix=${encodeURIComponent(themePrefix)}&delimiter=/`;
    const typeResponse = await fetch(typeUrl);
    const typeXml = await typeResponse.text();
    const types = [...typeXml.matchAll(/<Prefix>[^<]*type=([^/<]+)\/<\/Prefix>/g)]
      .map(m => m[1]);

    for (const type of types) {
      results.push({ theme, type });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' }
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

  ['Content-Length', 'Content-Range', 'Accept-Ranges'].forEach(h => {
    if (s3Response.headers.has(h)) responseHeaders[h] = s3Response.headers.get(h);
  });

  responseHeaders['Cache-Control'] = isListing ? 'public, max-age=86400' : 'no-store';

  const response = new Response(s3Response.body, {
    status: s3Response.status,
    headers: responseHeaders,
  });

  if (isListing && s3Response.ok) {
    await cache.put(request, response.clone());
  }

  return response;
}

// Durable Object for spatial index
export class SpatialIndex {
  constructor(state, env) {
    this.state = state;
    this.index = null;
    this.building = false;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/clear') {
      this.index = null;
      await this.state.storage.delete('index');
      await this.state.storage.delete('meta');
      return new Response(JSON.stringify({ cleared: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (url.pathname === '/status') {
      const meta = await this.state.storage.get('meta');
      const sample = this.index ? Object.entries(this.index).slice(0, 2) : [];
      return new Response(JSON.stringify({
        ready: this.index !== null,
        building: this.building,
        fileCount: this.index ? Object.keys(this.index).length : 0,
        meta: meta || null,
        sample: sample.map(([file, bbox]) => ({ file: file.split('/').pop(), ...bbox })),
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Read params from query string
    const release = url.searchParams.get('release');
    const theme = url.searchParams.get('theme');
    const type = url.searchParams.get('type');

    if (!release || !theme || !type) {
      return new Response('Missing release/theme/type params', { status: 400 });
    }

    const prefix = `release/${release}/theme=${theme}/type=${type}/`;

    // Load from storage if not in memory
    if (!this.index && !this.building) {
      const stored = await this.state.storage.get('index');
      if (stored) {
        this.index = stored;
        console.log(`Loaded ${theme}/${type} index from storage: ${Object.keys(this.index).length} files`);
      }
    }

    // Build index if needed
    if (!this.index && !this.building) {
      this.building = true;
      try {
        this.index = await this.buildIndex(prefix, `${theme}/${type}`);
        await this.state.storage.put('index', this.index);
        await this.state.storage.put('meta', { release, theme, type, builtAt: new Date().toISOString() });
        console.log(`Saved ${theme}/${type} index to storage`);
      } finally {
        this.building = false;
      }
    }

    while (this.building) {
      await new Promise(r => setTimeout(r, 100));
    }

    // Filter files by bbox
    const xmin = parseFloat(url.searchParams.get('xmin'));
    const xmax = parseFloat(url.searchParams.get('xmax'));
    const ymin = parseFloat(url.searchParams.get('ymin'));
    const ymax = parseFloat(url.searchParams.get('ymax'));

    let files = Object.keys(this.index);
    const totalFiles = files.length;

    if (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax)) {
      files = files.filter(f => {
        const fb = this.index[f];
        return fb.xmax >= xmin && fb.xmin <= xmax && fb.ymax >= ymin && fb.ymin <= ymax;
      });
    }

    return new Response(JSON.stringify(files), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'X-Total-Files': totalFiles.toString(),
        'X-Filtered-Files': files.length.toString(),
      }
    });
  }

  async buildIndex(prefix, label) {
    console.log(`Building ${label} spatial index...`);
    const start = Date.now();
    const files = await listFiles(prefix);
    const index = {};

    const batchSize = 10;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);

      await Promise.all(batch.map(async (file, idx) => {
        try {
          const fileUrl = `${S3_BASE}/${file}`;
          const asyncBuffer = await createAsyncBuffer(fileUrl);
          const metadata = await parquetMetadataAsync(asyncBuffer);
          const debug = i === 0 && idx === 0;
          index[file] = extractBboxFromMetadata(metadata, debug);
        } catch (e) {
          console.error(`Error indexing ${file}:`, e.message);
          index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
        }
      }));

      console.log(`${label}: Indexed ${Math.min(i + batchSize, files.length)}/${files.length} files`);
    }

    console.log(`${label} index built in ${((Date.now() - start) / 1000).toFixed(1)}s for ${files.length} files`);
    return index;
  }
}

async function listFiles(prefix) {
  let files = [], marker = '';

  while (true) {
    const listUrl = `${S3_BASE}/?prefix=${prefix}&max-keys=1000${marker ? '&marker=' + marker : ''}`;
    const response = await fetch(listUrl);
    const xml = await response.text();
    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
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
        headers: { Range: `bytes=${start}-${end - 1}` }
      });
      return await res.arrayBuffer();
    }
  };
}

function extractBboxFromMetadata(metadata, debug = false) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;

  for (const rowGroup of (metadata.row_groups || [])) {
    for (const col of (rowGroup.columns || [])) {
      const stats = col.meta_data?.statistics;
      const pathParts = col.meta_data?.path_in_schema || [];
      const path = pathParts.join('.').toLowerCase();

      if (debug && path.includes('bbox')) {
        console.log('Found bbox column:', path, 'stats:', JSON.stringify(stats));
      }

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
