import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['@the-vault/core', 'better-sqlite3']
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
