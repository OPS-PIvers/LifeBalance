// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildPrintWeekHtml, fitPrintSheet } from './printWeekHtml';
import { PrintWeek, PrintDay } from '@/utils/printWeekModel';

const emptyDay = (weekday: string, dayOfMonth: string): PrintDay => ({
  date: `2026-10-0${dayOfMonth}`,
  weekday,
  dayOfMonth,
  meals: [],
});

const week = (overrides: Partial<PrintWeek> = {}): PrintWeek => ({
  days: [emptyDay('Mon', '5'), emptyDay('Tue', '6')],
  shopping: [],
  mealCount: 0,
  toBuyCount: 0,
  ...overrides,
});

describe('buildPrintWeekHtml', () => {
  it('renders meals with to-buy checkboxes, an on-hand line and escaped content', () => {
    const html = buildPrintWeekHtml(
      'Oct 5 – 11, 2026',
      week({
        days: [
          {
            ...emptyDay('Mon', '5'),
            meals: [
              {
                typeLabel: 'Dinner',
                mealName: 'Mac & Cheese',
                hasIngredients: true,
                toBuy: [{ name: 'Cheddar', quantity: '2 cups' }],
                onHand: [{ name: 'Macaroni' }, { name: '<Butter>' }],
              },
            ],
          },
        ],
        shopping: [
          {
            storeLabel: 'TARGET',
            categories: [{ display: 'Dairy', items: [{ name: 'Cheddar', quantity: '2 cups', forDays: ['Mon'] }] }],
          },
        ],
        mealCount: 1,
        toBuyCount: 1,
      })
    );

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('size: letter portrait');
    expect(html).toContain('Mac &amp; Cheese');
    expect(html).toContain('1 to buy');
    expect(html).toContain('Macaroni, &lt;Butter&gt;');
    expect(html).toContain('TARGET');
    expect(html).toContain('<span class="for">Mon</span>');
    expect(html).toContain('1 meal · 1 item to buy');
    // A week of only dinners doesn't repeat the type label.
    expect(html).not.toContain('class="meal-type"');
  });

  it('collapses an item needed on many days to a count', () => {
    const html = buildPrintWeekHtml(
      'Oct 5 – 11, 2026',
      week({
        shopping: [
          {
            storeLabel: 'OTHER',
            categories: [{ display: 'Dairy', items: [{ name: 'Eggs', forDays: ['Mon', 'Tue', 'Wed', 'Thu'] }] }],
          },
        ],
      })
    );
    expect(html).toContain('<span class="for">4 days</span>');
  });

  it('marks a meal whose ingredients are all on hand', () => {
    const html = buildPrintWeekHtml(
      'Oct 5 – 11, 2026',
      week({
        days: [
          {
            ...emptyDay('Mon', '5'),
            meals: [{ typeLabel: 'Lunch', mealName: 'Salad', hasIngredients: true, toBuy: [], onHand: [{ name: 'Lettuce' }] }],
          },
        ],
        mealCount: 1,
      })
    );
    expect(html).toContain('All on hand');
    expect(html).toContain('<p class="meal-type">Lunch</p>');
  });

  it('renders a legacy numeric quantity without throwing', () => {
    // ShoppingItem.quantity is typed `string`, but some Firestore docs hold a
    // raw number (written by the quickAdd Cloud Function before the
    // quantity-handling fix; shoppingItemConverter does a blind cast).
    const html = buildPrintWeekHtml(
      'Oct 5 – 11, 2026',
      week({
        shopping: [{ storeLabel: 'OTHER', categories: [{ display: 'Dairy', items: [{ name: 'Milk', quantity: 2, forDays: [] }] }] }],
      })
    );
    expect(html).toContain('<span class="qty">2</span>');
  });

  it('keeps empty days as write-in rows and shows empty-state copy', () => {
    const html = buildPrintWeekHtml('Oct 5 – 11, 2026', week());
    expect(html).toContain('No meals planned yet');
    expect(html).toContain('Nothing on the list.');
    expect(html.match(/class="day empty-day"/g)).toHaveLength(2);
  });
});

describe('fitPrintSheet', () => {
  const sheetDoc = (overflowUntilPx: number) => {
    document.documentElement.innerHTML = '<body><main class="sheet"></main></body>';
    const sheet = document.querySelector<HTMLElement>('.sheet')!;
    Object.defineProperty(sheet, 'clientHeight', { configurable: true, get: () => 970 });
    Object.defineProperty(sheet, 'scrollHeight', {
      configurable: true,
      get: () => (parseFloat(document.documentElement.style.fontSize) > overflowUntilPx ? 1200 : 970),
    });
    return sheet;
  };

  it('shrinks the root size until the sheet fits its page', () => {
    const sheet = sheetDoc(11.5);
    fitPrintSheet(document);
    expect(document.documentElement.style.fontSize).toBe('11.5px');
    expect(sheet.classList.contains('overflow')).toBe(false);
  });

  it('lets the sheet flow onto a second page when even the minimum overflows', () => {
    const sheet = sheetDoc(1);
    fitPrintSheet(document);
    expect(sheet.classList.contains('overflow')).toBe(true);
  });
});
