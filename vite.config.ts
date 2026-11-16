import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The site is served from the root of its own address (compete.sfmathopen.org),
// or from a sub-path on GitHub Pages; './' works for both, and for the demo.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  define: {
    __DEMO_BUILD__: JSON.stringify(mode === 'demo'),
  },
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
}));
