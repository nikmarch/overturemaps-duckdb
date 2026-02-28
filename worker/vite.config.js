import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { ducklingsWorkerPlugin } from '@ducklings/workers/vite-plugin';

export default defineConfig({
  server: { host: '0.0.0.0' },
  plugins: [ducklingsWorkerPlugin(), cloudflare()],
});
