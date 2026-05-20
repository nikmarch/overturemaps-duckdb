import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served under tools.zarbazan.work/maps/ (relocated from the retired
// maps.zarbazan.work). Main nginx proxies /maps/ here keeping the prefix;
// Vite's `base` config makes the dev server serve assets + HMR under /maps/.
// API + S3 proxy paths must also live under /maps/ so they survive the
// public-facing nginx prefix-aware proxy.
export default defineConfig({
  base: '/maps/',
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
    allowedHosts: ['zarbazan', 'tools.zarbazan.work'],
    proxy: {
      // SPA does fetch('/maps/api/files?...') → Vite strips /maps/api/ →
      // forwards to CF Worker as /files?...
      '/maps/api': {
        target: 'https://overture-s3-proxy.zarbazan.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/maps\/api/, ''),
      },
      // Parquet fetches: SPA constructs `${location.origin}/maps/release/...`.
      // Strip /maps/ so it forwards to /release/... on the worker.
      '/maps/release': {
        target: 'https://overture-s3-proxy.zarbazan.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/maps/, ''),
      },
    },
  },
});
