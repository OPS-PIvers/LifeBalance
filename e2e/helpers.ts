import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the LifeBalance e2e suite (Test Mode, mobile viewport).
 *
 * House rules (see smoke.spec.ts for the full notes):
 *   - Never `waitForLoadState('networkidle')` — the SW/FCM keep the network busy.
 *   - Prefer accessible selectors (getByRole/getByLabel); a `data-testid` is an
 *     a11y smell to note, not a convenience.
 */

/**
 * Navigate to the test-mode activation URL and wait for the app to re-mount
 * with the mock providers (orange banner visible = mock household rendered).
 *
 * `seed` selects a MockHouseholdContext seed variant (read from sessionStorage
 * at provider mount):
 *   - 'fresh' — empty household (onboarding spec)
 *   - 'stub'  — default seeds + one Apple Pay $0 `needsAmount` pending stub
 */
export async function enterTestMode(page: Page, seed?: 'fresh' | 'stub'): Promise<void> {
  if (seed) {
    await page.addInitScript((s) => {
      window.sessionStorage.setItem('LIFEBALANCE_TEST_SEED', s);
    }, seed);
  }
  await page.goto('/#/login?test=true');
  await expect(page.getByText(/TEST MODE - MOCK DATA/i)).toBeVisible();
  // The banner can render BEFORE Login's full reload to '/' lands; interacting
  // during that in-flight navigation detaches elements mid-click. Wait for the
  // post-reload shell (off the login route, bottom nav mounted) before
  // returning.
  await expect(page).not.toHaveURL(/#\/login/);
  await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible();
}

/**
 * Locator for the Money bottom-nav link while N transactions await review.
 * The badge's sr-only suffix is a separate text node, so the computed
 * accessible name joins with a space: "Money , 1 pending review".
 */
export function moneyNavWithPending(page: Page, count: number) {
  return bottomNav(page).getByRole('link', { name: new RegExp(`Money\\s*, ${count} pending review`) });
}

/**
 * Format a dollar amount exactly like the app's `formatCurrency` default
 * (Intl en-US USD, two decimals — deterministic across environments).
 */
export const usd = (amount: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

/**
 * Local-timezone `yyyy-MM-dd`, offset by whole days — mirrors the app's
 * `getLocalDateString()` (which the specs can't import; e2e/ is insulated from
 * the app's tsconfig).
 */
export function localDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The always-visible Safe-to-Spend readout in the top toolbar. */
export function safeToSpendButton(page: Page) {
  return page.getByRole('button', { name: 'View Safe to Spend details' });
}

/**
 * Add a manual expense through the capture FAB → Manual Entry form.
 *
 * A `date` in the future creates the transaction `pending_review` (no balance
 * move; Safe-to-Spend drops via pendingSpend); today or earlier creates it
 * `verified` (immediate balance debit). Omitting `date` keeps the form's
 * default (today → verified).
 */
export async function addManualExpense(
  page: Page,
  tx: { amount: string; merchant: string; category: string; date?: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Capture transaction, task, or item' }).click();

  // The capture drawer opens on the transaction menu view ("Add Transaction").
  const captureDrawer = page.getByRole('dialog', { name: /Add Transaction/i });
  await captureDrawer.getByRole('button', { name: /Manual Entry/ }).click();

  // Same drawer, title flips to "Manual Entry".
  const manualDrawer = page.getByRole('dialog', { name: /Manual Entry/i });
  await manualDrawer.getByLabel('Amount').fill(tx.amount);
  await manualDrawer.getByLabel('Merchant').fill(tx.merchant);
  if (tx.date) {
    await manualDrawer.getByLabel('Date').fill(tx.date);
  }
  await manualDrawer.getByRole('radio', { name: tx.category, exact: true }).click();
  await manualDrawer.getByRole('button', { name: 'Save Transaction' }).click();
}

/** The auto-opening pending-review drawer ("Review (n of m)"). */
export function reviewDrawer(page: Page) {
  return page.getByRole('dialog', { name: /Review \(\d+ of \d+\)/ });
}

/** Bottom-nav landmark (the app's primary navigation). */
export function bottomNav(page: Page) {
  return page.getByRole('navigation', { name: /main navigation/i });
}
