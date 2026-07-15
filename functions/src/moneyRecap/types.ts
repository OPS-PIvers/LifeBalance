/**
 * The monthly money recap document shape, written to
 * `households/{householdId}/moneyRecaps/{month}` by the `sendmonthlymoneyrecap`
 * scheduled function (F-MONEY-06).
 *
 * Money fields (`totalIncome`, `totalSpend`, `priorMonthSpend`,
 * `bucketResults[].limit`/`.spent`/`.overUnder`, `topExpense.amount`,
 * `netWorthDelta`) are DECIMAL DOLLARS, per house convention (sums done in
 * integer cents internally but the values stored are decimal dollars, matching
 * `Transaction.amount` / `Account.balance`). Mirrors `types/schema.ts`'s
 * `MonthlyMoneyRecap` — keep the two in sync.
 */
export interface MonthlyMoneyRecap {
  /** Calendar month identifier, e.g. "2026-06" (also the document id). */
  month: string;
  /** ISO 8601 timestamp of when this recap was generated. */
  generatedAt: string;

  /** Total verified income for the recap month (decimal dollars). */
  totalIncome: number;
  /** Total verified, non-income spend for the recap month (decimal dollars). */
  totalSpend: number;
  /** Total verified, non-income spend for the prior month (decimal dollars). */
  priorMonthSpend: number;

  /** Per-bucket over/under close-out, grouped from BucketPeriodSnapshot docs. */
  bucketResults: Array<{
    bucketId: string;
    bucketName: string;
    limit: number;
    spent: number;
    overUnder: number;
  }>;

  /** The single biggest verified, non-income expense of the month (or null). */
  topExpense: { merchant: string; amount: number; category: string; date: string } | null;

  /** Change in net worth over the month (decimal dollars), or null when Net
   *  Worth History snapshots are unavailable. */
  netWorthDelta: number | null;

  /** 2-3 sentence warm summary, either AI-generated or a deterministic template. */
  narrative: string;
  narrativeSource: "ai" | "template";

  /** Whether this household saw the premium experience (AI narrative + push). */
  premium: boolean;
}
