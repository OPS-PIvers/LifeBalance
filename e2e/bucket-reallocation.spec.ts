import { test, expect } from '@playwright/test';
import { enterTestMode, usd, addManualExpense, bottomNav } from './helpers';

/**
 * Bucket reallocation (advisor plan 07, spec 4) — the "Fix Overspending" flow.
 *
 * Overspend the seeded Gas bucket (limit $150) with a $200 verified expense,
 * then cover the $50 overage from Groceries (limit $600). Both limits must
 * update and the total budget must conserve: 600 + 150 = 550 + 200.
 */

test.describe('Bucket reallocation (Test Mode)', () => {
  test('fixing an overspent bucket moves limit between buckets and conserves totals', async ({ page }) => {
    await enterTestMode(page);

    // Today-dated manual expense → verified immediately (no review drawer),
    // driving Gas $50 over its $150 limit.
    await addManualExpense(page, {
      amount: '200',
      merchant: 'E2E Gas Station',
      category: 'Gas',
    });

    await bottomNav(page).getByRole('link', { name: 'Money', exact: true }).click();
    await page.getByRole('tab', { name: 'Buckets' }).click();

    // The overspent Gas card surfaces the Fix affordance.
    await page.getByRole('button', { name: 'Fix' }).click();

    const drawer = page.getByRole('dialog', { name: 'Fix Overspending' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(`Needs ${usd(50)} to cover`)).toBeVisible();

    // Source: the Groceries bucket (option value = bucket id 'b1').
    await drawer.getByLabel('Source of Funds').selectOption('b1');
    // Preview ("Remaining in source"): Groceries has $600 limit − $45.50
    // seeded verified spend = $554.50 available, minus the $50 transfer.
    await expect(drawer.getByText(usd(504.5), { exact: true })).toBeVisible();
    await drawer.getByRole('button', { name: 'Confirm' }).click();
    await expect(drawer).not.toBeVisible();

    // Both limits updated (asserted via the edit-limit buttons' aria-labels):
    // Gas 150 → 200, Groceries 600 → 550. Totals conserve (750 both sides).
    await expect(
      page.getByRole('button', { name: 'Edit limit for Gas, currently $200' })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Edit limit for Groceries, currently $550' })
    ).toBeVisible();
  });
});
