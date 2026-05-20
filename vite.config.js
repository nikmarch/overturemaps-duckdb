import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path is env-driven so the same source builds two deployments:
//   - CF Pages → maps.marchen.co, served at root (BASE='/')
//   - zarbazan → tools.zarbazan.work/maps/, served at /maps/
// At runtime the app reads import.meta.env.BASE_URL (set by Vite from `base`)
// to construct API/proxy paths so they survive whichever prefix is active.
const BASE = process.env.VITE_BASE ?? '/';

// Dev-server proxy paths must be prefixed with BASE so requests landing at
// e.g. /maps/api/* on the public nginx forward correctly to the CF Worker.
const apiProxyKey = `${BASE}api`.replace(/\/+/g, '/');
const releaseProxyKey = `${BASE}release`.replace(/\/+/g, '/');

export default defineConfig({
  base: BASE,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  server: {
    host: '0.0.0.0',
    port: 8123,
    allowedHosts: ['zarbazan', 'maps.zarbazan.work', 'tools.zarbazan.work', 'maps.marchen.co'],
    proxy: {
      // /api → CF Worker (strip BASE+api/ prefix before forwarding).
      [apiProxyKey]: {
        target: 'https://overture-s3-proxy.zarbazan.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${apiProxyKey}`), ''),
      },
      // /release → CF Worker (strip BASE prefix before forwarding so the
      // worker still sees /release/... regardless of how the SPA is hosted).
      [releaseProxyKey]: {
        target: 'https://overture-s3-proxy.zarbazan.workers.dev',
        changeOrigin: true,
        rewrite: (path) => (BASE === '/' ? path : path.replace(new RegExp(`^${BASE.replace(/\/$/, '')}`), '')),
      },
    },
  },
});
