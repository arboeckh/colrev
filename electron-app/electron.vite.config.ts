import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// The web preview (scripts/agentixxx/preview.sh): the renderer's dev server
// answers browsers on any host and passes /__bridge to the main process's web
// bridge (src/main/web-bridge.ts), which listens on this port.
const webBridgePort = Number(process.env.COLREV_WEB_BRIDGE_PORT) || 0;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    build: {
      outDir: 'dist/renderer',
    },
    server: webBridgePort
      ? {
          host: '0.0.0.0',
          allowedHosts: true,
          proxy: { '/__bridge': `http://127.0.0.1:${webBridgePort}` },
        }
      : undefined,
  },
});
