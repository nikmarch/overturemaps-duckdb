import App from './App.svelte';

// Render static DOM structure first (with the same ids the existing app expects).
new App({ target: document.getElementById('app') });

// Then bootstrap the existing Leaflet + DuckDB app.
import '../main.js';
