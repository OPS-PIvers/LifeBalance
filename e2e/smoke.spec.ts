import { test, expect, type Page } from '@playwright/test';

/**
 * LifeBalance end-to-end smoke skeleton.
 *
 * This is the initial Playwright skeleton: it proves the app boots into Test
 * Mode (in-memory mock data, no Firebase auth) and that the primary bottom-nav
 * navigation works. It deliberately asserts only on stable accessible names and
 * the seeded mock data defined in `contexts/MockHouseholdContext.tsx`.
 *
 * Intended next specs (deeper flows) build on this foundation:
 *   - add-account / update-balance via the Budget page
 *   - add-habit and toggle-habit mutations on the Habits page
 *   - capture-modal (FAB) transaction entry
 *
 * Notes for future authors:
 *   - Test Mode requires the Vite DEV server (see playwright.config.ts webServer);
 *     `vite preview` disables it.
 *   - Do NOT use `waitForLoadState('networkidle')` — the service worker / FCM
 *     keep the network busy and it will hang. Use web-first auto-waiting
 *     assertions (`await expect(locator).toBeVisible()`) instead.
 *   - URLs are hash-router routes (`/#/`, `/#/budget`, `/#/habits`).
 */

/**
 * Navigate to the test-mode activation URL and wait for the app to re-mount
 * with the mock providers.
 *
 * `pages/Login.tsx` sets `sessionStorage['LIFEBALANCE_TEST_MODE']='true'` then
 * does a full reload to `/`; `App.tsx` then mounts MockAuth/MockHousehold
 * providers and renders the fixed orange banner. Asserting the banner is
 * visible auto-waits across that reload, so no manual wait is needed.
 */
async function enterTestMode(page: Page): Promise<void> {
  await page.goto('/#/login?test=true');
  await expect(page.getByText(/TEST MODE - MOCK DATA/i)).toBeVisible();
}

test.describe('LifeBalance smoke (Test Mode)', () => {
  test('boots into the dashboard with mock data', async ({ page }) => {
    await enterTestMode(page);

    // Login.tsx reloads to '/', and the HashRouter renders the dashboard there
    // (the URL bar shows the bare root until the first in-app navigation appends
    // a hash). Assert we are on the root and NOT still on the login route.
    await expect(page).toHaveURL(/localhost:3000\/(#\/)?$/);
    await expect(page).not.toHaveURL(/#\/login/);

    // The dashboard greeting confirms the mock household actually rendered.
    await expect(
      page.getByRole('heading', { name: /Hi, Test User/i })
    ).toBeVisible();

    // The bottom nav (<nav aria-label="Main navigation">) is the primary,
    // always-mounted navigation in MainLayout.
    await expect(
      page.getByRole('navigation', { name: /main navigation/i })
    ).toBeVisible();
  });

  test('navigates to Money and Habits via the bottom nav', async ({ page }) => {
    await enterTestMode(page);

    // Scope nav clicks to the bottom-nav landmark: the dashboard also renders
    // links to the same routes, so a page-wide `getByRole('link')` is ambiguous.
    // The nav links have the exact accessible names "Money" and "Habits".
    const nav = page.getByRole('navigation', { name: /main navigation/i });

    // --- Money (label renamed from "Budget"; the route is still /#/budget) ---
    await nav.getByRole('link', { name: 'Money', exact: true }).click();
    await expect(page).toHaveURL(/#\/budget$/);
    // Money opens on the Overview tab; "Groceries" is a seeded bucket
    // (SEED_BUCKETS in MockHouseholdContext). Buckets is the default segment
    // of the Budget tab (4-tab Money IA), so switch to it first.
    await page.getByRole('tab', { name: 'Budget' }).click();
    await expect(page.getByText('Groceries').first()).toBeVisible();

    // --- Habits ---
    await nav.getByRole('link', { name: 'Habits', exact: true }).click();
    await expect(page).toHaveURL(/#\/habits$/);
    // "Drink 8 Glasses of Water" is a seeded habit (SEED_HABITS).
    await expect(page.getByText('Drink 8 Glasses of Water').first()).toBeVisible();
  });
});
