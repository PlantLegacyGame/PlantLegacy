import process from 'node:process';
import legacy from '@vitejs/plugin-legacy';
import { defineConfig } from 'vite';

// The game server's port, not the dev server's. `pnpm dev` passes it through,
// so a stack started with PORT=8090 proxies to 8090 instead of a hardcoded 8080
// that belongs to a different (or no) server.
const SERVER_PORT =
  process.env.PL_SERVER_PORT && process.env.PL_SERVER_PORT !== '0'
    ? Number(process.env.PL_SERVER_PORT)
    : 8080;
const serverOrigin = `http://127.0.0.1:${SERVER_PORT}`;

export default defineConfig({
  root: '.',
  base: '/PlantLegacy/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: {
      polyfill: false,
    },
  },
  plugins: [
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    {
      name: 'shader-reload',
      handleHotUpdate({ file, server }) {
        if (file.endsWith('.wgsl')) {
          server.ws.send({ type: 'full-reload' });
        }
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    proxy: {
      '/health': serverOrigin,
      '/ready': serverOrigin,
      // The title screen reads the world clock before any socket exists.
      '/world': serverOrigin,
      '/config': serverOrigin,
      // Dev-tool probes and actions (/dev/config). Without this the browser asked
      // Vite, got a 404, and the dev panel refused to open in the very
      // environment it is allowed in.
      '/dev': serverOrigin,
      '/auth': serverOrigin,
      '/ws': {
        target: `ws://127.0.0.1:${SERVER_PORT}`,
        ws: true,
      },
    },
  },
});
