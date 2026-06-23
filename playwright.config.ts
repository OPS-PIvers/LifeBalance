import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright end-to-end test configuration for LifeBalance.
 *
 * The e2e suite drives the app's built-in Test Mode (mock data, no Firebase),
 * which is only enabled when `import.meta.env.DEV` is true AND
 * `VITE_ENABLE_TEST_MODE === 'true'`. That means the specs MUST run against the
 * Vite **dev** server (`pnpm dev`), not `vite preview` (preview serves a
 * production build where `DEV` is false and Test Mode is disabled). The
 * `webServer` block below boots `pnpm dev` with `VITE_ENABLE_TEST_MODE=true` so
 * local `pnpm test:e2e` works without touching the developer's `.env.local`.
 *
 * The app is mobile-first — its primary navigation is the bottom nav bar — so
 * the suite runs under a mobile device profile (Pixel 5) where that nav is the
 * intended UI.
 *
 * These files are deliberately insulated from the required `validate` CI job:
 * vitest excludes `e2e/**`, root `tsc` excludes `e2e` + this config, and eslint
 * ignores both. See vite.config.ts / tsconfig.json / eslint.config.js.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Fail the build if a `test.only` is committed (CI only).
  forbidOnly: !!process.env.CI,
  // Retry once in CI to absorb cold-start flakiness; never locally.
  retries: process.env.CI ? 1 : 0,
  // A single worker in CI: there is one shared dev server.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Enable Test Mode for the dev server without requiring a real .env.local.
    // Vite exposes VITE_-prefixed process env vars to import.meta.env.
    env: { VITE_ENABLE_TEST_MODE: 'true' },
  },
});
