import { findBillsDueOnDate, type BillCalendarItem } from "../shared/bills";

/** Minimal view of a habit doc the briefing reads. */
export interface BriefingHabit {
  period?: string;
  streakDays?: number;
  completedDates?: string[];
}

/** Minimal view of a transaction doc the briefing reads. */
export interface BriefingTransaction {
  status?: string;
}

export interface AssembleDailyBriefingInput {
  /** All calendarItems docs (templates + instances) for the household. */
  calendarItems: BillCalendarItem[];
  /** All transaction docs for the household (only `status` is read). */
  transactions: BriefingTransaction[];
  /** All habit docs for the household. */
  habits: BriefingHabit[];
  /** The member-local "today" as a yyyy-MM-dd string. */
  today: string;
}

/**
 * The pre-aggregated numbers a single member's daily briefing is built from.
 * Deliberately holds no raw merchant/transaction detail — just the counts and
 * totals the narrative (template or AI) is allowed to talk about.
 */
export interface DailyBriefingSummary {
  /** Number of unpaid bills due today (member-local). */
  billsDueCount: number;
  /** Sum of those bills' amounts, in decimal dollars. */
  billsDueTotal: number;
  /** Count of transactions still awaiting review (`status === 'pending_review'`). */
  pendingReviewCount: number;
  /** Total daily habits configured. */
  habitsTotal: number;
  /** Daily habits already completed today. */
  habitsCompleted: number;
  /** Daily habits not yet completed today (`habitsTotal - habitsCompleted`). */
  habitsRemaining: number;
  /** Daily habits with a 3+ day streak not yet completed today. */
  streaksAtRisk: number;
  /**
   * Whether there is anything worth pushing about. When false the scheduled
   * job skips the notification entirely — a "nothing to do" morning ping is
   * noise, so an all-clear day stays silent.
   */
  hasContent: boolean;
}

/**
 * Pure aggregation of one member's daily-briefing inputs into the counts/totals
 * the narrative is built from. `today` must already be resolved in the member's
 * local timezone by the caller (the scheduled job uses `formatInTimeZone`).
 */
export function assembleDailyBriefing(
  input: AssembleDailyBriefingInput
): DailyBriefingSummary {
  const { calendarItems, transactions, habits, today } = input;

  const billsDue = findBillsDueOnDate(calendarItems, today);
  const billsDueCount = billsDue.length;
  const billsDueTotal = billsDue.reduce((sum, b) => sum + (b.amount ?? 0), 0);

  const pendingReviewCount = transactions.filter(
    (t) => t.status === "pending_review"
  ).length;

  const dailyHabits = habits.filter((h) => h.period === "daily");
  const habitsTotal = dailyHabits.length;
  const habitsCompleted = dailyHabits.filter((h) =>
    h.completedDates?.includes(today)
  ).length;
  const habitsRemaining = habitsTotal - habitsCompleted;

  const streaksAtRisk = dailyHabits.filter(
    (h) => (h.streakDays ?? 0) >= 3 && !h.completedDates?.includes(today)
  ).length;

  const hasContent =
    billsDueCount > 0 ||
    pendingReviewCount > 0 ||
    streaksAtRisk > 0 ||
    habitsRemaining > 0;

  return {
    billsDueCount,
    billsDueTotal,
    pendingReviewCount,
    habitsTotal,
    habitsCompleted,
    habitsRemaining,
    streaksAtRisk,
    hasContent,
  };
}
