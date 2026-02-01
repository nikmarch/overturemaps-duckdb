export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const cache = caches.default;
    const isListing = url.search.includes('prefix=');

    // Check cache for file listings
    if (isListing) {
      const cached = await cache.match(request);
      if (cached) {
        const response = new Response(cached.body, cached);
        response.headers.set('X-Cache', 'HIT');
        return response;
      }
    }

    // Proxy to S3
    const s3Url = `https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com${url.pathname}${url.search}`;
    const s3Response = await fetch(s3Url);

    const response = new Response(s3Response.body, {
      status: s3Response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': s3Response.headers.get('Content-Type') || 'application/xml',
        'Cache-Control': isListing ? 'public, max-age=86400' : 'no-store',
      }
    });

    // Cache listing responses
    if (isListing && s3Response.ok) {
      await cache.put(request, response.clone());
    }

    return response;
  }
};
