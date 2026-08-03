import { test, expect } from '@playwright/test';
import { enterTestMode, usd, bottomNav, budgetNavWithPending, safeToSpendButton, dismissAutoOpenedRecap } from './helpers';

/**
 * Unified transaction review (advisor plan 07, spec 2) — the post-#792 review
 * drawer, including the Apple Pay $0 `needsAmount` stub path.
 *
 * Boots the 'stub' seed variant: the default seeds PLUS one $0 pending stub
 * (merchant "Apple Pay", needsAmount). On app open the review drawer
 * auto-opens on it; the amount field starts blank and the CTA is disabled
 * until an amount is entered. Approving must use the ENTERED amount for the
 * checking-balance debit (the single-debit rule), move the row out of the
 * review queue, update the bucket's spent figure, and land it verified in the
 * master list.
 */

const SEED_CHECKING = 5420.5;
const STUB_AMOUNT = 12.34;

test.describe('Transaction review drawer (Test Mode, stub seed)', () => {
  test('fills a $0 stub inline and verifies it into a bucket', async ({ page }) => {
    await enterTestMode(page, 'stub');
    await dismissAutoOpenedRecap(page);

    // The stub puts a count badge on the Budget nav link's accessible name.
    await expect(budgetNavWithPending(page, 1)).toBeVisible();

    // Drawer auto-opens on the stub: blank autofocused amount, disabled CTA.
    const drawer = page.getByRole('dialog', { name: 'Review (1 of 1)' });
    await expect(drawer).toBeVisible();
    const amount = drawer.getByLabel('Amount');
    await expect(amount).toHaveValue('');
    await expect(drawer.getByRole('button', { name: 'Add amount', exact: true })).toBeDisabled();

    // Enter the settled amount and categorize into a bucket.
    await amount.fill(String(STUB_AMOUNT));
    await drawer.getByLabel('Budget Category').selectOption({ label: 'Entertainment' });
    // Typing an amount swaps the label off the "Add amount" hint onto the CTA.
    await drawer.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(drawer).not.toBeVisible();

    // No second `dismissAutoOpenedRecap` here. The review drawer held the
    // app's one auto-open slot, and WeeklyRecapCard now SKIPS THE SESSION
    // rather than deferring — so closing this drawer can no longer hand the
    // user a late-landing recap on the way to their next tap.

    // It left the review queue: the Budget link's name is back to exactly "Budget".
    await expect(bottomNav(page).getByRole('link', { name: 'Budget', exact: true })).toBeVisible();

    // Bucket progress: Entertainment now shows the verified spend.
    await bottomNav(page).getByRole('link', { name: 'Budget', exact: true }).click();
    // Tapping the multi-view Budget tab opens its sub-view menu
    // (TabSubViewMenu); picking Buckets navigates to the buckets view.
    await page.getByRole('tab', { name: 'Budget' }).click();
    await page.getByRole('menuitemradio', { name: 'Buckets' }).click();
    await expect(page.getByText(usd(STUB_AMOUNT), { exact: true })).toBeVisible();

    // Master list: the row exists and is no longer marked Pending.
    // (Activity is multi-view too — pick Transactions from its sub-view menu.)
    await page.getByRole('tab', { name: 'Activity' }).click();
    await page.getByRole('menuitemradio', { name: 'Transactions' }).click();
    const row = page.getByText('Apple Pay', { exact: true });
    await expect(row).toBeVisible();
    await expect(page.getByText('Pending', { exact: true })).not.toBeVisible();

    // Single-debit rule: the checking balance moved by exactly the ENTERED
    // amount (not the stub's $0). The Safe-to-Spend breakdown card was removed
    // from Budget → Overview (UX audit Batch 3) — the toolbar figure is now the
    // single place this number is surfaced, so assert there instead.
    await expect(safeToSpendButton(page)).toContainText(usd(SEED_CHECKING - STUB_AMOUNT));
  });
});
