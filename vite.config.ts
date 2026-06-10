/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: './vitest.setup.ts',
        coverage: {
          provider: 'v8',
          include: ['**/*.{ts,tsx}'],
          exclude: [
            '**/*.test.*',
            '**/*.d.ts',
            'functions/**',
            'dist/**',
            '**/*.config.*',
            'vitest.setup.ts',
          ],
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      // In production builds, tree-shake noisy debug logging while keeping
      // console.warn and console.error (they carry real diagnostics).
      esbuild: command === 'build' ? {
        pure: ['console.log', 'console.debug', 'console.info'],
      } : {},
      build: {
        sourcemap: 'hidden',
        rollupOptions: {
          output: {
            // Function form (not the object form) on purpose: the object form
            // only assigns the listed entry modules, so package *subpaths*
            // ('react-dom/client', 'react/jsx-runtime') and the virtual
            // CommonJS-interop modules Rollup generates for them escaped
            // their vendor chunk — react-dom's renderer (~177 kB) landed in
            // the app index chunk (cache-busted every deploy) and the
            // jsx-runtime interop landed in vendor-motion, dragging
            // framer-motion into the eager boot path for every JSX module.
            // Matching on the module path catches subpaths and interop ids.
            manualChunks(id: string) {
              // Rollup's virtual CJS interop helpers (\0commonjsHelpers.js)
              // are imported by every CommonJS-wrapped vendor, React included.
              // Pin them to the always-eager react chunk; left unassigned they
              // gravitate into a lazy chunk and create a circular
              // vendor-react -> vendor-charts -> vendor-react import.
              if (id.includes('commonjsHelpers')) return 'vendor-react';
              if (!id.includes('node_modules')) return undefined;
              if (id.includes('@google/genai')) return 'vendor-ai';
              if (/node_modules\/@?firebase\//.test(id)) return 'vendor-firebase';
              if (/node_modules\/(recharts|victory-vendor|d3-[^/]+|decimal\.js)/.test(id)) return 'vendor-charts';
              if (/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'vendor-motion';
              if (id.includes('node_modules/lucide-react/')) return 'vendor-icons';
              if (/node_modules\/(date-fns|clsx|tailwind-merge|react-hot-toast|goober)\//.test(id)) return 'vendor-utils';
              // use-sync-external-store is shared by react-router (eager) and
              // react-redux/recharts (lazy); keep it with react so the eager
              // chunk never has to import from the lazy charts chunk.
              if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store)\//.test(id)) return 'vendor-react';
              return undefined;
            }
          }
        }
      }
    };
});
