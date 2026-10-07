import { test, expect, type Page } from '@playwright/test';

/**
 * Screenshots of every wall screen, in both orientations and both themes,
 * attached to the Playwright HTML report (CI uploads it as the
 * `playwright-report` artifact). They're for reviewing the layout, so the
 * assertions only check that each screen is up before its picture is taken.
 * Test Mode fixtures, Open-Meteo stubbed, the clock pinned to Saturday 3:15 pm.
 */
const DAY = '2026-10-03';
const pad = (n: number) => String(n).padStart(2, '0');

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

async function openWall(page: Page, time: string, dark: boolean) {
  if (dark) await page.addInitScript(() => sessionStorage.setItem('LIFEBALANCE_WALL_THEME', 'dark'));
  await page.clock.install({ time: new Date(`${DAY}T${time}`) });
  await stubWeather(page);
  await page.goto('/#/login?test=true');
  await expect(page.getByText(/TEST MODE - MOCK DATA/i)).toBeVisible();
  await expect(page).not.toHaveURL(/#\/login/);
  await page.goto('/#/wall');
  await expect(page.getByRole('navigation', { name: 'Views' })).toBeVisible();
}

const ORIENTATIONS = [
  { name: 'landscape', viewport: { width: 1366, height: 1024 } },
  { name: 'portrait', viewport: { width: 1024, height: 1366 } },
] as const;

for (const o of ORIENTATIONS) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`Wall screens · ${o.name} · ${theme}`, () => {
      test.use({ viewport: o.viewport, isMobile: false, hasTouch: true, serviceWorkers: 'block' });

      test('every screen', async ({ page }, testInfo) => {
        const shot = async (name: string) => {
          await page.waitForTimeout(300);
          await testInfo.attach(`${o.name}-${theme}-${name}`, { body: await page.screenshot(), contentType: 'image/png' });
        };
        await openWall(page, '15:15:00', theme === 'dark');
        const rail = page.getByRole('navigation', { name: 'Views' });

        await expect(page.getByRole('region', { name: 'Coming up' })).toBeVisible();
        await shot('1-week');

        await page.getByRole('button', { name: 'Display menu' }).click();
        await page.getByRole('button', { name: /Arrange the panel/ }).click();
        await expect(page.getByText('Arrange the panel')).toBeVisible();
        await shot('2-arrange');
        await page.getByRole('button', { name: 'Done', exact: true }).click();

        const picker = page.getByRole('group', { name: 'Calendar view' });
        await picker.getByRole('button', { name: 'Day' }).click();
        await shot('3-day');
        await page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month' }).click();
        await shot('4-month');

        await rail.getByRole('button', { name: /Shopping/ }).click();
        await shot('5-shopping');
        await rail.getByRole('button', { name: /To-dos/ }).click();
        await shot('6-todos');
        await rail.getByRole('button', { name: /Meals/ }).click();
        await shot('7-meals');
      });

      test('night', async ({ page }, testInfo) => {
        await openWall(page, '22:30:00', theme === 'dark');
        await expect(page.getByRole('button', { name: 'Wake the display' })).toBeVisible();
        await testInfo.attach(`${o.name}-${theme}-8-night`, { body: await page.screenshot(), contentType: 'image/png' });
      });
    });
  }
}
