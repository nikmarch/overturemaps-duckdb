import { get } from 'svelte/store';
import {
  status, stats,
  releases, selectedRelease,
  themes, themeUi,
  showFootprints, highlightIntersections,
} from './stores.js';

// This module acts as the only bridge between Svelte UI and the existing map/db engine.
// For now it delegates to functions exposed on window by the legacy code (to keep changes small).

export async function init() {
  // Allow legacy code to push updates into Svelte without importing Svelte.
  window.__uiSetStatus = (next) => status.set(next);
  window.__uiSetStats = (next) => stats.set(next);
  window.__uiSetReleases = (list) => releases.set(list);
  window.__uiSetSelectedRelease = (r) => selectedRelease.set(r);
  window.__uiSetThemes = (list) => themes.set(list);
  window.__uiUpdateTheme = (key, patch) => {
    themeUi.update((m) => ({ ...m, [key]: { ...(m[key] || {}), ...patch } }));
  };

  syncFromLegacy();
}

export function syncFromLegacy() {
  // Status + stats
  if (window.__appStatus) status.set(window.__appStatus);
  if (window.__appStats) stats.set(window.__appStats);

  // Releases/themes
  if (window.__releases) releases.set(window.__releases);
  if (window.__selectedRelease) selectedRelease.set(window.__selectedRelease);
  if (window.__themes) themes.set(window.__themes);
}

export async function setRelease(release) {
  selectedRelease.set(release);
  if (window.__setRelease) await window.__setRelease(release);
  syncFromLegacy();
}

export async function toggleTheme(key, enabled) {
  if (window.__toggleTheme) await window.__toggleTheme(key, enabled);
}

export function setThemeLimit(key, limit) {
  if (window.__setThemeLimit) window.__setThemeLimit(key, limit);
}

export async function clearCache() {
  if (window.__clearCache) await window.__clearCache();
  syncFromLegacy();
}

export function setShowFootprints(v) {
  showFootprints.set(v);
  if (window.__setShowFootprints) window.__setShowFootprints(v);
}

export function setHighlightIntersections(v) {
  highlightIntersections.set(v);
  if (window.__setHighlightIntersections) window.__setHighlightIntersections(v);
}
