import { writable, derived } from 'svelte/store';

export const status = writable({ text: 'Initializing...', type: 'loading' });
export const stats = writable({ cachedText: '-', shownText: '-' });

export const releases = writable([]);
export const selectedRelease = writable(null);

// [{ theme, type }]
export const themes = writable([]);

// key -> { enabled, limit, loading, metaText }
export const themeUi = writable({});

export const showFootprints = writable(true);
export const highlightIntersections = writable(false);

export const themeList = derived(themes, ($themes) => {
  return [...$themes].sort((a, b) => `${a.theme}/${a.type}`.localeCompare(`${b.theme}/${b.type}`));
});
