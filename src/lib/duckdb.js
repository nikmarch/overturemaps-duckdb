import { tableFromIPC } from '@uwdata/flechette';

/**
 * Fetch a single geohash tile and parse the framed Arrow IPC response.
 * Returns { rows } or { rows: [] } on 204/error.
 */
export async function queryTile(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (res.status === 204 || !res.ok) return { rows: [] };

  const buf = new Uint8Array(await res.arrayBuffer());
  const rows = [];
  let offset = 0;

  while (offset + 4 <= buf.length) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset);
    const frameLen = view.getUint32(0, true);

    if (frameLen === 0) {
      // Error frame — skip
      if (offset + 8 > buf.length) break;
      const errLen = view.getUint32(4, true);
      offset += 8 + errLen;
    } else {
      if (offset + 4 + frameLen > buf.length) break;
      const ipcBytes = buf.slice(offset + 4, offset + 4 + frameLen);
      offset += 4 + frameLen;
      try {
        const table = tableFromIPC(ipcBytes);
        rows.push(...arrowTableToRows(table));
      } catch (e) {
        console.warn('Tile Arrow parse error:', e);
      }
    }
  }

  return { rows };
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
