import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      },
      preload: {
        input: path.join(__dirname, 'src/main/preload.ts')
      }
    })
  ],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
});
