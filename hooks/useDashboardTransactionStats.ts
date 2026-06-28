import { useMemo } from 'react';
import {
  startOfWeek,
  subWeeks,
  isSameWeek,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  parseISO,
  formatDistanceToNow,
} from 'date-fns';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { INCOME_CATEGORY, type Transaction } from '@/types/schema';
import { roundMoney, sumMoney } from '@/utils/money';

/**
 * useDashboardTransactionStats — ONE memoized pass over `transactions` feeding
 * every transaction-derived Dashboard widget.
 *
 * Previously four widgets (MoneyPulse, CategorySpend, PulseStrip, ActivityFeed)
 * each ran their own O(n) `useMemo` over the full transactions array, so a single
 * transaction change triggered ~4 redundant passes. This hook does the
 * derivation once and hands each widget its slice — **byte-identical** to what
 * each widget computed before (same windows, filters, signs, rounding, sort,
 * limit). It is purely a performance consolidation; no business logic changes.
 *
 * Money math stays in the FROZEN `utils/money.ts` helpers (integer cents). Week
 * and month windows use the same `date-fns` Monday-anchored week / calendar
 * month the widgets used. "Income" exclusion uses the shared `INCOME_CATEGORY`
 * constant (the widgets previously hard-coded the literal `'Income'`, which is
 * exactly this value). The `pending_review` exclusion is preserved verbatim —
 * `Transaction.status` is only `'verified' | 'pending_review'`, so the widgets'
 * `!== 'pending_review'` / `=== 'pending_review'` / `=== 'verified'` predicates
 * are all equivalent; we keep the cleared (non-`pending_review`) set.
 *
 * THIS-WEEK spend is shared (MoneyPulse and PulseStrip used the identical
 * `startOfWeek(now)` window). LAST-WEEK spend, however, is computed TWICE — once
 * per each widget's ORIGINAL anchor — because the two definitions differ on the
 * DST spring-forward week (~1/year):
 *   - MoneyPulse:  `subWeeks(startOfWeek(now), 1)` → `lastWeekSpend`
 *   - PulseStrip:  `startOfWeek(weekStart - 7*24h)` → `lastWeekSpendPulse`
 * Subtracting a raw 7×24h across the DST gap lands an hour early, which
 * `startOfWeek` can snap to the prior Monday — so on that one week the windows
 * (and PulseStrip's trend %) diverge. This is a PRE-EXISTING inconsistency,
 * intentionally PRESERVED here (not fixed) so this refactor stays strictly
 * behavior-preserving. Known follow-up: unify on `subWeeks` once a behavior
 * change is acceptable.
 */

/** A recent transaction with a precomputed relative-time label (MoneyPulse). */
export interface RecentTransaction extends Transaction {
  relativeDate: string;
}

/** One category's current-month spend slice (CategorySpend display row). */
export interface CategorySpendItem {
  name: string;
  amount: number;
  percentage: number;
}

/**
 * A verified, non-income transaction mapped into ActivityFeed's row shape. The
 * widget still merges these with completed to-dos and applies the final
 * sort+slice (the sort interleaves both sources, so it must stay in the widget).
 */
export interface TransactionActivityRow {
  id: string;
  type: 'transaction';
  title: string;
  subtitle: string;
  timestamp: Date;
  amount: number;
}

export interface DashboardTransactionStats {
  /** Cleared, non-income spend in the current Monday-week (rounded dollars). */
  thisWeekSpend: number;
  /**
   * Cleared, non-income spend in the prior Monday-week, anchored MoneyPulse-style
   * via `subWeeks(startOfWeek(now), 1)` (rounded dollars). Consumed by MoneyPulse.
   */
  lastWeekSpend: number;
  /**
   * Same as {@link lastWeekSpend} EXCEPT anchored PulseStrip-style via
   * `startOfWeek(weekStart - 7*24h)`. Identical to `lastWeekSpend` every week
   * except the DST spring-forward week — see the hook docstring. Consumed by
   * PulseStrip to preserve its exact original behavior.
   */
  lastWeekSpendPulse: number;
  /** Top categories (top 3 + "Others") of current-month cleared, non-income spend. */
  monthCategoryItems: CategorySpendItem[];
  /** Total current-month cleared, non-income spend (rounded dollars). */
  monthTotalSpent: number;
  /** Most-recent 3 cleared, non-income transactions, sorted by `date` desc. */
  recentTransactions: RecentTransaction[];
  /** All verified, non-income transactions mapped to ActivityFeed rows (unsorted). */
  transactionActivityRows: TransactionActivityRow[];
}

/**
 * Single-pass dashboard transaction stats. Reads `useFinance().transactions`
 * itself (matching how the widgets obtain data) and memoizes on
 * `[transactions]`. The widgets remain responsible for their own non-transaction
 * logic (PulseStrip's habits/points, ActivityFeed's to-do merge and module
 * gating, etc.) and for window-relative formatting they already owned.
 */
export const useDashboardTransactionStats = (): DashboardTransactionStats => {
  const { transactions } = useFinance();

  return useMemo<DashboardTransactionStats>(() => {
    const now = new Date();
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    // MoneyPulse's last-week anchor (calendar-correct across DST).
    const lastWeekStart = subWeeks(currentWeekStart, 1);
    // PulseStrip's ORIGINAL last-week anchor (raw 7×24h subtraction). Differs
    // from `lastWeekStart` only on the DST spring-forward week — preserved
    // verbatim, NOT fixed, so the refactor is behavior-preserving (see docstring).
    const lastWeekStartPulse = startOfWeek(
      new Date(currentWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
      { weekStartsOn: 1 }
    );
    const monthStart = startOfMonth(now);
    const monthEnd = endOfMonth(now);

    // Week spend accumulated in integer cents (matches PulseStrip's sumMoney and,
    // for cent-valued money inputs, MoneyPulse's roundMoney(float-sum) exactly).
    let thisWeekCents = 0;
    let lastWeekCents = 0; // MoneyPulse window
    let lastWeekCentsPulse = 0; // PulseStrip window (DST-divergent)

    // Current-month category breakdown, accumulated in integer cents per key.
    const monthCents: Record<string, number> = {};
    let monthTotalCents = 0;

    // The cleared, non-income transactions (MoneyPulse's recent-list source).
    const cleared: Transaction[] = [];

    // ActivityFeed's transaction rows (verified, non-income), mapped in pass.
    const transactionActivityRows: TransactionActivityRow[] = [];

    for (const t of transactions) {
      const isIncome = t.category === INCOME_CATEGORY;
      // `verified` is the only non-`pending_review` status, so this single guard
      // reproduces every widget's status predicate.
      const isCleared = t.status !== 'pending_review';

      if (isIncome || !isCleared) continue;

      cleared.push(t);

      // ActivityFeed row (it filtered on `status === 'verified'`, identical here).
      transactionActivityRows.push({
        id: t.id,
        type: 'transaction',
        title: t.merchant,
        subtitle: t.category,
        timestamp: parseISO(t.createdAt || t.date),
        amount: t.amount,
      });

      const date = parseISO(t.date);
      const amountCents = Math.round(t.amount * 100);

      // Week buckets (Monday-anchored). This-week is shared. Each widget's
      // last-week is evaluated against its OWN anchor, each preserving the
      // original `if thisWeek … else if lastWeek` structure independently.
      const inThisWeek = isSameWeek(date, now, { weekStartsOn: 1 });
      if (inThisWeek) {
        thisWeekCents += amountCents;
      } else {
        // MoneyPulse window.
        if (isSameWeek(date, lastWeekStart, { weekStartsOn: 1 })) {
          lastWeekCents += amountCents;
        }
        // PulseStrip window (identical except on the DST spring-forward week).
        if (isSameWeek(date, lastWeekStartPulse, { weekStartsOn: 1 })) {
          lastWeekCentsPulse += amountCents;
        }
      }

      // Current-month category breakdown (inclusive interval), matching CategorySpend.
      if (isWithinInterval(date, { start: monthStart, end: monthEnd })) {
        const cat = t.category || 'Uncategorized';
        monthCents[cat] = (monthCents[cat] ?? 0) + amountCents;
        monthTotalCents += amountCents;
      }
    }

    const thisWeekSpend = thisWeekCents / 100;
    const lastWeekSpend = lastWeekCents / 100;
    const lastWeekSpendPulse = lastWeekCentsPulse / 100;
    const monthTotalSpent = monthTotalCents / 100;

    // CategorySpend: round each category, sort desc, top 3 + "Others".
    const sorted = Object.entries(monthCents)
      .map(([name, cents]) => {
        const amount = roundMoney(cents / 100);
        return {
          name,
          amount,
          percentage: monthTotalSpent > 0 ? (amount / monthTotalSpent) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    const top3 = sorted.slice(0, 3);
    const rest = sorted.slice(3);
    const othersAmount = sumMoney(rest.map((item) => item.amount));
    const othersPercentage = rest.reduce((sum, item) => sum + item.percentage, 0);

    const monthCategoryItems: CategorySpendItem[] = [...top3];
    if (othersAmount > 0) {
      monthCategoryItems.push({
        name: 'Others',
        amount: othersAmount,
        percentage: othersPercentage,
      });
    }

    // MoneyPulse recent list: sort cleared by `date` string desc, top 3, label.
    const recentTransactions: RecentTransaction[] = [...cleared]
      .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
      .slice(0, 3)
      .map((tx) => ({
        ...tx,
        relativeDate: formatDistanceToNow(parseISO(tx.date), { addSuffix: true }),
      }));

    return {
      thisWeekSpend,
      lastWeekSpend,
      lastWeekSpendPulse,
      monthCategoryItems,
      monthTotalSpent: roundMoney(monthTotalSpent),
      recentTransactions,
      transactionActivityRows,
    };
  }, [transactions]);
};
