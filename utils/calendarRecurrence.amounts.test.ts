import { describe, it, expect } from 'vitest';
import { parseISO } from 'date-fns';
import { CalendarItem } from '@/types/schema';
import {
  expandCalendarItems,
  MAX_EARLIER_AMOUNTS,
  occurrenceAmount,
  seriesAmountOn,
  withAmountFrom,
} from '@/utils/calendarRecurrence';

const xcel: CalendarItem = {
  id: 'xcel',
  title: 'Xcel',
  amount: 120,
  date: '2026-01-28',
  type: 'expense',
  isPaid: false,
  isRecurring: true,
  frequency: 'monthly',
};

const amountsByDate = (items: CalendarItem[]) =>
  Object.fromEntries(
    expandCalendarItems(items, parseISO('2026-09-01'), parseISO('2026-12-31')).map(i => [i.date, i.amount])
  );

describe('This and future months', () => {
  it('changes the amount from a date on, leaving earlier months alone', () => {
    const next = withAmountFrom(xcel, '2026-11-28', 135);
    expect(next).toEqual({ amount: 135, earlierAmounts: [{ before: '2026-11-28', amount: 120 }] });
    expect(amountsByDate([{ ...xcel, ...next }])).toEqual({
      '2026-09-28': 120,
      '2026-10-28': 120,
      '2026-11-28': 135,
      '2026-12-28': 135,
    });
  });

  it('a second, earlier change cuts the first one off', () => {
    const first = { ...xcel, ...withAmountFrom(xcel, '2026-11-28', 135) };
    const second = { ...first, ...withAmountFrom(first, '2026-10-28', 150) };
    expect(second.earlierAmounts).toEqual([{ before: '2026-10-28', amount: 120 }]);
    expect(amountsByDate([second])).toMatchObject({ '2026-09-28': 120, '2026-10-28': 150, '2026-12-28': 150 });
  });

  it('a later change keeps the months in between', () => {
    const first = { ...xcel, ...withAmountFrom(xcel, '2026-10-28', 135) };
    const second = { ...first, ...withAmountFrom(first, '2026-12-28', 140) };
    expect(amountsByDate([second])).toEqual({
      '2026-09-28': 120,
      '2026-10-28': 135,
      '2026-11-28': 135,
      '2026-12-28': 140,
    });
  });

  it('changing back drops the step that no longer says anything', () => {
    const first = { ...xcel, ...withAmountFrom(xcel, '2026-11-28', 135) };
    expect(withAmountFrom(first, '2026-11-28', 120)).toEqual({ amount: 120, earlierAmounts: [] });
  });

  it('keeps at most the newest steps', () => {
    let series: CalendarItem = xcel;
    for (let m = 1; m <= MAX_EARLIER_AMOUNTS + 5; m++) {
      series = { ...series, ...withAmountFrom(series, `20${String(30 + Math.floor(m / 12))}-${String((m % 12) + 1).padStart(2, '0')}-01`, m) };
    }
    expect(series.earlierAmounts).toHaveLength(MAX_EARLIER_AMOUNTS);
  });

  it('prices dates before, on and after a step', () => {
    const series = { amount: 140, earlierAmounts: [{ before: '2026-06-01', amount: 120 }, { before: '2026-09-01', amount: 130 }] };
    expect(seriesAmountOn(series, '2026-05-31')).toBe(120);
    expect(seriesAmountOn(series, '2026-06-01')).toBe(130);
    expect(seriesAmountOn(series, '2026-09-01')).toBe(140);
  });
});

describe('Just this month', () => {
  const override: CalendarItem = {
    id: 'ovr',
    title: 'Xcel',
    amount: 98.68,
    date: '2026-10-28',
    type: 'expense',
    isPaid: false,
    isRecurring: false,
    isOverride: true,
    parentRecurringId: 'xcel',
  };

  it('replaces one occurrence and keeps its synthetic id', () => {
    const expanded = expandCalendarItems([xcel, override], parseISO('2026-10-01'), parseISO('2026-11-30'));
    expect(expanded.map(i => [i.id, i.amount])).toEqual([
      ['xcel_instance_2026-10-28', 98.68],
      ['xcel_instance_2026-11-28', 120],
    ]);
    expect(occurrenceAmount([xcel, override], xcel, '2026-10-28')).toBe(98.68);
  });

  it('a paid or deleted occurrence ignores its override', () => {
    const paid: CalendarItem = { ...override, id: 'paid', isOverride: undefined, isPaid: true, amount: 101 };
    expect(expandCalendarItems([xcel, override, paid], parseISO('2026-10-01'), parseISO('2026-10-31')).map(i => i.amount)).toEqual([101]);
    const deleted: CalendarItem = { ...override, isDeleted: true };
    expect(expandCalendarItems([xcel, deleted], parseISO('2026-10-01'), parseISO('2026-10-31'))).toEqual([]);
  });
});
