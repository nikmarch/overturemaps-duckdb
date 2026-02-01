const S3_BASE = 'https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com';

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

    // S3 proxy with caching for listings
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
