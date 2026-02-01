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

    const s3Url = `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com${url.pathname}${url.search}`;

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
