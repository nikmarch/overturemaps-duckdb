import App from './App.svelte';

// Render DOM structure first (with the same ids the existing app expects).
new App({ target: document.getElementById('app') });

// Bootstrap the existing Leaflet + DuckDB app.
import '../main.js';

// Start the UI controller (gradually replaces DOM mutation in main.js).
import { init } from '../lib/controller.js';
init();
