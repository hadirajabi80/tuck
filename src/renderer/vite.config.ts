// Standalone renderer dev server for UI work in a normal browser (`npm run dev:ui`).
// window.api is undefined there, so lib/api.ts falls back to lib/mockApi.ts.
// The Electron build uses electron.vite.config.ts instead.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: { port: 5174, strictPort: true },
});
