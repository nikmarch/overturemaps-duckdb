import { getConn } from './duckdb.js';
import { getBbox } from './map.js';

export let intersectionInfoByPointId = new Map();
let intersectionMode = false;
let lastIntersectionSig = null;

export function isIntersectionMode() {
  return intersectionMode;
}

export function setIntersectionMode(v) {
  intersectionMode = !!v;
}

export function clearIntersectionState() {
  intersectionMode = false;
  intersectionInfoByPointId = new Map();
  lastIntersectionSig = null;
}

function intersectionSignature(themeState, currentRelease) {
  const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled).sort();
  const bbox = getBbox();
  return JSON.stringify({
    release: currentRelease,
    enabledKeys,
    bbox: [bbox.xmin, bbox.xmax, bbox.ymin, bbox.ymax].map(n => Number(n.toFixed(6))),
  });
}

export async function recomputeIntersections(themeState, currentRelease) {
  if (!intersectionMode) {
    intersectionInfoByPointId = new Map();
    lastIntersectionSig = null;
    return;
  }

  const conn = getConn();
  if (!conn) return;

  const sig = intersectionSignature(themeState, currentRelease);
  if (sig === lastIntersectionSig) return;
  lastIntersectionSig = sig;

  const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled);
  if (enabledKeys.length < 2) {
    intersectionInfoByPointId = new Map();
    return;
  }

  const pointKeys = [];
  const targetKeys = [];

  for (const key of enabledKeys) {
    const [theme, type] = key.split('/');
    const table = `${theme}_${type}`;
    try {
      const sample = (await conn.query(`SELECT geom_type FROM "${table}" LIMIT 1`)).toArray();
      const gt = (sample?.[0]?.geom_type || '').toUpperCase();
      if (gt.includes('POINT')) pointKeys.push(key);
      else targetKeys.push(key);
    } catch { /* ignore */ }
  }

  if (pointKeys.length === 0 || targetKeys.length === 0) {
    intersectionInfoByPointId = new Map();
    return;
  }

  const bbox = getBbox();
  const hits = new Map();

  for (const pk of pointKeys) {
    const [ptheme, ptype] = pk.split('/');
    const ptable = `${ptheme}_${ptype}`;

    for (const tk of targetKeys) {
      const [ttheme, ttype] = tk.split('/');
      const ttable = `${ttheme}_${ttype}`;
      const label = `${ttheme}/${ttype}`;

      const q = `
        SELECT p.id AS pid
        FROM "${ptable}" p
        JOIN "${ttable}" t
          ON t.bbox.xmax >= p.centroid_lon
         AND t.bbox.xmin <= p.centroid_lon
         AND t.bbox.ymax >= p.centroid_lat
         AND t.bbox.ymin <= p.centroid_lat
        WHERE p.centroid_lon BETWEEN ${bbox.xmin} AND ${bbox.xmax}
          AND p.centroid_lat BETWEEN ${bbox.ymin} AND ${bbox.ymax}
          AND t.centroid_lon BETWEEN ${bbox.xmin} AND ${bbox.xmax}
          AND t.centroid_lat BETWEEN ${bbox.ymin} AND ${bbox.ymax}
          AND ST_Intersects(t.geometry, p.geometry)
      `;

      try {
        const rows = (await conn.query(q)).toArray();
        for (const r of rows) {
          const arr = hits.get(r.pid) || [];
          if (!arr.includes(label)) arr.push(label);
          hits.set(r.pid, arr);
        }
      } catch (e) {
        console.warn('intersection query failed for', pk, 'x', tk, e?.message);
      }
    }
  }

  intersectionInfoByPointId = new Map(
    [...hits.entries()].map(([id, arr]) => [id, { hits: arr }])
  );
}
