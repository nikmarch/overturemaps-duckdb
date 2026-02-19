import { PROXY } from './constants.js';
import { dropAllTables } from './duckdb.js';
import { getMap, getBbox, getViewportString } from './map.js';
import {
  onReleaseChange, toggleTheme, setThemeLimit,
  themeState, currentRelease,
  clearAllThemes, updateStats,
  enableThemeFromCache, disableTheme,
} from './themes.js';
import { clearIntersectionState, setIntersectionMode, recomputeIntersections } from './intersections.js';
import { clearSnapviews, setShowSnapviews } from './snapviews.js';
import { rerenderAllEnabled } from './themes.js';
import {
  status as statusStore,
  viewportStats as viewportStatsStore,
  showSnapviews as showSnapviewsStore,
  highlightIntersections as highlightIntersectionsStore,
  activeSnapview as activeSnapviewStore,
  snapviews as snapviewsStore,
  createSnapview,
  addSnapviewKey,
  removeSnapviewKey,
  getSnapview,
  updateSnapviewTheme,
  checkSnapviewComplete,
} from './stores.js';
import { get } from 'svelte/store';

export { onReleaseChange as setRelease };
export { toggleTheme };
export { setThemeLimit };

// The currently active snapview id
let activeSnapviewId = null;

function bboxKey(bbox) {
  return [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax].map(n => n.toFixed(5)).join(',');
}

// Get or create a snapview for the current bbox
function getOrCreateActiveSnapview(bbox, keys) {
  // If there's an active loading snapview at the same bbox, reuse it
  if (activeSnapviewId) {
    const sv = getSnapview(activeSnapviewId);
    if (sv && sv.status === 'loading' && bboxKey(sv.bbox) === bboxKey(bbox)) {
      // Add any new keys
      for (const key of keys) {
        if (!sv.keys.includes(key)) {
          addSnapviewKey(activeSnapviewId, key);
        }
      }
      return activeSnapviewId;
    }
  }

  // Create a new snapview
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  createSnapview(id, bbox, keys);
  return id;
}

export function onMapMove() {
  viewportStatsStore.update(s => ({ ...s, viewportText: getViewportString() }));
}

export function manualToggleTheme(key, enabled) {
  if (enabled) {
    const bbox = getBbox();
    const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled);
    const allKeys = [...enabledKeys, key];

    const svId = getOrCreateActiveSnapview(bbox, allKeys);
    activeSnapviewId = svId;
    activeSnapviewStore.set(svId);

    // Fire-and-forget: toggleTheme no longer awaits
    toggleTheme(key, true, svId);
  } else {
    toggleTheme(key, false);

    // Update active snapview keys
    if (activeSnapviewId) {
      removeSnapviewKey(activeSnapviewId, key);
    }

    const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled);
    if (enabledKeys.length === 0) {
      activeSnapviewId = null;
      activeSnapviewStore.set(null);
    }
  }
}

export async function restoreSnapview(snapview) {
  const map = getMap();
  const { bbox, keys } = snapview;

  // Disable all currently enabled themes
  for (const key of Object.keys(themeState)) {
    if (themeState[key].enabled) {
      disableTheme(key);
    }
  }

  activeSnapviewId = snapview.id;
  activeSnapviewStore.set(snapview.id);

  // Zoom to the snapview bbox
  map.fitBounds([[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]], { padding: [0, 0] });

  // Wait for the map to settle
  await new Promise(r => setTimeout(r, 100));

  // Enable all themes from this snapview (from DuckDB cache)
  const validKeys = keys.filter(k => themeState[k]);
  for (let i = 0; i < validKeys.length; i++) {
    await enableThemeFromCache(validKeys[i], bbox);
  }

  statusStore.set({ text: `Restored ${validKeys.length} theme${validKeys.length > 1 ? 's' : ''}`, type: 'success' });
}

export async function clearCache() {
  if (!currentRelease) return;

  if (!confirm('Clear cache? This will:\n\u2022 clear snapviews (localStorage)\n\u2022 drop local DuckDB tables\n\u2022 clear edge spatial index for all themes')) {
    return;
  }

  statusStore.set({ text: 'Clearing cache...', type: 'loading' });

  activeSnapviewId = null;
  activeSnapviewStore.set(null);

  clearSnapviews();
  clearIntersectionState();
  await dropAllTables();
  clearAllThemes();

  const requests = Object.keys(themeState).map((key) => {
    const [theme, type] = key.split('/');
    const url = `${PROXY}/index/clear?release=${encodeURIComponent(currentRelease)}&theme=${encodeURIComponent(theme)}&type=${encodeURIComponent(type)}`;
    return fetch(url).catch(() => null);
  });
  await Promise.all(requests);

  updateStats();
  statusStore.set({ text: 'Cache cleared', type: 'success' });
}

export function setShowSnapviewsCtrl(v) {
  showSnapviewsStore.set(v);
  setShowSnapviews(v);
}

export async function setHighlightIntersections(v) {
  highlightIntersectionsStore.set(v);
  setIntersectionMode(v);
  await recomputeIntersections(themeState, currentRelease);
  rerenderAllEnabled();
}
