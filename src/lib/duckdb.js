import { PROXY } from './constants.js';

export const S3_HOST = 'https://data.overture';

export async function query(sql) {
  const res = await fetch(`${PROXY}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Query failed: ${res.status}`);
  }
  return res.json();
}
