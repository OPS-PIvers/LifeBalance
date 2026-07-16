import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  weeklyRecapCardVisible,
  moneyRecapCardVisible,
  weeklyRecapDismissKey,
  moneyRecapDismissKey,
  WEEKLY_RECAP_FRESHNESS_MS,
  MONEY_RECAP_FRESHNESS_MS,
} from './recapVisibility';
import type { WeeklyRecap, MonthlyMoneyRecap } from '@/types/schema';

const NOW = new Date('2026-07-16T12:00:00Z').getTime();

const weekly = (generatedAt: string): WeeklyRecap =>
  ({ isoWeek: '2026-W29', generatedAt }) as WeeklyRecap;
const monthly = (generatedAt: string): MonthlyMoneyRecap =>
  ({ month: '2026-06', generatedAt }) as MonthlyMoneyRecap;

describe('recapVisibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is false for undefined recaps', () => {
    expect(weeklyRecapCardVisible(undefined)).toBe(false);
    expect(moneyRecapCardVisible(undefined)).toBe(false);
  });

  it('shows a recap generated within its freshness window', () => {
    expect(weeklyRecapCardVisible(weekly(new Date(NOW - 1000).toISOString()))).toBe(true);
    expect(moneyRecapCardVisible(monthly(new Date(NOW - 1000).toISOString()))).toBe(true);
  });

  it('hides a recap older than its freshness window', () => {
    expect(
      weeklyRecapCardVisible(weekly(new Date(NOW - WEEKLY_RECAP_FRESHNESS_MS - 1000).toISOString()))
    ).toBe(false);
    expect(
      moneyRecapCardVisible(monthly(new Date(NOW - MONEY_RECAP_FRESHNESS_MS - 1000).toISOString()))
    ).toBe(false);
  });

  it('hides a recap with a future or invalid timestamp', () => {
    expect(weeklyRecapCardVisible(weekly(new Date(NOW + 60_000).toISOString()))).toBe(false);
    expect(weeklyRecapCardVisible(weekly('not-a-date'))).toBe(false);
  });

  it('hides a dismissed recap (localStorage, keyed per period)', () => {
    const fresh = new Date(NOW - 1000).toISOString();
    window.localStorage.setItem(weeklyRecapDismissKey('2026-W29'), '1');
    expect(weeklyRecapCardVisible(weekly(fresh))).toBe(false);
    window.localStorage.setItem(moneyRecapDismissKey('2026-06'), '1');
    expect(moneyRecapCardVisible(monthly(fresh))).toBe(false);
    // A different period's dismissal does not hide it
    expect(weeklyRecapCardVisible({ ...weekly(fresh), isoWeek: '2026-W30' })).toBe(true);
  });
});
