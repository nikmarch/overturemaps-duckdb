import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
    proxy: {
      '/api': {
        target: 'https://overture-s3-proxy.zarbazan.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/release': {
        target: 'https://overture-s3-proxy.zarbazan.workers.dev',
        changeOrigin: true,
      },
    },
  },
});
