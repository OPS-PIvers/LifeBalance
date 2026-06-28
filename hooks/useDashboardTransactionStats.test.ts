import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { startOfWeek, subWeeks, addDays, format } from 'date-fns';
import type { Transaction } from '@/types/schema';
import { useDashboardTransactionStats } from '@/hooks/useDashboardTransactionStats';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
}));

// Frozen "now": Tue 2026-06-16T12:00:00Z.
//   Monday-week (this week): 2026-06-15 .. 2026-06-21
//   Monday-week (last week): 2026-06-08 .. 2026-06-14
//   Current month:           2026-06-01 .. 2026-06-30
// All fixture dates are chosen mid-window (or on a verified boundary) so they
// can't flip across local-vs-UTC parsing regardless of the test machine's TZ.
const NOW_ISO = '2026-06-16T12:00:00Z';

const makeTransaction = (overrides: Partial<Transaction>): Transaction =>
  ({
    id: 'tx-1',
    amount: 50,
    merchant: 'Store',
    category: 'Groceries',
    date: '2026-06-16',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  } as Transaction);

const setTransactions = (transactions: Transaction[]) => {
  vi.mocked(useFinance).mockReturnValue({ transactions } as ReturnType<typeof useFinance>);
};

const render = () => renderHook(() => useDashboardTransactionStats()).result.current;

describe('useDashboardTransactionStats', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(NOW_ISO));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns zeroed/empty stats for no transactions', () => {
    setTransactions([]);
    const stats = render();
    expect(stats.thisWeekSpend).toBe(0);
    expect(stats.lastWeekSpend).toBe(0);
    expect(stats.lastWeekSpendPulse).toBe(0);
    expect(stats.monthTotalSpent).toBe(0);
    expect(stats.monthCategoryItems).toEqual([]);
    expect(stats.recentTransactions).toEqual([]);
    expect(stats.transactionActivityRows).toEqual([]);
  });

  it('excludes income from every aggregate', () => {
    setTransactions([
      makeTransaction({ id: 'a', amount: 100, category: 'Groceries', date: '2026-06-16' }),
      makeTransaction({ id: 'inc', amount: 1000, category: 'Income', date: '2026-06-16' }),
    ]);
    const stats = render();
    expect(stats.thisWeekSpend).toBe(100);
    expect(stats.monthTotalSpent).toBe(100);
    expect(stats.monthCategoryItems.map((c) => c.name)).toEqual(['Groceries']);
    expect(stats.recentTransactions.map((t) => t.id)).toEqual(['a']);
    expect(stats.transactionActivityRows.map((r) => r.id)).toEqual(['a']);
  });

  it('excludes pending_review transactions from every aggregate', () => {
    setTransactions([
      makeTransaction({ id: 'v', amount: 40, date: '2026-06-16', status: 'verified' }),
      makeTransaction({ id: 'p', amount: 999, date: '2026-06-16', status: 'pending_review' }),
    ]);
    const stats = render();
    expect(stats.thisWeekSpend).toBe(40);
    expect(stats.monthTotalSpent).toBe(40);
    expect(stats.recentTransactions.map((t) => t.id)).toEqual(['v']);
    expect(stats.transactionActivityRows.map((r) => r.id)).toEqual(['v']);
  });

  it('splits this-week vs last-week spend at the Monday boundaries', () => {
    setTransactions([
      // This week (2026-06-15 .. 2026-06-21), incl. both Monday and Sunday edges.
      makeTransaction({ id: 'tw-mon', amount: 10, date: '2026-06-15' }),
      makeTransaction({ id: 'tw-mid', amount: 5, date: '2026-06-16' }),
      makeTransaction({ id: 'tw-sun', amount: 7, date: '2026-06-21' }),
      // Last week (2026-06-08 .. 2026-06-14), incl. both edges.
      makeTransaction({ id: 'lw-mon', amount: 3, date: '2026-06-08' }),
      makeTransaction({ id: 'lw-sun', amount: 2, date: '2026-06-14' }),
      // Just outside the windows.
      makeTransaction({ id: 'next-mon', amount: 1000, date: '2026-06-22' }),
      makeTransaction({ id: 'old', amount: 1000, date: '2020-01-01' }),
    ]);
    const stats = render();
    expect(stats.thisWeekSpend).toBe(22); // 10 + 5 + 7
    expect(stats.lastWeekSpend).toBe(5); // 3 + 2
    // Outside the DST spring-forward week, PulseStrip's last-week window is
    // identical to MoneyPulse's.
    expect(stats.lastWeekSpendPulse).toBe(5);
  });

  it('groups current-month spend by category and ignores other months', () => {
    setTransactions([
      makeTransaction({ id: '1', amount: 100, category: 'Groceries', date: '2026-06-16' }),
      makeTransaction({ id: '2', amount: 200, category: 'Groceries', date: '2026-06-10' }),
      makeTransaction({ id: '3', amount: 50, category: 'Dining', date: '2026-06-16' }),
      // Prior month — excluded from month aggregates.
      makeTransaction({ id: '4', amount: 500, category: 'Rent', date: '2026-05-30' }),
    ]);
    const stats = render();
    expect(stats.monthTotalSpent).toBe(350);
    expect(stats.monthCategoryItems).toEqual([
      { name: 'Groceries', amount: 300, percentage: (300 / 350) * 100 },
      { name: 'Dining', amount: 50, percentage: (50 / 350) * 100 },
    ]);
  });

  it('keeps top 3 categories and rolls the remainder into "Others"', () => {
    setTransactions([
      makeTransaction({ id: '1', amount: 100, category: 'A', date: '2026-06-16' }),
      makeTransaction({ id: '2', amount: 80, category: 'B', date: '2026-06-16' }),
      makeTransaction({ id: '3', amount: 60, category: 'C', date: '2026-06-16' }),
      makeTransaction({ id: '4', amount: 40, category: 'D', date: '2026-06-16' }),
      makeTransaction({ id: '5', amount: 20, category: 'E', date: '2026-06-16' }),
    ]);
    const stats = render();
    const names = stats.monthCategoryItems.map((c) => c.name);
    expect(names).toEqual(['A', 'B', 'C', 'Others']);
    const others = stats.monthCategoryItems.find((c) => c.name === 'Others')!;
    expect(others.amount).toBe(60); // 40 + 20
  });

  it('sorts the recent list by date desc and limits to 3', () => {
    setTransactions([
      makeTransaction({ id: 'oldest', date: '2026-06-10' }),
      makeTransaction({ id: 'newest', date: '2026-06-18' }),
      makeTransaction({ id: 'mid', date: '2026-06-14' }),
      makeTransaction({ id: 'old2', date: '2026-06-12' }),
    ]);
    const stats = render();
    expect(stats.recentTransactions.map((t) => t.id)).toEqual(['newest', 'mid', 'old2']);
    // Each recent item carries a precomputed relative-time label.
    expect(stats.recentTransactions[0]?.relativeDate).toEqual(expect.any(String));
  });

  it('sums money in integer cents without float drift', () => {
    setTransactions([
      makeTransaction({ id: '1', amount: 0.1, category: 'X', date: '2026-06-16' }),
      makeTransaction({ id: '2', amount: 0.2, category: 'X', date: '2026-06-16' }),
    ]);
    const stats = render();
    expect(stats.thisWeekSpend).toBe(0.3); // not 0.30000000000000004
    expect(stats.monthTotalSpent).toBe(0.3);
    expect(stats.monthCategoryItems[0]?.amount).toBe(0.3);
  });

  it('handles mixed positive/negative amounts (e.g. refunds) by signed sum', () => {
    setTransactions([
      makeTransaction({ id: 'spend', amount: 100, category: 'Groceries', date: '2026-06-16' }),
      makeTransaction({ id: 'refund', amount: -30, category: 'Groceries', date: '2026-06-16' }),
    ]);
    const stats = render();
    expect(stats.thisWeekSpend).toBe(70);
    expect(stats.monthTotalSpent).toBe(70);
    expect(stats.monthCategoryItems).toEqual([
      { name: 'Groceries', amount: 70, percentage: 100 },
    ]);
  });

  it('maps verified non-income rows for the activity feed using createdAt when present', () => {
    setTransactions([
      makeTransaction({
        id: 'with-created',
        merchant: 'Cafe',
        category: 'Dining',
        amount: 12,
        date: '2026-06-16',
        createdAt: '2026-06-16T08:30:00Z',
      }),
    ]);
    const stats = render();
    const row = stats.transactionActivityRows[0]!;
    expect(row).toMatchObject({
      id: 'with-created',
      type: 'transaction',
      title: 'Cafe',
      subtitle: 'Dining',
      amount: 12,
    });
    expect(row.timestamp.getTime()).toBe(new Date('2026-06-16T08:30:00Z').getTime());
  });

  // DST spring-forward: the two last-week anchors diverge ~1/year. MoneyPulse
  // uses `subWeeks(startOfWeek(now), 1)`; PulseStrip uses the raw
  // `startOfWeek(weekStart - 7*24h)`. This test locks in that each accumulator
  // buckets transactions into its OWN original window — the behavior we must
  // preserve. It is TZ-adaptive: it derives both anchors with the same date-fns
  // primitives the hook uses, so it asserts divergence on DST-observing runtimes
  // (e.g. America/Chicago) and exact coincidence on non-DST runtimes (e.g. the
  // UTC CI runner), and is correct in either case.
  describe('DST spring-forward last-week windows', () => {
    // The week AFTER US spring-forward (Sun 2026-03-08). Mon 2026-03-09.
    const DST_NOW_ISO = '2026-03-09T12:00:00';

    beforeEach(() => {
      vi.setSystemTime(new Date(DST_NOW_ISO));
    });

    it("buckets last-week spend into each widget's original anchor", () => {
      const now = new Date(DST_NOW_ISO);
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      // Reproduce both anchors exactly as the hook does.
      const mpAnchor = subWeeks(weekStart, 1);
      const psAnchor = startOfWeek(new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000), {
        weekStartsOn: 1,
      });

      // A Wednesday inside each anchor's Monday-week — unambiguous mid-window
      // dates that can't flip across local-vs-UTC date-only parsing.
      const mpDate = format(addDays(mpAnchor, 2), 'yyyy-MM-dd');
      const psDate = format(addDays(psAnchor, 2), 'yyyy-MM-dd');

      const diverges = mpDate !== psDate;

      if (diverges) {
        // DST-observing runtime: windows are disjoint. Each transaction lands in
        // exactly one widget's last-week and is invisible to the other.
        setTransactions([
          makeTransaction({ id: 'mp-only', amount: 11, date: mpDate }),
          makeTransaction({ id: 'ps-only', amount: 22, date: psDate }),
        ]);
        const stats = render();
        expect(stats.lastWeekSpend).toBe(11); // MoneyPulse window only
        expect(stats.lastWeekSpendPulse).toBe(22); // PulseStrip window only
        expect(stats.thisWeekSpend).toBe(0);
      } else {
        // Non-DST runtime (e.g. UTC): the anchors coincide, so both fields must
        // agree on the same single last-week window.
        setTransactions([makeTransaction({ id: 'shared', amount: 33, date: mpDate })]);
        const stats = render();
        expect(stats.lastWeekSpend).toBe(33);
        expect(stats.lastWeekSpendPulse).toBe(33);
        expect(stats.thisWeekSpend).toBe(0);
      }
    });
  });
});
