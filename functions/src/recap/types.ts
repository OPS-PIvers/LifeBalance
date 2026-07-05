/**
 * The weekly recap document shape, written to
 * `households/{householdId}/recaps/{isoWeek}` by the `sendweeklyrecap`
 * scheduled function.
 *
 * Money fields (`totalSpend`, `priorWeekSpend`, `topCategoryDeltas[].current`/
 * `.prior`, `upcomingBills[].amount`) are DECIMAL DOLLARS, per house convention
 * (see CLAUDE.md: sums are done in integer cents internally but the values
 * stored/returned are decimal dollars, matching `Transaction.amount` /
 * `Account.balance`).
 */
export interface WeeklyRecap {
  /** ISO week identifier, e.g. "2026-W27" (also the document id). */
  isoWeek: string;
  /** ISO 8601 timestamp of when this recap was generated. */
  generatedAt: string;

  /** Total verified, non-income spend for the recap week (decimal dollars). */
  totalSpend: number;
  /** Total verified, non-income spend for the prior week (decimal dollars). */
  priorWeekSpend: number;
  /** Up to 3 categories with the largest week-over-week spend swing. */
  topCategoryDeltas: Array<{ category: string; current: number; prior: number }>;

  /** Count of habit completions logged during the recap week. */
  habitCompletions: number;
  /** Habits with a streak of 3+ that did NOT complete on the week's last day. */
  streaksAtRisk: Array<{ habitTitle: string; streakDays: number }>;

  /** Points earned per household member during the recap week. */
  pointsByMember: Array<{ memberId: string; name: string; points: number }>;

  /** Expense calendar items due in the 7 days following the recap week. */
  upcomingBills: Array<{ title: string; amount: number; date: string }>;

  /** 2-sentence warm summary, either AI-generated or a deterministic template. */
  narrative: string;
  narrativeSource: "ai" | "template";

  /** Whether this household saw the premium experience (AI narrative + push). */
  premium: boolean;
}
