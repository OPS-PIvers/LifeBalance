import { formatCurrency } from "../utils/formatCurrency";
import { WeeklyRecap } from "./types";

/**
 * The subset of `WeeklyRecap` a push headline is computed from — kept narrow
 * so the pure function stays easy to unit test without constructing a full
 * document.
 */
export type RecapHeadlineFields = Pick<
  WeeklyRecap,
  "totalSpend" | "priorWeekSpend" | "habitCompletions" | "pointsByMember"
>;

/**
 * Builds a real headline stat for the weekly recap push body (F-NOTIF-09),
 * replacing the old generic "See how your spending, habits, and points
 * stacked up this week." copy. Picks the most compelling available signal, in
 * priority order:
 *   1. A meaningful week-over-week spend swing (saved or spent more) — the
 *      number people care most about opening the app to see.
 *   2. Habit completions logged, when there was no notable spend swing.
 *   3. Total points earned across the household, when there were no habit
 *      completions either.
 *   4. A generic fallback when the week had no activity at all.
 *
 * A swing under $1 is treated as "no meaningful change" so a push doesn't
 * announce "$0.32 more than last week" as if it were news.
 */
export function buildRecapHeadline(recap: RecapHeadlineFields, currency?: string): string {
  const spendDelta = recap.totalSpend - recap.priorWeekSpend;

  if (Math.abs(spendDelta) >= 1) {
    const amount = formatCurrency(Math.abs(spendDelta), { currency, decimals: 0 });
    return spendDelta < 0
      ? `You saved ${amount} more than last week.`
      : `You spent ${amount} more than last week.`;
  }

  if (recap.habitCompletions > 0) {
    const noun = recap.habitCompletions === 1 ? "habit completion" : "habit completions";
    return `${recap.habitCompletions} ${noun} logged this week.`;
  }

  const totalPoints = recap.pointsByMember.reduce((sum, m) => sum + m.points, 0);
  if (totalPoints > 0) {
    const noun = totalPoints === 1 ? "point" : "points";
    return `Your household earned ${totalPoints} ${noun} this week.`;
  }

  return "See how your spending, habits, and points stacked up this week.";
}
