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

/**
 * A scripted stand-in for Safari's webkitSpeechRecognition: each start()
 * "hears" the next phrase from window.__wallPhrases. It also hides the mic
 * API, so the wall sees a browser that can only use Safari's recognizer:
 * otherwise Auto would pick the on-device engine (openWakeWord + Vosk),
 * whose model files the dev server doesn't have.
 */
async function fakeSpeech(page: Page, phrases: string[]) {
  await page.addInitScript(list => {
    const w = window as unknown as { __wallPhrases: string[]; webkitSpeechRecognition: unknown; SpeechRecognition: unknown };
    w.__wallPhrases = list;
    class FakeRecognition {
      lang = '';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onspeechend: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const text = w.__wallPhrases.shift() ?? '';
        setTimeout(() => {
          this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: true })] });
          this.onend?.();
        }, 50);
      }
      stop() {}
      abort() {
        this.onend?.();
      }
    }
    w.webkitSpeechRecognition = FakeRecognition;
    w.SpeechRecognition = FakeRecognition;
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
  }, phrases);
}

test.describe('Wall display shell (Test Mode)', () => {
  test('boots with the clock, weather and rail', async ({ page }) => {
    await openWall(page, '15:15:00');
    // The Week screen's masthead sits at the top of the day column.
    const today = page.getByRole('region', { name: 'Today' });
    await expect(today.getByText('3:15', { exact: true })).toBeVisible();
    await expect(today.getByText('Saturday', { exact: true })).toBeVisible();
    await expect(today.getByText('October 3', { exact: true })).toBeVisible();
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

  test('shows the week, switches Coming up to Month, switches a module, and opens a day from the month', async ({ page }) => {
    await openWall(page, '15:15:00');
    const today = page.getByRole('region', { name: 'Today' });
    // Haircut is over by 3:15, so it moves under "Earlier today"; dinner is next.
    await expect(today.getByText('Earlier today')).toBeVisible();
    await expect(today.getByText('Haircut')).toBeVisible();
    await expect(today.getByText('Dinner at Grandma’s').first()).toBeVisible();
    const coming = page.getByRole('region', { name: 'Coming up' });
    await expect(coming.getByText('Dentist')).toBeVisible();
    await expect(coming.getByText('Water bill')).toBeVisible();

    // The Week · Month switch belongs to Coming up, and only changes its list.
    const range = coming.getByRole('group', { name: 'Coming up range' });
    await expect(range.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    await range.getByRole('button', { name: 'Month' }).click();
    await expect(range.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    await expect(today).toBeVisible();
    await expect(coming.getByText('Dentist')).toBeVisible();
    await range.getByRole('button', { name: 'Week' }).click();

    // Module controls live in Arrange mode, opened from the display menu.
    await expect(page.getByRole('button', { name: /Switch/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Display menu' }).click();
    await page.getByRole('button', { name: /Arrange the panel/ }).click();
    await page.getByRole('button', { name: /Switch/ }).click();
    await page.getByRole('dialog', { name: 'Panel shows' }).getByRole('button', { name: /To-dos/ }).click();
    await expect(page.getByRole('region', { name: 'To-dos' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Coming up' })).toBeHidden();
    await page.getByRole('button', { name: 'Done', exact: true }).click();

    // Day and Month are full screens with their own header switch and a way back.
    await page.getByRole('region', { name: 'To-dos' }).waitFor();
    await page.getByRole('button', { name: 'Display menu' }).click();
    await page.getByRole('button', { name: /Arrange the panel/ }).click();
    await page.getByRole('button', { name: /Switch/ }).click();
    await page.getByRole('dialog', { name: 'Panel shows' }).getByRole('button', { name: /Coming up/ }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('region', { name: 'Coming up' }).getByRole('button', { name: /Dentist/ }).click();
    await page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month' }).click();
    await page.getByRole('button', { name: 'Sunday, October 4' }).click();
    await expect(page.getByText('Sunday, October 4')).toBeVisible();
    await expect(page.getByText('Dentist')).toBeVisible();
    await expect(page.getByText('Water bill')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Calendar/ }).click();
    await expect(page.getByRole('region', { name: 'Coming up' })).toBeVisible();
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

  test('voice navigation runs on the local grammar', async ({ page }) => {
    await fakeSpeech(page, ['Show the meals', 'open the shopping list', 'show month']);
    await openWall(page, '15:15:00');
    const mic = page.getByRole('button', { name: 'Voice command' });
    await mic.click();
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Meals/ })).toHaveAttribute('aria-current', 'page');
    await mic.click();
    await expect(page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: /Shopping/ })).toHaveAttribute('aria-current', 'page');
    await mic.click();
    await expect(page.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Month', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a voice result opens the big card, and sound waits for a touch', async ({ page }) => {
    await fakeSpeech(page, ['stop rotating']);
    await openWall(page, '15:15:00');
    // No touch yet: iPadOS would keep audio locked, and the wall says so.
    await expect(page.getByRole('button', { name: 'Tap to turn on sound' })).toBeVisible();
    await page.getByRole('button', { name: 'Voice command' }).click();
    const card = page.getByRole('status', { name: 'Voice' });
    await expect(card).toContainText('Stopped rotating');
    await expect(card).toContainText('The panel stays as it is.');
    // The tap on the mic unlocked sound.
    await expect(page.getByRole('button', { name: 'Tap to turn on sound' })).toHaveCount(0);
  });

  test('a starting-soon alert says when to leave', async ({ page }) => {
    // Fixture: Piano lesson at 4:30 on an alert calendar, a 20-minute drive away.
    await openWall(page, '15:59:30');
    await expect(page.getByRole('region', { name: 'Today' }).getByText('3:59', { exact: true })).toBeVisible();
    await page.clock.fastForward('00:45');
    const card = page.getByRole('alertdialog');
    await expect(card).toContainText('Leave in 10 min');
    await expect(card).toContainText('Piano lesson');
    await expect(card).toContainText('20 min drive');
    await expect(card).toContainText('Leave by 4:10 PM');
    await card.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('“what’s my day” shows the day brief', async ({ page }) => {
    await fakeSpeech(page, ["What's my day?"]);
    await openWall(page, '15:15:00');
    await page.getByRole('button', { name: 'Voice command' }).click();
    const card = page.getByRole('status', { name: 'Your day' });
    await expect(card).toContainText('Today');
    await expect(card).toContainText('54° now');
    await expect(card).toContainText('2 things left today');
    await expect(card).toContainText('4:30 PM · Piano lesson · Test · leave by 4:10 PM');
    await card.getByRole('button', { name: /Stop|Close/ }).click();
    await expect(page.getByRole('status', { name: 'Your day' })).toHaveCount(0);
  });

  test('an alert takes over from the brief', async ({ page }) => {
    await fakeSpeech(page, ["What's my day?"]);
    await openWall(page, '15:59:30');
    await page.getByRole('button', { name: 'Voice command' }).click();
    await expect(page.getByRole('status', { name: 'Your day' })).toBeVisible();
    await page.clock.fastForward('00:45');
    await expect(page.getByRole('alertdialog')).toContainText('Leave in 10 min');
    await expect(page.getByRole('status', { name: 'Your day' })).toHaveCount(0);
  });
});
