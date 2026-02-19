import './style.css';
import 'leaflet/dist/leaflet.css';
import App from './svelte/App.svelte';
import { mount } from 'svelte';
import { initMap } from './lib/map.js';
import { initDuckDB } from './lib/duckdb.js';
import { loadReleases } from './lib/themes.js';
import { initSnapviewsLayer } from './lib/snapviews.js';
import { onMapMove, onHashChange } from './lib/controller.js';
import { status } from './lib/stores.js';

mount(App, { target: document.getElementById('app') });

async function init() {
  try {
    status.set({ text: 'Loading DuckDB...', type: 'loading' });
    await initDuckDB();

    const map = initMap('map');
    initSnapviewsLayer();

    map.on('moveend', onMapMove);
    window.addEventListener('hashchange', onHashChange);
    setTimeout(onMapMove, 0);

    await loadReleases();
  } catch (e) {
    status.set({ text: `Init error: ${e.message}`, type: 'error' });
    console.error(e);
  }
}

init();
