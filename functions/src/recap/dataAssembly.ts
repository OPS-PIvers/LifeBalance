import { assembleCeremony, weekPointsTotal, type RecapScoringHabit } from "./memberFacts";
import { WeeklyRecap } from "./types";

/**
 * Mirrors `types/schema.ts`'s `INCOME_CATEGORY` constant. functions/ is a
 * separate pnpm package from the root app (no shared package), so the string
 * literal is duplicated here rather than imported cross-package — keep this in
 * sync if the client's constant ever changes.
 */
const INCOME_CATEGORY = "Income";

/**
 * Mirrors `types/schema.ts`'s `CREDIT_CARD_CATEGORY` — the ACCOUNT-ROUTING
 * sentinel a transaction tagged to a credit account carries instead of a bucket
 * name. It is NOT real spending, and the client's
 * `utils/bucketSpentCalculator.ts` has always excluded it from spend math; the
 * recap did not, so a household's card activity inflated its weekly headline
 * (RECAP-MATH). Duplicated here for the same cross-package reason as
 * `INCOME_CATEGORY` above — keep in sync with the client constant.
 */
const CREDIT_CARD_CATEGORY = "Credit Card";

/**
 * Mirrors `utils/categories.ts`'s `BUDGETED_IN_CALENDAR` + `LEGACY_BILLS_CATEGORY`
 * and the `isCalendarBudgetedCategory` classifier built from them: the sentinel
 * `payCalendarItem` files a paid calendar bill under, plus the legacy `Bills`
 * tag older paid bills still carry. Same cross-package duplication rule.
 */
const CALENDAR_BUDGETED_SET = new Set(["budgeted in calendar", "bills"]);

/** True when a category marks the transaction as an already-budgeted calendar bill. */
function isCalendarBudgetedCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  return CALENDAR_BUDGETED_SET.has(category.toLowerCase());
}

/** Minimal transaction shape this module needs (subset of `types/schema.ts`'s `Transaction`). */
export interface RecapTransaction {
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD, local
  status: "verified" | "pending_review";
}

/**
 * Minimal habit shape this module needs (subset of `types/schema.ts`'s `Habit`).
 *
 * The scoring half (`period`, `basePoints`, `completedBy`, …) is inherited from
 * `RecapScoringHabit` and is entirely OPTIONAL: the money/streak sections below
 * only ever read `title`/`completedDates`/`streakDays`, so a habit carrying
 * none of the ceremony fields assembles exactly as it did before stage 5.
 */
export interface RecapHabit extends RecapScoringHabit {
  streakDays: number;
}

/**
 * Minimal member shape this module needs (subset of `types/schema.ts`'s
 * `HouseholdMember`).
 *
 * 🛡️ NO `points` FIELD, ON PURPOSE. The recap once read
 * `HouseholdMember.points.weekly` as its `pointsByMember` source, which was
 * safe while generation ran Sunday 17:00 — mid-week. Generation now runs MONDAY
 * 07:00, after the client's midnight weekly rollover, so that field describes
 * the brand-new week and structurally cannot describe the week being recapped.
 * Every per-member figure is derived from habit data instead (see
 * `memberFacts.ts`); not loading the stored points is what keeps that
 * enforceable rather than merely intended.
 */
export interface RecapMember {
  uid: string;
  displayName: string;
  /** A login-less managed kid profile — excluded from standings/podium. */
  isManaged?: boolean;
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
  /**
   * The household's budget bucket names, in any casing.
   *
   * Consulted BEFORE `isCalendarBudgetedCategory` when classifying a
   * transaction into the bills/day-to-day spend slices, mirroring the
   * client's `components/budget/BudgetBuckets.tsx` resolution order: a
   * transaction whose category exactly matches a real bucket name belongs to
   * that bucket, and the calendar-budgeted fallback is consulted ONLY when it
   * doesn't. Without this, a household with a bucket literally named "Bills"
   * (or "Budgeted in Calendar") had every one of that bucket's genuinely
   * discretionary transactions reclassified as a paid calendar bill, because
   * `LEGACY_BILLS_CATEGORY` IS the string `"Bills"`.
   *
   * OPTIONAL and defaulted to an empty list, so a caller that hasn't been
   * updated to supply bucket names degrades to the pre-existing (legacy
   * classifier only) behavior rather than throwing.
   */
  bucketNames?: string[];
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
> &
  Required<
    Pick<
      WeeklyRecap,
      | "memberFacts"
      | "dailyPoints"
      | "totalPoints"
      | "priorWeekPoints"
      | "billsSpend"
      | "priorWeekBillsSpend"
      | "dayToDaySpend"
      | "priorWeekDayToDaySpend"
      | "unattributedSplit"
    >
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

/**
 * Does this transaction count as spend at all?
 *
 * TWO sentinels are excluded, not one: `INCOME_CATEGORY` (money in) and
 * `CREDIT_CARD_CATEGORY` (an account-routing tag, not real spending — see its
 * constant above).
 *
 * The two matches are DELIBERATELY asymmetric:
 *  - `CREDIT_CARD_CATEGORY` matches EXACTLY, case-sensitively — mirroring the
 *    client's `utils/bucketSpentCalculator.ts` (the source of truth this
 *    exclusion is supposed to track) precisely. `Credit Card` is a
 *    system-written sentinel a transaction carries INSTEAD OF a bucket name,
 *    but a free-text bucket can legitimately be named "credit card" (no
 *    collision guard against it client-side) and its spend must count
 *    normally, exactly as it does in the Money/Budget tab.
 *  - `INCOME_CATEGORY` stays case-insensitive, matching this function's
 *    pre-existing behavior — that predates the bills/day-to-day split and is
 *    left as-is pending a separate decision, not changed here.
 */
function isCountedSpend(t: RecapTransaction, start: string, end: string): boolean {
  return (
    t.status === "verified" &&
    t.category.toLowerCase() !== INCOME_CATEGORY.toLowerCase() &&
    t.category !== CREDIT_CARD_CATEGORY &&
    t.date >= start &&
    t.date <= end
  );
}

/**
 * Which slice of counted spend a sum covers (RECAP-MATH).
 *
 * `"bills"` and `"dayToDay"` PARTITION `"all"`: every counted transaction is in
 * exactly one of them, so `billsSpend + dayToDaySpend === totalSpend` holds by
 * construction rather than by a subtraction that could absorb drift.
 */
type SpendSlice = "all" | "bills" | "dayToDay";

/**
 * Is this a paid calendar bill rather than day-to-day spending?
 *
 * A real bucket name wins FIRST — matching `BudgetBuckets.tsx`'s own
 * resolution order (a transaction whose category matches a bucket is that
 * bucket's spend, and the calendar-budgeted fallback only fires when it
 * doesn't). Only once the category matches no bucket does this fall back to
 * `isCalendarBudgetedCategory`, which recognises both the `Budgeted in
 * Calendar` sentinel AND the legacy `Bills` tag — the exact tag a household
 * naming a bucket "Bills" would otherwise be shadowed by.
 *
 * `bucketNameSet` is pre-lowercased, matching the case-insensitive bucket
 * lookup the client does.
 */
const inSlice = (t: RecapTransaction, slice: SpendSlice, bucketNameSet: ReadonlySet<string>): boolean => {
  if (slice === "all") return true;
  const isBill = !bucketNameSet.has(t.category.toLowerCase()) && isCalendarBudgetedCategory(t.category);
  return slice === "bills" ? isBill : !isBill;
};

/** Sums counted transaction amounts (in cents) within [start, end], for one slice. */
function sumSpendCents(
  transactions: RecapTransaction[],
  start: string,
  end: string,
  slice: SpendSlice,
  bucketNameSet: ReadonlySet<string>
): number {
  return transactions
    .filter((t) => isCountedSpend(t, start, end) && inSlice(t, slice, bucketNameSet))
    .reduce((sum, t) => sum + toCents(t.amount), 0);
}

/**
 * Sums DAY-TO-DAY counted transaction amounts (in cents) within [start, end],
 * grouped by lowercased category so mixed-casing ("Groceries" vs "groceries")
 * can't split one category into two; the first-seen casing is kept for display.
 *
 * Bills are excluded on purpose: `Budgeted in Calendar` is a routing sentinel,
 * not a category, and it out-swings every real category on any week carrying
 * rent — which made it the recap's #1 "category insight" (RECAP-MATH).
 */
function sumVerifiedSpendByCategoryCents(
  transactions: RecapTransaction[],
  start: string,
  end: string,
  bucketNameSet: ReadonlySet<string>
): Map<string, { display: string; cents: number }> {
  const byCategory = new Map<string, { display: string; cents: number }>();
  for (const t of transactions) {
    if (!isCountedSpend(t, start, end) || !inSlice(t, "dayToDay", bucketNameSet)) continue;
    const key = t.category.toLowerCase();
    const existing = byCategory.get(key);
    if (existing) {
      existing.cents += toCents(t.amount);
    } else {
      byCategory.set(key, { display: t.category, cents: toCents(t.amount) });
    }
  }
  return byCategory;
}

/**
 * Pure assembly of the numeric WeeklyRecap fields from plain arrays. No
 * Firestore access — callers (recap/index.ts) fetch the data and add the
 * narrative/narrativeSource/premium/generatedAt/isoWeek fields.
 */
export function assembleWeeklyRecap(input: DataAssemblyInput): AssembledRecap {
  const { transactions, habits, members, calendarItems, weekStart, weekEnd, bucketNames } = input;

  // Pre-lowercased once so every `inSlice` call does a plain Set lookup — same
  // case-insensitive semantics the client's `BudgetBuckets.tsx` uses for its
  // own bucket-name lookup, and the same lowercasing convention this module
  // already uses for category grouping.
  const bucketNameSet = new Set((bucketNames ?? []).map((name) => name.toLowerCase()));

  const priorWeekStart = addDays(weekStart, -7);
  const priorWeekEnd = addDays(weekEnd, -7);

  const totalSpendCents = sumSpendCents(transactions, weekStart, weekEnd, "all", bucketNameSet);
  const priorWeekSpendCents = sumSpendCents(
    transactions,
    priorWeekStart,
    priorWeekEnd,
    "all",
    bucketNameSet
  );
  const billsSpendCents = sumSpendCents(transactions, weekStart, weekEnd, "bills", bucketNameSet);
  const priorWeekBillsSpendCents = sumSpendCents(
    transactions,
    priorWeekStart,
    priorWeekEnd,
    "bills",
    bucketNameSet
  );
  const dayToDaySpendCents = sumSpendCents(transactions, weekStart, weekEnd, "dayToDay", bucketNameSet);
  const priorWeekDayToDaySpendCents = sumSpendCents(
    transactions,
    priorWeekStart,
    priorWeekEnd,
    "dayToDay",
    bucketNameSet
  );

  const currentByCategory = sumVerifiedSpendByCategoryCents(
    transactions,
    weekStart,
    weekEnd,
    bucketNameSet
  );
  const priorByCategory = sumVerifiedSpendByCategoryCents(
    transactions,
    priorWeekStart,
    priorWeekEnd,
    bucketNameSet
  );

  const allCategories = new Set([...currentByCategory.keys(), ...priorByCategory.keys()]);
  const topCategoryDeltas = Array.from(allCategories)
    .map((key) => {
      const currentEntry = currentByCategory.get(key);
      const priorEntry = priorByCategory.get(key);
      const currentCents = currentEntry?.cents ?? 0;
      const priorCents = priorEntry?.cents ?? 0;
      return {
        category: currentEntry?.display ?? priorEntry?.display ?? key,
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

  // --- Ceremony (per-member points, stage 5) ------------------------------
  // Every per-member figure is DERIVED from habit completions over the closed
  // week — attribution for shared habits plus each member's assigned chores.
  // See memberFacts.ts for why `points.weekly` can no longer be read now that
  // generation runs after the weekly rollover.
  const ceremony = assembleCeremony({ habits, members, weekStart, weekEnd });
  const priorWeekPoints = weekPointsTotal(habits, members, priorWeekStart, priorWeekEnd);

  // ONE source, no fallback: `pointsByMember` is the same derivation the
  // ceremony's facts are, so the two can never disagree. `memberFacts` is empty
  // exactly when no member holds a completion for the week, and this list is
  // then empty too — an honest "nothing per-member to report" rather than a row
  // of zeroes that reads like a real, silent week.
  const pointsByMember = ceremony.memberFacts.map((f) => ({
    memberId: f.memberId,
    name: f.name,
    points: f.points,
  }));

  const billsStart = addDays(weekEnd, 1);
  const billsEnd = addDays(weekEnd, 7);
  const upcomingBills = calendarItems
    .filter((c) => c.type === "expense" && c.date >= billsStart && c.date <= billsEnd)
    .map((c) => ({ title: c.title, amount: c.amount, date: c.date }));

  return {
    totalSpend: toDollars(totalSpendCents),
    priorWeekSpend: toDollars(priorWeekSpendCents),
    billsSpend: toDollars(billsSpendCents),
    priorWeekBillsSpend: toDollars(priorWeekBillsSpendCents),
    dayToDaySpend: toDollars(dayToDaySpendCents),
    priorWeekDayToDaySpend: toDollars(priorWeekDayToDaySpendCents),
    topCategoryDeltas,
    habitCompletions,
    streaksAtRisk,
    pointsByMember,
    upcomingBills,
    memberFacts: ceremony.memberFacts,
    dailyPoints: ceremony.dailyPoints,
    totalPoints: ceremony.totalPoints,
    priorWeekPoints,
    unattributedSplit: ceremony.unattributedSplit,
  };
}
