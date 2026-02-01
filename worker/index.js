const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';
const RELEASE = '2026-01-21.0';

// In-memory index: file -> {xmin, xmax, ymin, ymax}
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

    // Handle /files/buildings?xmin=...&xmax=...&ymin=...&ymax=...
    if (url.pathname === '/files/buildings') {
      return handleBuildingsRequest(url, corsHeaders);
    }

    // Handle /index/status - check if index is built
    if (url.pathname === '/index/status') {
      return new Response(JSON.stringify({
        built: buildingsIndex !== null,
        fileCount: buildingsIndex ? Object.keys(buildingsIndex).length : 0,
        building: indexBuildPromise !== null
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

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

    const s3Request = {
      method: request.method,
      headers: {},
    };

    if (request.headers.has('Range')) {
      s3Request.headers['Range'] = request.headers.get('Range');
    }

    const s3Response = await fetch(s3Url, s3Request);

    const responseHeaders = { ...corsHeaders };
    responseHeaders['Content-Type'] = s3Response.headers.get('Content-Type') || 'application/octet-stream';

    if (s3Response.headers.has('Content-Length')) {
      responseHeaders['Content-Length'] = s3Response.headers.get('Content-Length');
    }
    if (s3Response.headers.has('Content-Range')) {
      responseHeaders['Content-Range'] = s3Response.headers.get('Content-Range');
    }
    if (s3Response.headers.has('Accept-Ranges')) {
      responseHeaders['Accept-Ranges'] = s3Response.headers.get('Accept-Ranges');
    }

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
  let files = [];
  let marker = '';

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

async function buildIndex() {
  console.log('Building spatial index...');
  const start = Date.now();
  const files = await listFiles('buildings', 'building');
  const index = {};

  // Read parquet footer from each file to get bbox statistics
  // Parquet footer is at the end of file, last 8 bytes contain footer size
  await Promise.all(files.map(async (file) => {
    try {
      const fileUrl = `${S3_BASE}/${file}`;

      // Get file size first
      const headResponse = await fetch(fileUrl, { method: 'HEAD' });
      const fileSize = parseInt(headResponse.headers.get('Content-Length'));

      // Read last 8 bytes to get footer size (4 bytes magic + 4 bytes footer length)
      const tailResponse = await fetch(fileUrl, {
        headers: { 'Range': `bytes=${fileSize - 8}-${fileSize - 1}` }
      });
      const tailBuffer = await tailResponse.arrayBuffer();
      const tailView = new DataView(tailBuffer);
      const footerSize = tailView.getInt32(0, true); // little-endian

      // Read footer
      const footerStart = fileSize - 8 - footerSize;
      const footerResponse = await fetch(fileUrl, {
        headers: { 'Range': `bytes=${footerStart}-${fileSize - 9}` }
      });
      const footerBuffer = await footerResponse.arrayBuffer();

      // Parse Thrift-encoded footer to extract row group statistics
      // This is complex - for now, use a simpler approach:
      // Just mark the file as having unknown bbox (will be included in all queries)
      index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };

    } catch (e) {
      console.error(`Error indexing ${file}:`, e.message);
      index[file] = { xmin: -180, xmax: 180, ymin: -90, ymax: 90 };
    }
  }));

  console.log(`Index built in ${Date.now() - start}ms for ${files.length} files`);
  return index;
}

async function handleBuildingsRequest(url, corsHeaders) {
  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  // Build index if not exists
  if (!buildingsIndex && !indexBuildPromise) {
    indexBuildPromise = buildIndex().then(idx => {
      buildingsIndex = idx;
      indexBuildPromise = null;
    });
  }

  // Wait for index if building
  if (indexBuildPromise) {
    await indexBuildPromise;
  }

  // Filter files by bbox
  let files = Object.keys(buildingsIndex);
  let filtered = false;

  if (!isNaN(xmin) && !isNaN(xmax) && !isNaN(ymin) && !isNaN(ymax)) {
    const original = files.length;
    files = files.filter(f => {
      const fb = buildingsIndex[f];
      return fb.xmax >= xmin && fb.xmin <= xmax && fb.ymax >= ymin && fb.ymin <= ymax;
    });
    filtered = files.length < original;
  }

  const proxyUrls = files.map(f => `${url.origin}/${f}`);

  return new Response(JSON.stringify(proxyUrls), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Total-Files': Object.keys(buildingsIndex).length.toString(),
      'X-Filtered-Files': files.length.toString(),
      'X-Filtered': filtered.toString(),
    }
  });
}
