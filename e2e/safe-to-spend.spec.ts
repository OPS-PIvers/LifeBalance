import { test, expect } from '@playwright/test';
import { enterTestMode, usd, localDateString, safeToSpendButton, addManualExpense, reviewDrawer, bottomNav, moneyNavWithPending } from './helpers';

/**
 * Safe-to-Spend money path (advisor plan 07, spec 1).
 *
 * Seeded state: one checking account at $5,420.50, no calendar bills, no
 * pending transactions → Safe to Spend = $5,420.50.
 *
 * A FUTURE-dated manual expense is created `pending_review`: it must drop the
 * headline figure by exactly its amount via the pendingSpend term (no balance
 * move). Verifying it through the review drawer must then move the checking
 * balance and zero the pending term — with the headline unchanged (no double
 * count).
 */

const SEED_CHECKING = 5420.5;
const EXPENSE = 25.5;

test.describe('Safe to Spend (Test Mode)', () => {
  test('a pending expense drops the figure by exactly its amount', async ({ page }) => {
    await enterTestMode(page);

    // Baseline headline figure.
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING));

    // Add a manual expense dated tomorrow → created pending_review.
    await addManualExpense(page, {
      amount: String(EXPENSE),
      merchant: 'E2E Cafe',
      category: 'Groceries',
      date: localDateString(1),
    });

    // The pending-review drawer auto-opens on the first pending transaction;
    // dismiss it without verifying. One label on every card, last or not.
    await reviewDrawer(page).getByRole('button', { name: 'Skip — add later' }).click();
    await expect(reviewDrawer(page)).not.toBeVisible();

    // Headline dropped by exactly the pending amount.
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING - EXPENSE));

    // The Money → Overview tab no longer hosts a Safe-to-Spend breakdown card
    // (UX audit Batch 3 — deleted as redundant with the toolbar figure above);
    // confirm the pending expense is still visible from the Overview tab via
    // the Money Pulse / bills widgets instead.
    await moneyNavWithPending(page, 1).click();
    await expect(page.getByText('E2E Cafe').first()).toBeVisible();
  });

  test('verifying the pending expense moves the checking balance, not the headline', async ({ page }) => {
    await enterTestMode(page);
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING));

    await addManualExpense(page, {
      amount: String(EXPENSE),
      merchant: 'E2E Cafe',
      category: 'Groceries',
      date: localDateString(1),
    });

    // Approve it in the auto-opened review drawer (category came through from
    // the manual form, so the CTA is immediately enabled).
    const drawer = reviewDrawer(page);
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Approve Transaction' }).click();
    await expect(drawer).not.toBeVisible();

    // Verified-only balance model: the headline stays at seed − expense (the
    // debit simply moved from the pending term to the checking balance). The
    // Money → Overview breakdown card was removed (UX audit Batch 3); the
    // moved balance is only surfaced via the toolbar figure now, and the
    // pending-review badge is gone from the Money nav link.
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING - EXPENSE));
    await expect(bottomNav(page).getByRole('link', { name: 'Money', exact: true })).toBeVisible();
  });
});
