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
  ...overrides,
});

describe('buildPrintWeekHtml', () => {
  it('renders still-to-buy and pre-checked on-hand checklists with escaped content', () => {
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
                toBuy: [{ name: 'Cheddar', quantity: '2 cups' }],
                onHand: [{ name: 'Macaroni' }, { name: '<Butter>' }],
              },
            ],
          },
        ],
        shopping: [{ storeLabel: 'TARGET', items: [{ name: 'Cheddar', quantity: '2 cups' }] }],
      })
    );

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('size: letter portrait');
    expect(html).toContain('Mac &amp; Cheese');
    expect(html).toContain('<ul class="ings need"><li><span class="box"></span><span>Cheddar <span class="qty">2 cups</span></span></li></ul>');
    expect(html).toContain('<ul class="ings have">');
    expect(html).toContain('<span class="box checked"></span><span>&lt;Butter&gt;</span>');
    expect(html).toContain('TARGET');
    expect(html).toContain('<span class="qty">2 cups</span>');
    // A week of only dinners doesn't repeat the type label.
    expect(html).not.toContain('class="meal-type"');
  });

  it('labels meal types when the week mixes them, and omits an empty to-buy group', () => {
    const html = buildPrintWeekHtml(
      'Oct 5 – 11, 2026',
      week({
        days: [
          {
            ...emptyDay('Mon', '5'),
            meals: [{ typeLabel: 'Lunch', mealName: 'Salad', toBuy: [], onHand: [{ name: 'Lettuce' }] }],
          },
        ],
      })
    );
    expect(html).toContain('<span class="meal-type">Lunch</span>');
    expect(html).not.toContain('ings need');
  });

  it('renders a legacy numeric quantity without throwing', () => {
    // ShoppingItem.quantity is typed `string`, but some Firestore docs hold a
    // raw number (written by the quickAdd Cloud Function before the
    // quantity-handling fix; shoppingItemConverter does a blind cast).
    const html = buildPrintWeekHtml(
      'Oct 5 – 11, 2026',
      week({
        shopping: [{ storeLabel: 'OTHER', items: [{ name: 'Milk', quantity: 2 }] }],
      })
    );
    expect(html).toContain('<span class="qty">2</span>');
  });

  it('keeps empty days as rows and shows empty-state copy', () => {
    const html = buildPrintWeekHtml('Oct 5 – 11, 2026', week());
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
