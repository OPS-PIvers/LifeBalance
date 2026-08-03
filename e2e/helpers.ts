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
 *   - 'merchant-rules' — default seeds + rows carrying raw bank descriptors
 *   - 'bill-merge' — default seeds + the bill/charge pairs (TODO.md 2H): an
 *     unpaid recurring bill with its screenshot-imported charge, plus TWO
 *     already-paid bills each with the nightly sync's own copy of it — one per
 *     settled-bill evidence tier (water = descriptor, electric = amount-only)
 *
 * The union mirrors `readTestSeedVariant` in MockHouseholdContext — the two
 * must stay in step or a spec can pass a variant the provider silently ignores.
 */
export async function enterTestMode(
  page: Page,
  seed?: 'fresh' | 'stub' | 'merchant-rules' | 'bill-merge',
): Promise<void> {
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
 * Locator for the Budget bottom-nav link while N transactions await review.
 * The badge's sr-only suffix is a separate text node, so the computed
 * accessible name joins with a space: "Budget , 1 pending review".
 *
 * Scoped to the nav landmark because "Budget" is also the page's h1 and its
 * tab-strip group label — the role + landmark pair is what disambiguates.
 */
export function budgetNavWithPending(page: Page, count: number) {
  return bottomNav(page).getByRole('link', { name: new RegExp(`Budget\\s*, ${count} pending review`) });
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
 * Add a manual expense through the capture FAB.
 *
 * The Budget tab opens STRAIGHT onto the manual form — there is no longer a
 * "Manual Entry vs Add from Image" menu card to click through first, and the
 * drawer keeps its generic "Capture" title while the type selector is visible.
 * Save lives in the drawer's fixed footer (still inside the dialog), so one
 * `captureDrawer` scope covers the whole flow.
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

  const captureDrawer = page.getByRole('dialog', { name: /Capture/i });
  await captureDrawer.getByLabel('Amount').fill(tx.amount);
  await captureDrawer.getByLabel('Merchant').fill(tx.merchant);
  if (tx.date) {
    await captureDrawer.getByLabel('Date').fill(tx.date);
  }
  await captureDrawer.getByLabel('Category').selectOption({ label: tx.category });
  await captureDrawer.getByRole('button', { name: /Save transaction/i }).click();
}

/** The auto-opening pending-review drawer ("Review (n of m)"). */
export function reviewDrawer(page: Page) {
  return page.getByRole('dialog', { name: /Review \(\d+ of \d+\)/ });
}

/** Bottom-nav landmark (the app's primary navigation). */
export function bottomNav(page: Page) {
  return page.getByRole('navigation', { name: /main navigation/i });
}

/**
 * Dismiss the auto-opened weekly recap drawer if Test Mode surfaced one on
 * this app open (ARCH-1: `WeeklyRecapCard` opens the just-closed week's
 * recap once per ISO week, Dashboard-only — see CLAUDE.md's Weekly Recap
 * section). This is the app working as designed, not a bug: a real user in
 * the way of it just closes it and gets on with what they came to do. Every
 * spec that lands on the Dashboard first should call this immediately after
 * `enterTestMode`, before its first real interaction — the drawer's backdrop
 * covers the whole viewport and intercepts every click underneath it.
 *
 * Safe no-op when the recap never opens (a seed/timing combination that
 * doesn't qualify): a bounded `waitFor` rather than an assertion, so a spec
 * passes identically whether or not auto-open fired — this must never become
 * a new source of flake by depending on the recap's presence.
 *
 * Waits for the drawer to be fully GONE, not just for the close click to
 * register. framer-motion's exit animation keeps `drawer-content` painted
 * (and still intercepting pointer events) for a beat after `onClose` fires,
 * so returning right after the click reproduces the exact same "intercepts
 * pointer events" failure, just moved one line later.
 */
export async function dismissAutoOpenedRecap(page: Page): Promise<void> {
  const drawer = page.getByRole('dialog', { name: /Week in review/ });
  const appeared = await drawer
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return;

  // The drawer's own close affordance (Drawer.tsx's title-bar X button) —
  // precise, unlike a blind Escape press or a backdrop click at coordinates.
  await drawer.getByRole('button', { name: 'Close drawer' }).click();
  await expect(drawer).toBeHidden();
}
