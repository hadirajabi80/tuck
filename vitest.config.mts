import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./src/shared'),
      '@': r('./src/renderer/src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
});
