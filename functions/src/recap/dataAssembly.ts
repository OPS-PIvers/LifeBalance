import { WeeklyRecap } from "./types";

/**
 * Mirrors `types/schema.ts`'s `INCOME_CATEGORY` constant. functions/ is a
 * separate pnpm package from the root app (no shared package), so the string
 * literal is duplicated here rather than imported cross-package — keep this in
 * sync if the client's constant ever changes.
 */
const INCOME_CATEGORY = "Income";

/** Minimal transaction shape this module needs (subset of `types/schema.ts`'s `Transaction`). */
export interface RecapTransaction {
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD, local
  status: "verified" | "pending_review";
}

/** Minimal habit shape this module needs (subset of `types/schema.ts`'s `Habit`). */
export interface RecapHabit {
  title: string;
  completedDates: string[]; // YYYY-MM-DD
  streakDays: number;
}

/** Minimal member shape this module needs (subset of `types/schema.ts`'s `HouseholdMember`). */
export interface RecapMember {
  uid: string;
  displayName: string;
  points: { daily: number; weekly: number; total: number };
}

/** Minimal calendar item shape this module needs (subset of `types/schema.ts`'s `CalendarItem`). */
export interface RecapCalendarItem {
  title: string;
  amount: number;
  date: string; // YYYY-MM-DD
  type: "income" | "expense";
}

export interface DataAssemblyInput {
  /** All transactions covering at least the two weeks ending at `weekEnd`. */
  transactions: RecapTransaction[];
  habits: RecapHabit[];
  members: RecapMember[];
  /** Calendar items covering (at least) the 7 days following `weekEnd`. */
  calendarItems: RecapCalendarItem[];
  /** yyyy-MM-dd, local — the first day of the recap week (a Monday, inclusive). */
  weekStart: string;
  /** yyyy-MM-dd, local — the last day of the recap week (a Sunday, inclusive). */
  weekEnd: string;
}

export type AssembledRecap = Pick<
  WeeklyRecap,
  | "totalSpend"
  | "priorWeekSpend"
  | "topCategoryDeltas"
  | "habitCompletions"
  | "streaksAtRisk"
  | "pointsByMember"
  | "upcomingBills"
>;

/** Converts decimal dollars to integer cents, rounding to the nearest cent. */
function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Converts integer cents back to decimal dollars. */
function toDollars(cents: number): number {
  return cents / 100;
}

/** Adds one day to a yyyy-MM-dd local date string, returning a new yyyy-MM-dd string. */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Sums verified, non-income transaction amounts (in cents) within [start, end] inclusive. */
function sumVerifiedSpendCents(
  transactions: RecapTransaction[],
  start: string,
  end: string
): number {
  return transactions
    .filter(
      (t) =>
        t.status === "verified" &&
        t.category !== INCOME_CATEGORY &&
        t.date >= start &&
        t.date <= end
    )
    .reduce((sum, t) => sum + toCents(t.amount), 0);
}

/** Sums verified, non-income transaction amounts (in cents) within [start, end], grouped by category. */
function sumVerifiedSpendByCategoryCents(
  transactions: RecapTransaction[],
  start: string,
  end: string
): Map<string, number> {
  const byCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.status !== "verified" || t.category === INCOME_CATEGORY) continue;
    if (t.date < start || t.date > end) continue;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + toCents(t.amount));
  }
  return byCategory;
}

/**
 * Pure assembly of the numeric WeeklyRecap fields from plain arrays. No
 * Firestore access — callers (recap/index.ts) fetch the data and add the
 * narrative/narrativeSource/premium/generatedAt/isoWeek fields.
 */
export function assembleWeeklyRecap(input: DataAssemblyInput): AssembledRecap {
  const { transactions, habits, members, calendarItems, weekStart, weekEnd } = input;

  const priorWeekStart = addDays(weekStart, -7);
  const priorWeekEnd = addDays(weekEnd, -7);

  const totalSpendCents = sumVerifiedSpendCents(transactions, weekStart, weekEnd);
  const priorWeekSpendCents = sumVerifiedSpendCents(transactions, priorWeekStart, priorWeekEnd);

  const currentByCategory = sumVerifiedSpendByCategoryCents(transactions, weekStart, weekEnd);
  const priorByCategory = sumVerifiedSpendByCategoryCents(transactions, priorWeekStart, priorWeekEnd);

  const allCategories = new Set([...currentByCategory.keys(), ...priorByCategory.keys()]);
  const topCategoryDeltas = Array.from(allCategories)
    .map((category) => {
      const currentCents = currentByCategory.get(category) ?? 0;
      const priorCents = priorByCategory.get(category) ?? 0;
      return {
        category,
        current: toDollars(currentCents),
        prior: toDollars(priorCents),
        absDeltaCents: Math.abs(currentCents - priorCents),
      };
    })
    .filter((d) => d.absDeltaCents > 0)
    .sort((a, b) => b.absDeltaCents - a.absDeltaCents)
    .slice(0, 3)
    .map(({ category, current, prior }) => ({ category, current, prior }));

  const habitCompletions = habits.reduce(
    (sum, h) => sum + h.completedDates.filter((d) => d >= weekStart && d <= weekEnd).length,
    0
  );

  const streaksAtRisk = habits
    .filter((h) => h.streakDays >= 3 && !h.completedDates.includes(weekEnd))
    .map((h) => ({ habitTitle: h.title, streakDays: h.streakDays }));

  const pointsByMember = members.map((m) => ({
    memberId: m.uid,
    name: m.displayName,
    points: m.points.weekly,
  }));

  const billsStart = addDays(weekEnd, 1);
  const billsEnd = addDays(weekEnd, 7);
  const upcomingBills = calendarItems
    .filter((c) => c.type === "expense" && c.date >= billsStart && c.date <= billsEnd)
    .map((c) => ({ title: c.title, amount: c.amount, date: c.date }));

  return {
    totalSpend: toDollars(totalSpendCents),
    priorWeekSpend: toDollars(priorWeekSpendCents),
    topCategoryDeltas,
    habitCompletions,
    streaksAtRisk,
    pointsByMember,
    upcomingBills,
  };
}
