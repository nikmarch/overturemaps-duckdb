const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';
const RELEASE = '2026-01-21.0';

// In-memory spatial index: file -> {xmin, xmax, ymin, ymax}
let buildingsIndex = null;
let indexBuildPromise = null;

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

    if (url.pathname === '/files/buildings') {
      return handleBuildingsRequest(url, corsHeaders);
    }

    if (url.pathname === '/index/status') {
      return new Response(JSON.stringify({
        ready: buildingsIndex !== null,
        building: indexBuildPromise !== null,
        fileCount: buildingsIndex ? Object.keys(buildingsIndex).length : 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // S3 proxy with caching
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

// Extract bbox from GeoParquet file metadata
async function extractBbox(fileUrl) {
  // Get file size
  const headResponse = await fetch(fileUrl, { method: 'HEAD' });
  const fileSize = parseInt(headResponse.headers.get('Content-Length'));

  // Read last 8 bytes: 4-byte footer length + 4-byte "PAR1" magic
  const tailResponse = await fetch(fileUrl, {
    headers: { 'Range': `bytes=${fileSize - 8}-${fileSize - 1}` }
  });
  const tailBuffer = await tailResponse.arrayBuffer();
  const tailView = new DataView(tailBuffer);
  const footerSize = tailView.getInt32(0, true);

  // Read footer (limit to first 50KB to find geo metadata)
  const footerStart = fileSize - 8 - footerSize;
  const readSize = Math.min(footerSize, 50000);
  const footerResponse = await fetch(fileUrl, {
    headers: { 'Range': `bytes=${footerStart}-${footerStart + readSize - 1}` }
  });
  const footerBuffer = await footerResponse.arrayBuffer();
  const footerBytes = new Uint8Array(footerBuffer);

  // Search for "geo" key followed by JSON with bbox
  const text = new TextDecoder().decode(footerBytes);
  const geoMatch = text.match(/"bbox":\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]/);

  if (geoMatch) {
    return {
      xmin: parseFloat(geoMatch[1]),
      ymin: parseFloat(geoMatch[2]),
      xmax: parseFloat(geoMatch[3]),
      ymax: parseFloat(geoMatch[4])
    };
  }

  // Fallback: world bbox
  return { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
}

async function buildIndex() {
  console.log('Building spatial index...');
  const start = Date.now();
  const files = await listFiles('buildings', 'building');
  const index = {};

  // Process files in batches to avoid overwhelming the worker
  const batchSize = 20;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    await Promise.all(batch.map(async (file) => {
      try {
        index[file] = await extractBbox(`${S3_BASE}/${file}`);
      } catch (e) {
        console.error(`Error indexing ${file}:`, e.message);
        index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
      }
    }));
  }

  console.log(`Index built in ${((Date.now() - start) / 1000).toFixed(1)}s for ${files.length} files`);
  return index;
}

async function handleBuildingsRequest(url, corsHeaders) {
  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  // Start building index if not started
  if (!buildingsIndex && !indexBuildPromise) {
    indexBuildPromise = buildIndex().then(idx => {
      buildingsIndex = idx;
      indexBuildPromise = null;
    });
  }

  // Wait for index
  if (indexBuildPromise) {
    await indexBuildPromise;
  }

  // Filter files by bbox intersection
  let files = Object.keys(buildingsIndex);
  const totalFiles = files.length;

  if (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax)) {
    files = files.filter(f => {
      const fb = buildingsIndex[f];
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
