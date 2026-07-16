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
    expect(stats.monthTotalSpent).toBe(0);
    expect(stats.monthCategoryItems).toEqual([]);
    expect(stats.monthCategoryTransactions).toEqual({});
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

  it('exposes the per-row month transaction lists, keyed by displayed row name', () => {
    setTransactions([
      makeTransaction({ id: 'a1', amount: 100, category: 'A', date: '2026-06-10' }),
      makeTransaction({ id: 'a2', amount: 50, category: 'A', date: '2026-06-16' }),
      makeTransaction({ id: 'b1', amount: 80, category: 'B', date: '2026-06-16' }),
      makeTransaction({ id: 'c1', amount: 60, category: 'C', date: '2026-06-16' }),
      // Rolled into "Others" (beyond top 3).
      makeTransaction({ id: 'd1', amount: 40, category: 'D', date: '2026-06-12' }),
      makeTransaction({ id: 'e1', amount: 20, category: 'E', date: '2026-06-14' }),
      // Outside the month / income / pending — never listed.
      makeTransaction({ id: 'old', amount: 500, category: 'A', date: '2026-05-30' }),
      makeTransaction({ id: 'inc', amount: 1000, category: 'Income', date: '2026-06-16' }),
      makeTransaction({ id: 'pend', amount: 5, category: 'A', date: '2026-06-16', status: 'pending_review' }),
    ]);
    const stats = render();
    expect(stats.monthCategoryItems.map((c) => c.name)).toEqual(['A', 'B', 'C', 'Others']);
    // Sorted date desc within each row.
    expect(stats.monthCategoryTransactions['A']?.map((t) => t.id)).toEqual(['a2', 'a1']);
    expect(stats.monthCategoryTransactions['B']?.map((t) => t.id)).toEqual(['b1']);
    expect(stats.monthCategoryTransactions['C']?.map((t) => t.id)).toEqual(['c1']);
    // "Others" concatenates the rolled-up remainder categories, date desc.
    expect(stats.monthCategoryTransactions['Others']?.map((t) => t.id)).toEqual(['e1', 'd1']);
    expect(Object.keys(stats.monthCategoryTransactions)).toEqual(['A', 'B', 'C', 'Others']);
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

  describe('recent-transaction relative labels (never a future distance)', () => {
    it('uses createdAt for the relative label when present', () => {
      setTransactions([
        makeTransaction({
          id: 'with-created',
          date: '2026-06-15',
          createdAt: '2026-06-15T16:00:00Z', // 20h before frozen now
        }),
      ]);
      const stats = render();
      expect(stats.recentTransactions[0]?.relativeDate).toBe('about 20 hours ago');
    });

    it('never shows a future suffix for a date-only future date — shows the calendar date', () => {
      // Frozen now is 2026-06-16; local midnight of 06-18 parses ahead of now.
      setTransactions([makeTransaction({ id: 'future', date: '2026-06-18' })]);
      const stats = render();
      const label = stats.recentTransactions[0]?.relativeDate;
      expect(label).toBe('Jun 18');
      expect(label).not.toMatch(/^in /);
    });

    it('labels a future-parsing timestamp on the current local day as "Today"', () => {
      setTransactions([
        makeTransaction({
          id: 'later-today',
          date: '2026-06-16',
          createdAt: '2026-06-16T16:00:00Z', // 4h AFTER frozen now (clock skew)
        }),
      ]);
      const stats = render();
      expect(stats.recentTransactions[0]?.relativeDate).toBe('Today');
    });

    it('falls back to a past relative distance for date-only past dates', () => {
      setTransactions([makeTransaction({ id: 'past', date: '2026-06-14' })]);
      const stats = render();
      expect(stats.recentTransactions[0]?.relativeDate).toMatch(/ago$/);
    });
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

  // The hook pre-limits `transactionActivityRows` to the top 5 by the SAME
  // timestamp-desc comparator ActivityFeed uses, so the widget merges ≤5 tx rows
  // with completed to-dos instead of the full history. These tests lock in that
  // the pre-limit is byte-identical to slicing AFTER a full stable sort — the
  // tricky case being ties (same-day rows with no createdAt share an identical
  // midnight timestamp), where stability must preserve input order.
  describe('activity-feed top-5 pre-limit (stable, tie-safe)', () => {
    // ActivityFeed's exact comparator. Kept in sync with the widget + hook.
    const byTimestampDesc = (a: { timestamp: Date }, b: { timestamp: Date }) =>
      b.timestamp.getTime() - a.timestamp.getTime();

    it('returns the first 5 in stable input order when all timestamps tie', () => {
      // 6 transactions, same day, NO createdAt → identical midnight timestamps.
      const txs = Array.from({ length: 6 }, (_, i) =>
        makeTransaction({ id: `t${i}`, merchant: `M${i}`, amount: i + 1, date: '2026-06-16' })
      );
      setTransactions(txs);
      const rows = render().transactionActivityRows;

      // Stable sort over all-tied items preserves input order, so top 5 = first 5.
      expect(rows.map((r) => r.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);

      // Equivalence proof: identical to mapping ALL rows then full-sort + slice(5).
      const allRows = txs.map((tx) => ({
        id: tx.id,
        type: 'transaction' as const,
        title: tx.merchant,
        subtitle: tx.category,
        timestamp: new Date(`${tx.date}T00:00:00`),
        amount: tx.amount,
      }));
      const reference = [...allRows].sort(byTimestampDesc).slice(0, 5);
      expect(rows.map((r) => r.id)).toEqual(reference.map((r) => r.id));
    });

    it('orders mixed createdAt + date-fallback rows identically to a full sort', () => {
      const txs = [
        // Date-fallback (midnight 06-16) — tie group A, in input order.
        makeTransaction({ id: 'a1', amount: 1, date: '2026-06-16' }),
        makeTransaction({ id: 'a2', amount: 2, date: '2026-06-16' }),
        // Newest via createdAt.
        makeTransaction({ id: 'newest', amount: 3, date: '2026-06-16', createdAt: '2026-06-16T23:00:00Z' }),
        // Oldest via createdAt (earlier day).
        makeTransaction({ id: 'oldest', amount: 4, date: '2026-06-10', createdAt: '2026-06-10T06:00:00Z' }),
        // Mid via createdAt.
        makeTransaction({ id: 'mid', amount: 5, date: '2026-06-16', createdAt: '2026-06-16T09:00:00Z' }),
        // Another date-fallback (midnight 06-16) — tie group A continues.
        makeTransaction({ id: 'a3', amount: 6, date: '2026-06-16' }),
      ];
      setTransactions(txs);
      const rows = render().transactionActivityRows;

      // Reference: full map → stable full-sort → slice(5), using the same
      // createdAt||date timestamp rule and the same comparator.
      const allRows = txs.map((tx) => ({
        id: tx.id,
        timestamp: new Date(tx.createdAt ?? `${tx.date}T00:00:00`),
      }));
      const reference = [...allRows].sort(byTimestampDesc).slice(0, 5);
      expect(rows.map((r) => r.id)).toEqual(reference.map((r) => r.id));
      // Sanity: exactly 5 rows survive the pre-limit (6 inputs).
      expect(rows).toHaveLength(5);
    });
  });

  // DST spring-forward: last-week is now unified on the calendar-correct
  // `subWeeks(startOfWeek(now), 1)` window (both MoneyPulse and PulseStrip
  // consume `lastWeekSpend`). This test locks in that, even on the DST
  // spring-forward week, last-week spend buckets into that `subWeeks` window —
  // the CORRECT behavior. It is TZ-adaptive: it derives the anchor with the
  // same date-fns primitive the hook uses, so it's correct on DST-observing
  // runtimes (e.g. America/Chicago) and the UTC CI runner alike.
  describe('DST spring-forward last-week window', () => {
    // The week AFTER US spring-forward (Sun 2026-03-08). Mon 2026-03-09.
    const DST_NOW_ISO = '2026-03-09T12:00:00';

    beforeEach(() => {
      vi.setSystemTime(new Date(DST_NOW_ISO));
    });

    it('buckets last-week spend into the subWeeks(startOfWeek(now), 1) window', () => {
      const now = new Date(DST_NOW_ISO);
      const weekStart = startOfWeek(now, { weekStartsOn: 1 });
      // Reproduce the (single, correct) last-week anchor exactly as the hook does.
      const lastWeekAnchor = subWeeks(weekStart, 1);

      // A Wednesday inside the anchor's Monday-week — an unambiguous mid-window
      // date that can't flip across local-vs-UTC date-only parsing.
      const lastWeekDate = format(addDays(lastWeekAnchor, 2), 'yyyy-MM-dd');

      setTransactions([makeTransaction({ id: 'lw', amount: 33, date: lastWeekDate })]);
      const stats = render();
      expect(stats.lastWeekSpend).toBe(33);
      expect(stats.thisWeekSpend).toBe(0);
    });
  });
});
