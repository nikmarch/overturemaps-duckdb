const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';
const RELEASE = '2026-01-21.0';

// TODO: Build this index by scanning parquet footers once
// Maps file -> {xmin, xmax, ymin, ymax} from row group statistics
const FILE_BBOX_INDEX = null; // Will be populated later

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
      return handleFilesRequest(url, corsHeaders, 'buildings', 'building');
    }
    if (url.pathname === '/files/places') {
      return handleFilesRequest(url, corsHeaders, 'places', 'place');
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

async function handleFilesRequest(url, corsHeaders, theme, type) {
  const xmin = parseFloat(url.searchParams.get('xmin'));
  const xmax = parseFloat(url.searchParams.get('xmax'));
  const ymin = parseFloat(url.searchParams.get('ymin'));
  const ymax = parseFloat(url.searchParams.get('ymax'));

  // List all files
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

  // TODO: Filter files by bbox using FILE_BBOX_INDEX
  // For now, return all files (no filtering)
  // When index is built, filter like:
  // files = files.filter(f => {
  //   const fb = FILE_BBOX_INDEX[f];
  //   return fb && fb.xmax >= xmin && fb.xmin <= xmax && fb.ymax >= ymin && fb.ymin <= ymax;
  // });

  const proxyUrls = files.map(f => `${url.origin}/${f}`);

  return new Response(JSON.stringify(proxyUrls), {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'X-Total-Files': files.length.toString(),
      'X-Filtered': 'false', // Will be 'true' when index is implemented
    }
  });
}
