import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  // Don't let electron-builder output (dist/, win-unpacked/) trigger dev-server
  // reloads during development.
  server: {
    watch: {
      ignored: ['**/dist/**', '**/dist-renderer/**', '**/dist-electron/**'],
    },
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');

          if (!normalizedId.includes('node_modules')) {
            return undefined;
          }

          if (normalizedId.includes('/node_modules/lucide-react/')) {
            return 'vendor-icons';
          }

          if (
            normalizedId.includes('/node_modules/react/') ||
            normalizedId.includes('/node_modules/react-dom/') ||
            normalizedId.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }

          if (normalizedId.includes('/node_modules/recharts/') || normalizedId.includes('/node_modules/d3-')) {
            return 'vendor-charts';
          }

          if (normalizedId.includes('/node_modules/date-fns/')) {
            return 'vendor-date';
          }

          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart({ startup }) {
          return startup(['.', '--no-sandbox', '--disable-gpu']);
        },
        vite: {
          build: {
            rollupOptions: {
              external: ['@the-vault/core', 'better-sqlite3', 'node-pty']
            }
          }
        }
      },
      preload: {
        input: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        }
      },
      renderer: {}
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
});
