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
    // dismiss it (single card → "Done for now") without verifying.
    await reviewDrawer(page).getByRole('button', { name: 'Done for now' }).click();
    await expect(reviewDrawer(page)).not.toBeVisible();

    // Headline dropped by exactly the pending amount.
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING - EXPENSE));

    // The Money → Overview breakdown shows the work: full checking balance,
    // minus a "Pending transactions" line for exactly the expense.
    await moneyNavWithPending(page, 1).click();
    await page.getByRole('button', { name: 'How is this calculated?' }).click();
    await expect(page.getByText('Checking balance')).toBeVisible();
    await expect(page.getByText(usd(SEED_CHECKING), { exact: true })).toBeVisible();
    await expect(page.getByText('Pending transactions')).toBeVisible();
    await expect(page.getByText(`- ${usd(EXPENSE)}`, { exact: true })).toBeVisible();
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
    // debit simply moved from the pending term to the checking balance)...
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING - EXPENSE));

    // ...and the breakdown shows the moved balance with NO pending line.
    await bottomNav(page).getByRole('link', { name: 'Money', exact: true }).click();
    await page.getByRole('button', { name: 'How is this calculated?' }).click();
    await expect(page.getByText('Checking balance')).toBeVisible();
    await expect(page.getByText(usd(SEED_CHECKING - EXPENSE), { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Pending transactions')).not.toBeVisible();
  });
});
