/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

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
        // Firestore Security Rules tests (tests/rules/**) run against the
        // Firestore emulator via a dedicated config (vitest.rules.config.ts,
        // invoked by `pnpm test:rules`). Exclude them from the default jsdom
        // run, which has no emulator.
        // e2e/** holds Playwright specs (*.spec.ts) — exclude them too, or
        // vitest's default glob would try to run them under jsdom (they are
        // driven by `pnpm test:e2e` against the dev server instead).
        exclude: [...configDefaults.exclude, 'tests/rules/**', 'e2e/**'],
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
          // Coverage ratchet for the critical business logic in utils/.
          // These modules are the single source of truth for money math,
          // safe-to-spend, habit scoring, dates, etc., so we gate them in CI
          // (see .github/workflows/ci.yml). Floors are set just under the
          // CURRENT aggregate coverage of utils/** (lines ~81.8%, stmts ~81.6%,
          // funcs ~85.9%, branches ~73.7%) so the gate ratchets up over time
          // without breaking the build today. The glob-keyed thresholds apply
          // to the union of matched files (perFile defaults to false). Bump
          // these floors as coverage improves; do NOT add a repo-wide threshold
          // (overall coverage is much lower and would fail the build).
          thresholds: {
            'utils/**/*.{ts,tsx}': {
              lines: 78,
              statements: 78,
              functions: 82,
              branches: 70,
            },
          },
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
        // Vite 8 transforms with oxc, which ignores the `esbuild.pure` option
        // above. Route minification through esbuild so the console.* pure
        // annotations are honoured and debug logging is dropped from prod.
        minify: 'esbuild',
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
