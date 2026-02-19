import { get } from 'svelte/store';
import { PROXY } from './constants.js';
import { dropAllTables } from './duckdb.js';
import { getMap, getBbox, getViewportString, bboxContains } from './map.js';
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
  groupedSnapviews as groupedSnapviewsStore,
} from './stores.js';

export { onReleaseChange as setRelease };
export { toggleTheme };
export { setThemeLimit };

// Flag to skip auto-sync while a manual load is in progress
let manualLoadInProgress = false;

export function updateViewportStats() {
  viewportStatsStore.update(s => ({ ...s, viewportText: getViewportString() }));
}

// Find the snapview group whose bbox contains the current viewport
function findMatchingSnapview() {
  const currentBbox = getBbox();
  const groups = get(groupedSnapviewsStore);
  for (const group of groups) {
    if (bboxContains(group.bbox, currentBbox)) {
      return group;
    }
  }
  return null;
}

// Sync checked themes to match the snapview at the current viewport
async function syncThemesToViewport() {
  if (manualLoadInProgress) return;

  const match = findMatchingSnapview();
  const currentActive = get(activeSnapviewStore);

  if (match) {
    // Check if we're already showing this snapview
    const sameAsCurrent = currentActive &&
      currentActive.bbox.xmin === match.bbox.xmin && currentActive.bbox.ymin === match.bbox.ymin &&
      currentActive.bbox.xmax === match.bbox.xmax && currentActive.bbox.ymax === match.bbox.ymax;

    if (sameAsCurrent) return;

    // Switch to the matching snapview
    const matchKeys = new Set(match.keys);

    // Disable themes not in this snapview
    for (const key of Object.keys(themeState)) {
      if (themeState[key].enabled && !matchKeys.has(key)) {
        disableTheme(key);
      }
    }

    // Enable themes from this snapview (renders from DuckDB cache)
    for (const key of match.keys) {
      if (themeState[key] && !themeState[key].enabled) {
        await enableThemeFromCache(key);
      }
    }

    activeSnapviewStore.set({ bbox: match.bbox, keys: [...match.keys] });
  } else {
    // No snapview matches — disable all themes
    if (currentActive) {
      for (const key of Object.keys(themeState)) {
        if (themeState[key].enabled) {
          disableTheme(key);
        }
      }
      activeSnapviewStore.set(null);
    }
  }
}

export function onMapMove() {
  updateViewportStats();
  syncThemesToViewport();
}

export function onHashChange() {
  // The map listens to hashchange internally via Leaflet, which fires moveend.
  // But if the hash changes without Leaflet (e.g. browser back/forward),
  // we need to update the map position, which will trigger moveend → onMapMove.
  const map = getMap();
  if (!map) return;
  const [z, lat, lon] = (location.hash.slice(1) || '').split('/').map(Number);
  if (!isNaN(lat) && !isNaN(lon)) {
    map.setView([lat, lon], !isNaN(z) ? z : map.getZoom());
  }
}

export async function restoreSnapview(group) {
  manualLoadInProgress = true;
  try {
    const map = getMap();
    const { bbox, keys } = group;

    // Disable all currently enabled themes
    for (const key of Object.keys(themeState)) {
      if (themeState[key].enabled) {
        disableTheme(key);
      }
    }

    activeSnapviewStore.set({ bbox, keys: [...keys] });

    // Zoom to the snapview bbox
    map.fitBounds([[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]], { padding: [0, 0] });
    await new Promise(r => setTimeout(r, 100));

    // Enable all themes from this snapview (from cache)
    for (const key of keys) {
      if (themeState[key]) {
        await enableThemeFromCache(key);
      }
    }
  } finally {
    manualLoadInProgress = false;
  }
}

// Wraps toggleTheme to set manualLoadInProgress flag
export async function manualToggleTheme(key, enabled) {
  manualLoadInProgress = true;
  try {
    await toggleTheme(key, enabled);
  } finally {
    manualLoadInProgress = false;
    // After manual load completes, the new snapview exists at this viewport,
    // so re-sync to pick it up as active
    syncThemesToViewport();
  }
}

export async function clearCache() {
  if (!currentRelease) return;

  if (!confirm('Clear cache? This will:\n• clear snapviews (localStorage)\n• drop local DuckDB tables\n• clear edge spatial index for all themes')) {
    return;
  }

  statusStore.set({ text: 'Clearing cache...', type: 'loading' });

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
