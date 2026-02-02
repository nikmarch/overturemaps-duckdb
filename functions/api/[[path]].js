// Proxy /api/* to the worker
const WORKER_URL = 'https://overture-s3-proxy.nik-d71.workers.dev';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const workerUrl = `${WORKER_URL}${path}${url.search}`;

  const response = await fetch(workerUrl, {
    method: context.request.method,
    headers: context.request.headers,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
