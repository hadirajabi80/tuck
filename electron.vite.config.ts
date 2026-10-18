import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// electron-vite 6: `build.externalizeDeps` defaults to true, so only `dependencies` (koffi) stay external;
// devDependencies such as fflate are bundled into main. Entry points use the conventional defaults:
// src/main/index.ts, src/preload/index.ts, src/renderer/index.html.
const shared = { '@shared': resolve(__dirname, 'src/shared') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
  },
  preload: {
    resolve: { alias: shared },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { ...shared, '@': resolve(__dirname, 'src/renderer/src') } },
  },
});
