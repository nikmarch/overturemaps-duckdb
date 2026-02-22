// Proxy /release/* to the worker (S3 parquet files)
const WORKER_URL = 'https://overture-s3-proxy.zarbazan.workers.dev';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const workerUrl = `${WORKER_URL}${url.pathname}${url.search}`;

  const headers = new Headers();
  // Forward range requests for efficient parquet reads
  if (context.request.headers.has('Range')) {
    headers.set('Range', context.request.headers.get('Range'));
  }

  const response = await fetch(workerUrl, {
    method: context.request.method,
    headers,
  });

  // Copy relevant headers
  const responseHeaders = new Headers();
  ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges',
   'Access-Control-Allow-Origin', 'Access-Control-Allow-Methods',
   'Access-Control-Allow-Headers', 'Cache-Control'].forEach(h => {
    if (response.headers.has(h)) {
      responseHeaders.set(h, response.headers.get(h));
    }
  });

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}
