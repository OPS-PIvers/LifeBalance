/// <reference types="vitest" />
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { configDefaults } from 'vitest/config';

// Shared by both test projects below, so a file can never be claimed by both or
// by neither.
//
// Firestore Security Rules tests (tests/rules/**) run against the Firestore
// emulator via a dedicated config (vitest.rules.config.ts, invoked by
// `pnpm test:rules`). Exclude them from the default run, which has no emulator.
// e2e/** holds Playwright specs (*.spec.ts) — exclude them too, or vitest's
// default glob would try to run them (they are driven by `pnpm test:e2e`
// against the dev server instead).
// .claude/** holds the Claude Code harness's temporary, git-ignored agent
// worktrees (.claude/worktrees/**), each a full repo copy WITH its own
// node_modules. Without this exclude, vitest globs their *.test.tsx too and
// they fail en masse with "Invalid hook call" (a second, duplicate React
// copy). They are scratch space, never part of this package's test suite.
const TEST_EXCLUDE = [...configDefaults.exclude, 'tests/rules/**', 'e2e/**', '.claude/**'];

// Directories whose tests render React or call renderHook, so they need a DOM
// wholesale. Matched on directory rather than on the .tsx extension because
// several .ts suites in hooks/ (useActionQueue, useMidnightScheduler, …) drive
// renderHook from a plain .ts file.
const JSDOM_INCLUDE = [
  'components/**/*.test.{ts,tsx}',
  'pages/**/*.test.{ts,tsx}',
  'hooks/**/*.test.{ts,tsx}',
  'App.test.tsx',
  // contexts/** is mostly pure mutation/listener logic (node), but the
  // top-level provider suites mount real components.
  'contexts/*.test.tsx',
  'services/notificationService.test.tsx',
];

export default defineConfig(({ command }) => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      test: {
        // Two projects split by environment. Booting a jsdom dominated this
        // suite's cost: with `environment: 'jsdom'` set globally, a full run
        // spent 301s of worker time in `environment` against only 85s actually
        // running `tests` — and the large majority of the suite (utils/**,
        // functions/**, contexts/household/**) is pure logic that never touches
        // the DOM. Per file it is ~0.9s to boot a jsdom vs ~0.06s for node. So
        // node is the default now and jsdom is opt-in.
        //
        // Two ways a file gets jsdom:
        //   1. It lives in a UI directory (see JSDOM_INCLUDE below) — anything
        //      that renders components or calls renderHook.
        //   2. It carries a `// @vitest-environment jsdom` docblock. That is how
        //      the ~16 pure-logic suites that drive window/document/localStorage
        //      opt back in. The docblock is deliberately preferred over listing
        //      their paths here: it survives file renames and documents itself at
        //      the point of use.
        //
        // A test that needs the DOM and has neither fails loudly with
        // "ReferenceError: window is not defined" — it never silently degrades.
        //
        // `pool` is left at its default (forks). threads was measured against
        // this suite and came out within noise of forks (166.6s vs 170.6s on a
        // 4-core box), so it does not buy anything worth giving up process
        // isolation for.
        projects: [
          {
            extends: true,
            test: {
              name: 'jsdom',
              environment: 'jsdom',
              include: JSDOM_INCLUDE,
              exclude: TEST_EXCLUDE,
              globals: true,
              setupFiles: './vitest.setup.ts',
            },
          },
          {
            extends: true,
            test: {
              name: 'node',
              environment: 'node',
              // NOTE: `isolate: false` was measured here and deliberately NOT
              // kept. It is a real win (170s -> 132s on a 4-core box, mostly by
              // collapsing the `import` phase as the module registry is reused),
              // but it is not green: sharing one module registry across files
              // breaks services/geminiService.test.ts,
              // services/geminiService_Hardening.test.ts and
              // functions/src/quickAdd/getTodos.test.ts (49 tests). Those files
              // pass alone and pass together — they only fail once co-resident
              // with the rest of the suite, i.e. latent order-dependent
              // pollution. Turning it on for the jsdom project is far worse
              // (152 failures, tests timing out at 100s+ on leaked DOM and
              // Firestore listeners). Re-evaluate only with the pollution fixed
              // at the source, never by skipping the affected tests.
              include: ['**/*.test.{ts,tsx}'],
              exclude: [...TEST_EXCLUDE, ...JSDOM_INCLUDE],
              globals: true,
              // Deliberately the *shared* setup, not vitest.setup.ts: this
              // project does not need @testing-library/jest-dom, and skipping
              // that import cuts the setup phase for these 200+ files from
              // ~17s to ~2.6s of worker time. See vitest.setup.ts.
              setupFiles: './vitest.setup.shared.ts',
            },
          },
        ],
        coverage: {
          provider: 'v8',
          include: ['**/*.{ts,tsx}'],
          exclude: [
            '**/*.test.*',
            '**/*.d.ts',
            'functions/**',
            'dist/**',
            '**/*.config.*',
            'vitest.setup*.ts',
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
            'services/**/*.{ts,tsx}': {
              lines: 66,
              statements: 52,
              functions: 77,
              branches: 52,
            },
            'contexts/**/*.{ts,tsx}': {
              lines: 44,
              statements: 28,
              functions: 27,
              branches: 33,
            },
          },
        },
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        },
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
            // Vendor chunking via rolldown's codeSplitting groups (Vite 8 =
            // rolldown 1.x; this is the successor to the deprecated
            // `advancedChunks` key — same `{ groups: [...] }` shape).
            // Groups are claimed by descending `priority`; a module matching a
            // higher-priority group is pinned there and is NOT merged back into
            // a lower group by rolldown's post-split pass. That ordering is the
            // whole point here: recharts bundles its OWN CommonJS copies of
            // react/react-dom/react-is, and the prior function-form manualChunks
            // could not keep them out of vendor-charts (rolldown merged the
            // single-importer CJS React back into the recharts chunk). The eager
            // entry graph then imported React *from* vendor-charts, force-
            // preloading all ~124 kB-gz of recharts on first paint. Giving the
            // React core the highest priority claims those CJS copies for
            // vendor-react first, so vendor-charts stays fully lazy.
            //
            // We also match on the module *path* (not just package entry) so
            // package subpaths ('react-dom/client', 'react/jsx-runtime') and the
            // virtual CJS-interop ids land in the right chunk — the object-form
            // manualChunks used to miss those, bloating index/vendor-motion.
            codeSplitting: {
              groups: [
                {
                  name: 'vendor-react',
                  priority: 50,
                  // React core + the CJS variants recharts/redux pull in. Highest
                  // priority so they never head the lazy charts chunk. (The app's
                  // own eager code resolves React via the CJS build, so these
                  // bytes belong on the eager path regardless of recharts.)
                  test: /[\\/]node_modules[\\/](\.pnpm[\\/][^\\/]*[\\/]node_modules[\\/])?(react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store|react-is)[\\/]/,
                },
                {
                  name: 'vendor-react',
                  priority: 49,
                  // Rollup/rolldown virtual CJS interop helpers are imported by
                  // every CommonJS-wrapped vendor, React included. Pin them to
                  // the eager react chunk; left unassigned they gravitate into a
                  // lazy chunk and create a circular react -> charts -> react import.
                  test: /commonjsHelpers/,
                },
                { name: 'vendor-ai', priority: 40, test: /[\\/]node_modules[\\/]@google[\\/]genai[\\/]/ },
                // Shared low-level Firebase packages (app/util/component/logger/
                // installations) are used by the EAGER auth+firestore core. Claim
                // them into a dedicated eager chunk at the HIGHEST firebase priority
                // so they are NOT hoisted into the lazy messaging/functions chunks
                // below. Without this, rolldown places these shared modules in the
                // higher-priority messaging chunk (its first matching claimant), and
                // the eager core then imports them FROM there — dragging the whole
                // messaging chunk back onto the boot path (modulepreload). A distinct
                // name (not 'vendor-firebase') avoids two same-named eager chunks.
                { name: 'vendor-firebase-core', priority: 43, test: /[\\/]node_modules[\\/]@firebase[\\/](app|util|component|logger|installations)[\\/]/ },
                // firebase/messaging and firebase/functions are imported LAZILY
                // (see firebase.config.ts getMessagingInstance/getFunctionsInstance
                // and their consumers). Claim them into dedicated chunks at a HIGHER
                // priority than the catch-all vendor-firebase group so rolldown does
                // not merge them back into the eager firebase chunk — otherwise the
                // lazy code split is undone and they stay modulepreloaded on boot.
                // Nothing on the eager graph imports them, so these chunks load only
                // when notifications are set up / a callable runs.
                { name: 'vendor-firebase-messaging', priority: 42, test: /[\\/]node_modules[\\/]@?firebase[\\/]messaging[\\/]/ },
                { name: 'vendor-firebase-functions', priority: 42, test: /[\\/]node_modules[\\/]@?firebase[\\/]functions[\\/]/ },
                { name: 'vendor-firebase', priority: 40, test: /[\\/]node_modules[\\/]@?firebase[\\/]/ },
                {
                  name: 'vendor-charts',
                  priority: 30,
                  // recharts + its chart deps. redux family (react-redux/redux/
                  // @reduxjs) is recharts-only (lazy) so it belongs here too.
                  test: /[\\/]node_modules[\\/](\.pnpm[\\/][^\\/]*[\\/]node_modules[\\/])?(recharts|victory-vendor|d3-[^\\/]+|decimal\.js|decimal\.js-light|react-redux|redux|redux-thunk|@reduxjs|reselect|immer|internmap|es-toolkit|eventemitter3|tiny-invariant)[\\/]/,
                },
                { name: 'vendor-motion', priority: 30, test: /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
                { name: 'vendor-icons', priority: 30, test: /[\\/]node_modules[\\/]lucide-react[\\/]/ },
                // vendor-utils must OUTRANK vendor-charts (35 > 30). clsx +
                // tailwind-merge back the app's cn() helper used by core eager
                // primitives (Button, ConfirmDialog…). At an equal priority,
                // vendor-charts (declared first) wins the tie for shared utils
                // like clsx — which would let any eager <Button>/cn() consumer
                // drag vendor-charts back onto the boot path. These deps are
                // app-only (none are charts-internal), so claiming them here is
                // safe and pulls nothing chart-related into the eager utils chunk.
                { name: 'vendor-utils', priority: 35, test: /[\\/]node_modules[\\/](date-fns|clsx|tailwind-merge|react-hot-toast|goober)[\\/]/ },
              ],
            },
          }
        }
      }
    };
});
