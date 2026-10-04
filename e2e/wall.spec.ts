import { test, expect, type Page } from '@playwright/test';

/**
 * Wall display shell (docs/plans/wall-display-kiosk.md §8), in Test Mode at
 * the iPad's 1366×1024 landscape viewport. A member opening #/wall gets the
 * wall on WallSlicesProvider + Test Mode fixtures, so no Firebase is needed.
 * Open-Meteo is stubbed; the browser clock is pinned to 3:15 pm.
 */
// serviceWorkers: 'block' — once the app's SW registers (it does in CI), its
// fetches bypass page.route and the Open-Meteo stub below would be skipped.
test.use({ viewport: { width: 1366, height: 1024 }, isMobile: false, hasTouch: true, serviceWorkers: 'block' });

const pad = (n: number) => String(n).padStart(2, '0');
const DAY = '2026-10-03';

async function stubWeather(page: Page) {
  await page.route('https://api.open-meteo.com/**', route => {
    const times: string[] = [];
    for (let i = 0; i < 48; i++) times.push(`${i < 24 ? DAY : '2026-10-04'}T${pad(i % 24)}:00`);
    const days = ['03', '04', '05', '06', '07', '08'].map(d => `2026-10-${d}`);
    return route.fulfill({
      json: {
        current: { time: `${DAY}T15:15`, temperature_2m: 54.2, weather_code: 2 },
        hourly: {
          time: times,
          temperature_2m: times.map((_, i) => 45 + (i % 24) / 2),
          precipitation_probability: times.map((_, i) => (i === 18 || i === 19 ? 70 : 10)),
          weather_code: times.map((_, i) => (i === 18 || i === 19 ? 61 : 2)),
        },
        daily: {
          time: days,
          temperature_2m_max: [61, 58, 55, 60, 62, 64],
          temperature_2m_min: [43, 41, 40, 44, 45, 47],
          weather_code: [2, 61, 3, 0, 0, 1],
          precipitation_probability_max: [70, 80, 10, 0, 0, 5],
        },
      },
    });
  });
}

async function openWall(page: Page, time: string) {
  await page.clock.install({ time: new Date(`${DAY}T${time}`) });
  await stubWeather(page);
  await page.goto('/#/login?test=true');
  await expect(page.getByText(/TEST MODE - MOCK DATA/i)).toBeVisible();
  await expect(page).not.toHaveURL(/#\/login/);
  await page.goto('/#/wall');
}

test.describe('Wall display shell (Test Mode)', () => {
  test('boots with the clock, weather and rail', async ({ page }) => {
    await openWall(page, '15:15:00');
    await expect(page.getByRole('banner').getByText('3:15')).toBeVisible();
    await expect(page.getByRole('banner').getByText('Saturday')).toBeVisible();
    await expect(page.getByRole('banner').getByText('October 3')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Five-day forecast' })).toContainText('54°');
    await expect(page.getByText('Rain likely 6–8 pm')).toBeVisible();
    const rail = page.getByRole('navigation', { name: 'Views' });
    await expect(rail.getByRole('button', { name: /Calendar/ })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: 'Five-day forecast' }).click();
    await expect(page.getByRole('dialog', { name: 'Five-day forecast' })).toContainText('Next 5 days');
  });

  test('returns to the calendar after 3 idle minutes', async ({ page }) => {
    await openWall(page, '15:15:00');
    const rail = page.getByRole('navigation', { name: 'Views' });
    await rail.getByRole('button', { name: /Shopping/ }).click();
    await expect(rail.getByRole('button', { name: /Shopping/ })).toHaveAttribute('aria-current', 'page');
    await page.clock.runFor(3 * 60 * 1000 + 1000);
    await expect(rail.getByRole('button', { name: /Calendar/ })).toHaveAttribute('aria-current', 'page');
  });

  test('shows the night screen at 10 pm and wakes on tap', async ({ page }) => {
    await openWall(page, '22:30:00');
    const night = page.getByRole('button', { name: 'Wake the display' });
    await expect(night).toBeVisible();
    await expect(night).toContainText('10:30');
    await night.click();
    await expect(night).toBeHidden();
    await page.clock.runFor(61 * 1000);
    await expect(page.getByRole('button', { name: 'Wake the display' })).toBeVisible();
  });

  test('shows the week, switches a module, and opens a day from the month', async ({ page }) => {
    await openWall(page, '15:15:00');
    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByText('Haircut')).toBeVisible();
    await expect(today.getByText('Dinner at Grandma’s')).toBeVisible();
    const coming = page.getByRole('region', { name: 'Coming up' });
    await expect(coming.getByText('Dentist')).toBeVisible();
    await expect(coming.getByText('Water bill')).toBeVisible();

    await page.getByRole('button', { name: /Switch/ }).click();
    await page.getByRole('dialog', { name: 'Panel shows' }).getByRole('button', { name: /To-dos/ }).click();
    await expect(page.getByRole('region', { name: 'To-dos' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Coming up' })).toBeHidden();

    await page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month' }).click();
    await page.getByRole('button', { name: 'Sunday, October 4' }).click();
    await expect(page.getByText('Sunday, October 4')).toBeVisible();
    await expect(page.getByText('Dentist')).toBeVisible();
    await expect(page.getByText('Water bill')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('adds, checks off and undoes on the shopping list', async ({ page }) => {
    await openWall(page, '15:15:00');
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Shopping/ }).click();
    await expect(page.getByText('List is empty')).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add to Shopping' });
    await sheet.getByLabel('Item').fill('Paper towels');
    await sheet.getByLabel('Item').press('Enter');
    await expect(sheet.getByLabel('Item')).toHaveValue('');
    await sheet.getByRole('button', { name: 'Done' }).click();

    const item = page.getByRole('button', { name: /Paper towels/ });
    await expect(item).toBeVisible();
    await item.click();
    await expect(page.getByText('In the cart')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear (1)' })).toBeEnabled();
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('In the cart')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Clear (0)' })).toBeDisabled();
  });

  test('completes a kid’s to-do and opens a recipe', async ({ page }) => {
    await openWall(page, '15:15:00');
    const rail = page.getByRole('navigation', { name: 'Views' });
    await rail.getByRole('button', { name: /To-dos/ }).click();
    await page.getByRole('button', { name: /Make your bed/ }).click();
    await expect(page.getByRole('status')).toContainText('Completed Make your bed');
    await expect(page.getByRole('button', { name: /Make your bed/ })).toHaveAttribute('aria-pressed', 'true');

    await rail.getByRole('button', { name: /Meals/ }).click();
    await page.getByRole('button', { name: /Tacos/ }).click();
    const recipe = page.getByRole('complementary', { name: 'Tacos recipe' });
    await recipe.getByRole('button', { name: 'Add 3 missing to Shopping' }).click();
    await expect(page.getByRole('status')).toContainText('Added 3 items to Shopping');
    await expect(recipe.getByText('On the list')).toHaveCount(3);
  });

  test('the gear menu leads back to the app', async ({ page }) => {
    await openWall(page, '15:15:00');
    await page.getByRole('button', { name: 'Display menu' }).click();
    await page.getByRole('button', { name: /Leave the wall/ }).click();
    await expect(page).not.toHaveURL(/#\/wall/);
  });
});
