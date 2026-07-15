import { MonthlyMoneyRecap } from "./types";

/**
 * Mirrors `types/schema.ts`'s `INCOME_CATEGORY` constant. functions/ is a
 * separate pnpm package from the root app (no shared package), so the string
 * literal is duplicated here — keep in sync if the client's constant changes.
 */
const INCOME_CATEGORY = "Income";

/** Minimal transaction shape this module needs (subset of `Transaction`). */
export interface RecapTransaction {
  amount: number;
  merchant: string;
  category: string;
  date: string; // YYYY-MM-DD, local
  status: "verified" | "pending_review";
}

/** Minimal bucket-period-snapshot shape (subset of `BucketPeriodSnapshot`). */
export interface RecapBucketSnapshot {
  bucketId: string;
  bucketName: string;
  limit: number;
  totalSpent: number;
  /** Period end date (YYYY-MM-DD) — used to assign the snapshot to a month. */
  periodEndDate: string;
}

export interface MoneyDataAssemblyInput {
  /** Transactions covering (at least) the recap month and the prior month. */
  transactions: RecapTransaction[];
  /** Bucket period snapshots whose periods closed within the recap month. */
  bucketSnapshots: RecapBucketSnapshot[];
  /** The recap month as "yyyy-MM". */
  month: string;
  /** Inclusive first day of the recap month (yyyy-MM-dd). */
  monthStart: string;
  /** Inclusive last day of the recap month (yyyy-MM-dd). */
  monthEnd: string;
  /** Inclusive first day of the prior month (yyyy-MM-dd). */
  priorMonthStart: string;
  /** Inclusive last day of the prior month (yyyy-MM-dd). */
  priorMonthEnd: string;
  /** Change in net worth over the month (decimal dollars), or null. */
  netWorthDelta: number | null;
}

export type AssembledMoneyRecap = Pick<
  MonthlyMoneyRecap,
  | "totalIncome"
  | "totalSpend"
  | "priorMonthSpend"
  | "bucketResults"
  | "topExpense"
  | "netWorthDelta"
>;

/** Converts decimal dollars to integer cents, rounding to the nearest cent. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Converts integer cents back to decimal dollars. */
function toDollars(cents: number): number {
  return cents / 100;
}

function isIncome(t: RecapTransaction): boolean {
  return t.category.toLowerCase() === INCOME_CATEGORY.toLowerCase();
}

function inRange(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

/** Sums verified, non-income spend (cents) within [start, end] inclusive. */
function sumSpendCents(transactions: RecapTransaction[], start: string, end: string): number {
  return transactions
    .filter((t) => t.status === "verified" && !isIncome(t) && inRange(t.date, start, end))
    .reduce((sum, t) => sum + toCents(t.amount), 0);
}

/** Sums verified income (cents) within [start, end] inclusive. */
function sumIncomeCents(transactions: RecapTransaction[], start: string, end: string): number {
  return transactions
    .filter((t) => t.status === "verified" && isIncome(t) && inRange(t.date, start, end))
    .reduce((sum, t) => sum + toCents(t.amount), 0);
}

/**
 * Pure assembly of the numeric MonthlyMoneyRecap fields from plain arrays. No
 * Firestore access — callers (moneyRecap/index.ts) fetch the data and add the
 * narrative/narrativeSource/premium/generatedAt/month fields.
 */
export function assembleMonthlyMoneyRecap(input: MoneyDataAssemblyInput): AssembledMoneyRecap {
  const {
    transactions,
    bucketSnapshots,
    monthStart,
    monthEnd,
    priorMonthStart,
    priorMonthEnd,
    netWorthDelta,
  } = input;

  const totalIncome = toDollars(sumIncomeCents(transactions, monthStart, monthEnd));
  const totalSpend = toDollars(sumSpendCents(transactions, monthStart, monthEnd));
  const priorMonthSpend = toDollars(sumSpendCents(transactions, priorMonthStart, priorMonthEnd));

  // Per-bucket close-out: group the month's snapshots by bucketId, summing
  // limit and spent across every period that closed in the month (a month can
  // contain more than one pay period). overUnder = spent - limit in cents, so
  // rounding is applied once at the dollar boundary.
  const byBucket = new Map<string, { bucketName: string; limitCents: number; spentCents: number }>();
  for (const s of bucketSnapshots) {
    const existing = byBucket.get(s.bucketId);
    if (existing) {
      existing.limitCents += toCents(s.limit);
      existing.spentCents += toCents(s.totalSpent);
    } else {
      byBucket.set(s.bucketId, {
        bucketName: s.bucketName,
        limitCents: toCents(s.limit),
        spentCents: toCents(s.totalSpent),
      });
    }
  }

  const bucketResults = Array.from(byBucket.entries())
    .map(([bucketId, v]) => ({
      bucketId,
      bucketName: v.bucketName,
      limit: toDollars(v.limitCents),
      spent: toDollars(v.spentCents),
      overUnder: toDollars(v.spentCents - v.limitCents),
    }))
    // Biggest over-budget first, so the most actionable rows lead.
    .sort((a, b) => b.overUnder - a.overUnder);

  // Biggest single verified, non-income expense of the month.
  const monthExpenses = transactions.filter(
    (t) => t.status === "verified" && !isIncome(t) && inRange(t.date, monthStart, monthEnd)
  );
  let topExpense: AssembledMoneyRecap["topExpense"] = null;
  for (const t of monthExpenses) {
    if (topExpense === null || t.amount > topExpense.amount) {
      topExpense = {
        merchant: t.merchant,
        amount: t.amount,
        category: t.category,
        date: t.date,
      };
    }
  }

  return {
    totalIncome,
    totalSpend,
    priorMonthSpend,
    bucketResults,
    topExpense,
    netWorthDelta,
  };
}
