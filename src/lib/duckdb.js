import { PROXY } from './constants.js';

/**
 * Stream query results from the worker.
 * Calls onBatch(rows, fileIndex, totalFiles) as each file completes.
 * Returns the full collected rows array.
 */
export async function query(params, onBatch) {
  const res = await fetch(`${PROXY}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Query failed: ${res.status}`);
  }

  const allRows = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let newlineIdx;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line) continue;

      const chunk = JSON.parse(line);
      if (chunk.error) {
        console.warn(`File ${chunk.file} query error: ${chunk.error}`);
        continue;
      }
      allRows.push(...chunk.rows);
      if (onBatch) onBatch(chunk.rows, chunk.file, chunk.total);
    }

    if (done) break;
  }

  return { rows: allRows, rowCount: allRows.length };
}
