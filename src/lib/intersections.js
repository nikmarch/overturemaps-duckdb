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

// Disabled: requires ST_Intersects (spatial extension not available in worker DuckDB).
// Can be re-enabled later with client-side geometry intersection (e.g. turf.js).
export async function recomputeIntersections(themeState, currentRelease) {
  intersectionInfoByPointId = new Map();
  lastIntersectionSig = null;
}
