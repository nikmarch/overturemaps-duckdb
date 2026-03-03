import L from 'leaflet';
import { PALETTE_16, THEME_COLORS, DEFAULT_COLOR } from './constants.js';
import { getMap } from './map.js';
import { darkenHex } from './render.js';
import { useStore } from './store.js';

export const themeState = {};
export let currentRelease = null;
const THEME_KEY_COLORS = {};
export const themeAbort = {}; // per-theme AbortController to cancel stale requests

export function log(msg, type = 'loading') {
  useStore.setState({ status: { text: msg, type } });
}

export function setThemeUi(key, patch) {
  useStore.setState(s => ({
    themeUi: { ...s.themeUi, [key]: { ...(s.themeUi[key] || {}), ...patch } },
  }));
}

export function setCurrentRelease(release) {
  currentRelease = release;
}

export function getThemeColor(key) {
  if (THEME_KEY_COLORS[key]) return THEME_KEY_COLORS[key];
  const theme = String(key || '').split('/')[0];
  return THEME_COLORS[theme] || DEFAULT_COLOR;
}

export function assignColors(themes) {
  const sorted = [...themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));
  for (const k of Object.keys(THEME_KEY_COLORS)) delete THEME_KEY_COLORS[k];
  sorted.forEach(({ theme, type }, i) => {
    const key = `${theme}/${type}`;
    const fill = PALETTE_16[i % PALETTE_16.length];
    THEME_KEY_COLORS[key] = { fill, stroke: darkenHex(fill) };
  });
  return sorted;
}

// Get the active snapview's cap, falling back to global viewportCap
export function getActiveCap() {
  const state = useStore.getState();
  const activeId = state.activeSnapview;
  if (activeId) {
    const sv = state.snapviews.find(s => s.id === activeId);
    if (sv?.cap) return sv.cap;
  }
  return state.viewportCap;
}

// Per-theme render budget: cap / enabledThemeCount
export function getRenderLimit(overrideCap) {
  const cap = overrideCap ?? getActiveCap();
  const enabledCount = Object.values(themeState).filter(s => s.enabled).length || 1;
  return Math.max(1, Math.floor(cap / enabledCount));
}

export function updateStats() {
  const shown = [];
  let enabledCount = 0;
  let totalRendered = 0;
  const totalThemes = Object.keys(themeState).length;
  for (const [key, state] of Object.entries(themeState)) {
    if (state.enabled) enabledCount++;
    if (state.markers.length > 0) {
      const type = key.split('/')[1];
      shown.push(`${state.markers.length.toLocaleString()} ${type}`);
      totalRendered += state.markers.length;
    }
  }
  const shownText = shown.length ? shown.join(', ') : '-';
  useStore.setState(s => ({
    viewportStats: { ...s.viewportStats, shownText, enabledCount, totalThemes, totalRendered },
  }));
}

export function initTheme(key) {
  const map = getMap();
  const layer = L.layerGroup();
  layer.addTo(map);
  themeState[key] = { key, layer, markers: [], cachedRows: null, bbox: null, limit: 33000, loadedCount: 0, enabled: false };
  setThemeUi(key, { enabled: false, limit: 33000, loading: false, metaText: '' });
}

export function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function disableTheme(key) {
  const state = themeState[key];
  if (!state || !state.enabled) return;
  state.enabled = false;
  state.layer.clearLayers();
  state.markers = [];
  setThemeUi(key, { enabled: false });
  updateStats();
}

export function clearAllThemes() {
  for (const key of Object.keys(themeState)) {
    themeState[key].layer.clearLayers();
    themeState[key].markers = [];
    themeState[key].cachedRows = null;
    themeState[key].extraFields = null;
    themeState[key].bbox = null;
    themeState[key].loadedCount = 0;
    themeState[key].enabled = false;
  }
  useStore.setState(s => {
    const next = { ...s.themeUi };
    for (const key of Object.keys(next)) {
      next[key] = { ...next[key], enabled: false };
    }
    return { themeUi: next };
  });
}
