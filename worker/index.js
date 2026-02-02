import { parquetMetadataAsync } from 'hyparquet';

const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';
const RELEASE = '2026-01-21.0';

// Spatial indices: file -> {xmin, xmax, ymin, ymax}
const indices = { buildings: null, places: null };
const indexPromises = { buildings: null, places: null };

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /files/:type?xmin=...&xmax=...&ymin=...&ymax=...
    const filesMatch = url.pathname.match(/^\/files\/(buildings|places)$/);
    if (filesMatch) {
      const type = filesMatch[1];
      return handleFilesRequest(url, corsHeaders, type);
    }

    // GET /index/status
    if (url.pathname === '/index/status') {
      const status = {};
      for (const type of ['buildings', 'places']) {
        const idx = indices[type];
        const sample = idx ? Object.entries(idx).slice(0, 2) : [];
        status[type] = {
          ready: idx !== null,
          building: indexPromises[type] !== null,
          fileCount: idx ? Object.keys(idx).length : 0,
          sample: sample.map(([file, bbox]) => ({ file: file.split('/').pop(), ...bbox })),
        };
      }
      return new Response(JSON.stringify(status), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // S3 proxy
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
};

async function listFiles(theme, type) {
  const prefix = `release/${RELEASE}/theme=${theme}/type=${type}/`;
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

// Create an AsyncBuffer for hyparquet to read remote files
function createAsyncBuffer(url) {
  let fileSize = null;

  return {
    async byteLength() {
      if (fileSize === null) {
        const res = await fetch(url, { method: 'HEAD' });
        fileSize = parseInt(res.headers.get('Content-Length'));
      }
      return fileSize;
    },
    async slice(start, end) {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end - 1}` }
      });
      return await res.arrayBuffer();
    }
  };
}

// Extract bbox bounds from parquet row group statistics
function extractBboxFromMetadata(metadata, debug = false) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;

  // Extract min/max from row group statistics
  for (const rowGroup of (metadata.row_groups || [])) {
    for (const col of (rowGroup.columns || [])) {
      const stats = col.meta_data?.statistics;
      const pathParts = col.meta_data?.path_in_schema || [];
      const path = pathParts.join('.').toLowerCase();

      if (debug && path.includes('bbox')) {
        console.log('Found bbox column:', path, 'stats:', JSON.stringify(stats));
      }

      if (!stats) continue;

      // Handle both min_value/max_value and min/max
      const minVal = stats.min_value ?? stats.min;
      const maxVal = stats.max_value ?? stats.max;

      if (path.includes('xmin') && minVal != null) {
        // Stats might be a buffer/typed array for doubles
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
  return view.getFloat64(0, true); // little-endian
}

// Type mapping: URL type -> Overture theme/type
const TYPE_MAP = {
  buildings: { theme: 'buildings', type: 'building' },
  places: { theme: 'places', type: 'place' },
};

async function buildIndex(dataType) {
  const { theme, type } = TYPE_MAP[dataType];
  console.log(`Building ${dataType} spatial index with hyparquet...`);
  const start = Date.now();
  const files = await listFiles(theme, type);
  const index = {};

  // Process in batches
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);

    await Promise.all(batch.map(async (file, idx) => {
      try {
        const fileUrl = `${S3_BASE}/${file}`;
        const asyncBuffer = createAsyncBuffer(fileUrl);
        const metadata = await parquetMetadataAsync(asyncBuffer);
        const debug = i === 0 && idx === 0;
        index[file] = extractBboxFromMetadata(metadata, debug);
      } catch (e) {
        console.error(`Error indexing ${file}:`, e.message);
        index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
      }
    }));

    console.log(`${dataType}: Indexed ${Math.min(i + batchSize, files.length)}/${files.length} files`);
  }

  console.log(`${dataType} index built in ${((Date.now() - start) / 1000).toFixed(1)}s for ${files.length} files`);
  return index;
}

async function handleFilesRequest(url, corsHeaders, dataType) {
  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  // Build index if not ready
  if (!indices[dataType] && !indexPromises[dataType]) {
    indexPromises[dataType] = buildIndex(dataType).then(idx => {
      indices[dataType] = idx;
      indexPromises[dataType] = null;
    });
  }

  if (indexPromises[dataType]) {
    await indexPromises[dataType];
  }

  // Filter files by bbox intersection
  let files = Object.keys(indices[dataType]);
  const totalFiles = files.length;

  if (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax)) {
    files = files.filter(f => {
      const fb = indices[dataType][f];
      return fb.xmax >= xmin && fb.xmin <= xmax && fb.ymax >= ymin && fb.ymin <= ymax;
    });
  }

  return new Response(JSON.stringify(files.map(f => `${url.origin}/${f}`)), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Total-Files': totalFiles.toString(),
      'X-Filtered-Files': files.length.toString(),
    }
  });
}
