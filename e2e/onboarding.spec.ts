import { test, expect } from '@playwright/test';
import { enterTestMode, usd, safeToSpendButton, bottomNav } from './helpers';

/**
 * First-run onboarding wizard (advisor plan 07, spec 5).
 *
 * Boots the 'fresh' seed variant (empty household — no accounts, buckets,
 * transactions, or habits) so the wizard's real job is observable: seed a
 * checking account and starter habits from nothing, then land on a dashboard
 * whose Safe-to-Spend reflects the entered balance.
 */

test.describe('Onboarding wizard (Test Mode, fresh seed)', () => {
  test('seeds a checking balance and starter habits, then lands on the dashboard', async ({ page }) => {
    await enterTestMode(page, 'fresh');

    // Empty household → Safe to Spend starts at $0.00.
    await expect(safeToSpendButton(page)).toContainText(usd(0));

    await page.goto('/#/onboarding');
    await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
    await page.getByRole('button', { name: 'Get started' }).click();

    // Step 2: starting checking balance.
    await expect(page.getByRole('heading', { name: 'Starting balance' })).toBeVisible();
    await page.getByLabel('Checking balance').fill('1234.56');
    await page.getByRole('button', { name: 'Next' }).click();

    // Step 3: pick two starter habits (clicking the visible label toggles the
    // sr-only checkbox).
    await expect(page.getByRole('heading', { name: 'Pick a few habits' })).toBeVisible();
    await page.getByText('Make bed', { exact: true }).click();
    await page.getByText('Drink 1 bottle of water', { exact: true }).click();
    await page.getByRole('button', { name: 'Add 2 & continue' }).click();

    // Step 4: invite (skip past) → Step 5: finish.
    await expect(page.getByRole('heading', { name: 'Invite your partner' })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'All set!' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to dashboard' }).click();

    // Landed on the dashboard with the seeded balance powering Safe to Spend.
    await expect(page).not.toHaveURL(/#\/onboarding/);
    await expect(safeToSpendButton(page)).toContainText(usd(1234.56));

    // The chosen starter habits exist.
    await bottomNav(page).getByRole('link', { name: 'Habits', exact: true }).click();
    await expect(page.getByText('Make bed', { exact: true })).toBeVisible();
    await expect(page.getByText('Drink 1 bottle of water', { exact: true })).toBeVisible();
  });
});
