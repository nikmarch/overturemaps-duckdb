import { PROXY } from './constants.js';
import { dropAllTables } from './duckdb.js';
import { getMap, getBbox, getViewportString, bboxContains, lockMap, unlockMap } from './map.js';
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
  useStore,
  createSnapview,
  addSnapviewKey,
  removeSnapviewKey,
  getSnapview,
  deleteSnapview as deleteSnapviewFromStore,
  updateSnapviewTheme,
  checkSnapviewComplete,
  updateSnapviewCap,
} from './store.js';

export { onReleaseChange as setRelease };
export { toggleTheme };
export { setThemeLimit };

// The currently active snapview id
let activeSnapviewId = null;

function bboxKey(bbox) {
  return [bbox.xmin, bbox.ymin, bbox.xmax, bbox.ymax].map(n => n.toFixed(5)).join(',');
}

// Find an existing snapview whose bbox contains the current one and already has the key
function findSupersetSnapview(bbox, key) {
  const list = useStore.getState().snapviews;
  for (const sv of list) {
    if ((sv.status === 'done' || sv.status === 'loading') &&
        bboxContains(sv.bbox, bbox) && sv.keys.includes(key)) {
      return sv;
    }
  }
  return null;
}

// Get or create a snapview for the current bbox
function getOrCreateActiveSnapview(bbox, keys) {
  // If there's an active loading snapview whose bbox contains the current one, reuse it
  if (activeSnapviewId) {
    const sv = getSnapview(activeSnapviewId);
    if (sv && sv.status === 'loading' && bboxContains(sv.bbox, bbox)) {
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

export function deleteSnapview(snapviewId) {
  const sv = getSnapview(snapviewId);

  // If this is the active snapview, disable its themes from the map
  if (activeSnapviewId === snapviewId) {
    if (sv) {
      for (const key of sv.keys) {
        if (themeState[key]?.enabled) {
          disableTheme(key);
        }
      }
    }
    activeSnapviewId = null;
    useStore.setState({ activeSnapview: null });
  }

  deleteSnapviewFromStore(snapviewId);
  updateStats();
}

export function loadArea(keys) {
  const bbox = getBbox();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  createSnapview(id, bbox, keys);
  activeSnapviewId = id;
  useStore.setState({ activeSnapview: id });

  lockMap();

  for (const key of keys) {
    toggleTheme(key, true, id);
  }
}

// Watch for snapview completion to unlock the map
useStore.subscribe(
  s => s.snapviews,
  (snapviews) => {
    const anyLoading = snapviews.some(sv => sv.status === 'loading');
    if (!anyLoading) unlockMap();
  },
);

export function onMapMove() {
  useStore.setState(s => ({
    viewportStats: { ...s.viewportStats, viewportText: getViewportString() },
  }));
}

export function manualToggleTheme(key, enabled) {
  if (enabled) {
    const bbox = getBbox();

    // If an existing snapview already has this key loaded at a superset bbox,
    // just enable from cache — no new snapview needed
    const superset = findSupersetSnapview(bbox, key);
    if (superset && superset.status === 'done') {
      activeSnapviewId = superset.id;
      useStore.setState({ activeSnapview: superset.id });
      // toggleTheme will use cache path (bboxContains check in loadTheme)
      toggleTheme(key, true, superset.id);
      return;
    }

    const enabledKeys = Object.keys(themeState).filter(k => themeState[k].enabled);
    const allKeys = [...enabledKeys, key];

    const svId = getOrCreateActiveSnapview(bbox, allKeys);
    activeSnapviewId = svId;
    useStore.setState({ activeSnapview: svId });

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
      useStore.setState({ activeSnapview: null });
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
  useStore.setState({ activeSnapview: snapview.id });

  // Zoom to the snapview bbox
  map.fitBounds([[bbox.ymin, bbox.xmin], [bbox.ymax, bbox.xmax]], { padding: [0, 0] });

  // Wait for the map to settle
  await new Promise(r => setTimeout(r, 100));

  // Try to enable from DuckDB cache first; fall back to fresh load for each key
  const validKeys = keys.filter(k => themeState[k]);
  let restoredFromCache = 0;

  for (const key of validKeys) {
    const state = themeState[key];
    // Check if DuckDB table exists (has cached data from this session)
    if (state && bboxContains(state.bbox, bbox)) {
      await enableThemeFromCache(key, bbox, snapview.cap);
      restoredFromCache++;
    } else {
      // No cache — fire a fresh load (non-blocking)
      toggleTheme(key, true, snapview.id);
    }
  }

  if (restoredFromCache === validKeys.length) {
    useStore.setState({ status: { text: `Restored ${validKeys.length} theme${validKeys.length > 1 ? 's' : ''}`, type: 'success' } });
  }
  // If some themes needed fresh loads, the loading overlay will show progress
}

export async function clearCache() {
  if (!currentRelease) return;

  if (!confirm('Clear cache? This will:\n\u2022 clear snapviews (localStorage)\n\u2022 drop local DuckDB tables\n\u2022 clear edge spatial index for all themes')) {
    return;
  }

  useStore.setState({ status: { text: 'Clearing cache...', type: 'loading' } });

  activeSnapviewId = null;
  useStore.setState({ activeSnapview: null });

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
  useStore.setState({ status: { text: 'Cache cleared', type: 'success' } });
}

export function setShowSnapviewsCtrl(v) {
  useStore.setState({ showSnapviews: v });
  setShowSnapviews(v);
}

export async function toggleSnapviewTheme(snapviewId, key, enabled) {
  const sv = getSnapview(snapviewId);
  if (!sv) return;

  if (enabled) {
    // Always disable first to reset state cleanly
    disableTheme(key);

    activeSnapviewId = snapviewId;
    useStore.setState({ activeSnapview: snapviewId });
    useStore.setState({ status: { text: `Loading ${key.split('/')[1]}...`, type: 'loading' } });

    const state = themeState[key];
    if (state && bboxContains(state.bbox, sv.bbox)) {
      await enableThemeFromCache(key, sv.bbox, sv.cap);
    } else {
      toggleTheme(key, true, snapviewId);
    }
  } else {
    disableTheme(key);
    updateStats();
  }
}

export async function onSnapviewCapChange(snapviewId, cap) {
  updateSnapviewCap(snapviewId, cap);

  // If this is the active snapview, re-render all enabled themes with the new cap
  if (activeSnapviewId === snapviewId) {
    useStore.setState({ status: { text: 'Re-rendering...', type: 'loading' } });
    await rerenderAllEnabled(cap);
    useStore.setState({ status: { text: 'Done', type: 'success' } });
  }
}

export async function refreshViewport(snapviewId) {
  const sv = getSnapview(snapviewId);
  if (!sv) return;
  useStore.setState({ status: { text: 'Refreshing viewport...', type: 'loading' } });
  await rerenderAllEnabled(sv.cap);
  useStore.setState({ status: { text: 'Viewport refreshed', type: 'success' } });
}

export async function setHighlightIntersections(v) {
  useStore.setState({ highlightIntersections: v });
  setIntersectionMode(v);
  await recomputeIntersections(themeState, currentRelease);
  rerenderAllEnabled();
}
