// Proxy /api/* to the worker
const WORKER_URL = 'https://overture-s3-proxy.zarbazan.workers.dev';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api/, '');
  const workerUrl = `${WORKER_URL}${path}${url.search}`;

  const response = await fetch(workerUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.method !== 'GET' && context.request.method !== 'HEAD'
      ? context.request.body
      : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
