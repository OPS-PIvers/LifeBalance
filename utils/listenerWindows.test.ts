import { describe, it, expect } from 'vitest';
import { addDays, format, subDays } from 'date-fns';
import {
  TRANSACTION_WINDOW_DAYS,
  TODO_COMPLETED_WINDOW_DAYS,
  getTransactionWindowStart,
  getMealPlanWindow,
  getWeekRange,
  getCompletedTodoWindowStart,
} from './listenerWindows';

const ymd = (d: Date) => format(d, 'yyyy-MM-dd');

describe('getTransactionWindowStart', () => {
  const now = new Date('2026-06-15T12:00:00');
  const cutoff = ymd(subDays(now, TRANSACTION_WINDOW_DAYS));

  it('returns null when there is no current period (windowing disabled)', () => {
    expect(getTransactionWindowStart('', now)).toBeNull();
  });

  it('uses the N-day cutoff when the current period is more recent than it', () => {
    // A period that started last week is well within the 90-day window.
    const recentPeriod = ymd(subDays(now, 7));
    expect(getTransactionWindowStart(recentPeriod, now)).toBe(cutoff);
  });

  it('reaches back to the period start when the current period is older than the cutoff', () => {
    // A period older than 90 days must still be fully covered so bucketSpent stays exact.
    const oldPeriod = ymd(subDays(now, 200));
    expect(getTransactionWindowStart(oldPeriod, now)).toBe(oldPeriod);
    expect(oldPeriod < cutoff).toBe(true);
  });

  it('treats a period exactly at the cutoff as covered (returns the cutoff)', () => {
    expect(getTransactionWindowStart(cutoff, now)).toBe(cutoff);
  });
});

describe('getMealPlanWindow', () => {
  // Local-noon inputs avoid UTC/local date-boundary flakiness across timezones.
  it('spans the current week ± 1 (21 days), Monday..Sunday', () => {
    const date = new Date('2026-06-17T12:00:00'); // a Wednesday
    const { start, end } = getMealPlanWindow(date, 1);

    // Previous Monday … following Sunday for the week of 2026-06-15.
    expect(start).toBe('2026-06-08'); // Monday, one week before
    expect(end).toBe('2026-06-28'); // Sunday, one week after

    // The reference date falls inside the window.
    expect(start <= ymd(date) && ymd(date) <= end).toBe(true);
  });

  it('honours a custom radius', () => {
    const date = new Date('2026-06-17T12:00:00');
    const { start, end } = getMealPlanWindow(date, 2);
    const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime()) / 86_400_000) + 1;
    expect(days).toBe(35); // 5 weeks
  });
});

describe('getWeekRange', () => {
  it('returns Monday..Sunday for the week containing the date', () => {
    const { start, end } = getWeekRange(new Date('2026-06-17T12:00:00')); // Wednesday
    expect(start).toBe('2026-06-15'); // Monday
    expect(end).toBe('2026-06-21'); // Sunday
  });
});

describe('getCompletedTodoWindowStart', () => {
  it('is N days before now', () => {
    const now = new Date('2026-06-15T08:00:00');
    const expected = subDays(now, TODO_COMPLETED_WINDOW_DAYS);
    expect(ymd(getCompletedTodoWindowStart(now))).toBe(ymd(expected));
  });

  it('defaults to the 30-day window', () => {
    expect(TODO_COMPLETED_WINDOW_DAYS).toBe(30);
    // Sanity: the helper produces a date strictly in the past relative to "now".
    const start = getCompletedTodoWindowStart();
    expect(start.getTime()).toBeLessThan(addDays(new Date(), 1).getTime());
  });
});
