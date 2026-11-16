import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The site is served from the root of its own address (compete.sfmathopen.org),
// or from a sub-path on GitHub Pages; './' works for both, and for the demo.
// Without Supabase settings (or with --mode demo) the build is the in-browser
// demo; with them, the demo code is left out of the build entirely.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const demo = mode === 'demo' || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY;
  return {
    base: './',
    plugins: [react()],
    define: { __DEMO_BUILD__: JSON.stringify(demo) },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
    test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
  };
});
