import { test, expect } from '@playwright/test';
import { enterTestMode, bottomNav } from './helpers';

/**
 * Habit toggle ↔ points sync (advisor plan 07, spec 3).
 *
 * Seeded: "Exercise 30min" (threshold, targetCount 1, basePoints 20, no
 * streak) and Test User points daily 30 / weekly 150 in the toolbar cluster.
 * Completing the habit awards basePoints × multiplier (fresh streak of 1 →
 * 1.0×, so exactly +20); resetting it must reverse the award exactly — the
 * drift bug class this repo has fixed twice.
 */

test.describe('Habit points (Test Mode)', () => {
  test('completing a threshold habit awards points; reset reverses them exactly', async ({ page }) => {
    await enterTestMode(page);

    const pointsCluster = page.getByRole('button', { name: /View Rewards and Points breakdown/ });
    await expect(pointsCluster.getByText('30', { exact: true })).toBeVisible();
    await expect(pointsCluster.getByText('150', { exact: true })).toBeVisible();

    await bottomNav(page).getByRole('link', { name: 'Habits', exact: true }).click();

    // Complete the habit (count 0 → 1 hits the target).
    await page.getByRole('button', { name: 'Toggle habit: Exercise 30min, current count: 0' }).click();
    await expect(
      page.getByRole('button', { name: 'Toggle habit: Exercise 30min, current count: 1' })
    ).toBeVisible();

    // +20 in both windows (multiplier 1.0 on a fresh 1-day streak).
    await expect(pointsCluster.getByText('50', { exact: true })).toBeVisible();
    await expect(pointsCluster.getByText('170', { exact: true })).toBeVisible();

    // Reset the habit (the card's X). Exactly one habit is active, so the
    // accessible name is unique.
    await page.getByRole('button', { name: 'Reset habit progress' }).click();
    await expect(
      page.getByRole('button', { name: 'Toggle habit: Exercise 30min, current count: 0' })
    ).toBeVisible();

    // Exact reversal — no drift.
    await expect(pointsCluster.getByText('30', { exact: true })).toBeVisible();
    await expect(pointsCluster.getByText('150', { exact: true })).toBeVisible();
  });
});
