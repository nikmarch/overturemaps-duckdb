import { tableFromIPC } from '@uwdata/flechette';
import { PROXY } from './constants.js';

/**
 * Stream Arrow IPC frames from the worker.
 * Binary frame format per file:
 *   [4-byte LE uint32 length][Arrow IPC bytes]   — data frame
 *   [4-byte 0x00000000][4-byte LE len][JSON]     — error frame
 *
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
  let buf = new Uint8Array(0);
  let fileIndex = 0;
  const totalFiles = params.files.length;

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      const merged = new Uint8Array(buf.length + value.length);
      merged.set(buf);
      merged.set(value, buf.length);
      buf = merged;
    }

    // Parse frames from buffer
    while (buf.length >= 4) {
      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const frameLen = view.getUint32(0, true);

      if (frameLen === 0) {
        // Error frame: [4-byte 0][4-byte error-json-len][error JSON]
        if (buf.length < 8) break;
        const errLen = view.getUint32(4, true);
        if (buf.length < 8 + errLen) break;
        const errJson = new TextDecoder().decode(buf.slice(8, 8 + errLen));
        const errObj = JSON.parse(errJson);
        console.warn(`File ${errObj.file} query error: ${errObj.error}`);
        buf = buf.slice(8 + errLen);
        fileIndex++;
      } else {
        // Data frame: [4-byte length][Arrow IPC bytes]
        if (buf.length < 4 + frameLen) break;
        const ipcBytes = buf.slice(4, 4 + frameLen);
        buf = buf.slice(4 + frameLen);

        try {
          const table = tableFromIPC(ipcBytes);
          const rows = arrowTableToRows(table);
          allRows.push(...rows);
          if (onBatch) onBatch(rows, fileIndex, totalFiles);
        } catch (e) {
          console.warn(`File ${fileIndex} Arrow parse error:`, e);
        }
        fileIndex++;
      }
    }

    if (done) break;
  }

  return { rows: allRows, rowCount: allRows.length };
}

/**
 * Convert a Flechette Table to an array of plain JS row objects.
 * Uses column-oriented extraction — falls back to row-by-row for
 * columns where toArray() fails (e.g. nested structs/lists).
 */
function arrowTableToRows(table) {
  const numRows = table.numRows;
  if (numRows === 0) return [];

  const fields = table.schema.fields;
  const columns = [];
  for (const f of fields) {
    const child = table.getChild(f.name);
    let data;
    try {
      data = child.toArray();
    } catch {
      // toArray() fails for some nested types — extract row by row
      data = Array.from({ length: numRows }, (_, i) => child.at(i));
    }
    columns.push({ name: f.name, data });
  }

  const rows = new Array(numRows);
  for (let i = 0; i < numRows; i++) {
    const row = {};
    for (const col of columns) {
      row[col.name] = col.data[i];
    }
    rows[i] = row;
  }
  return rows;
}
