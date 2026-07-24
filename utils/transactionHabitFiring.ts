import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Habit, Transaction } from '@/types/schema';
import { findMatchingHabits } from '@/utils/habitKeywordMatch';
import { isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';
import { attributionString } from '@/utils/habitTriggers';

/**
 * Habit Automations (PRD #1065) — transaction-keyword firing selection.
 *
 * Glue between the pure foundation utils (`habitKeywordMatch`, `habitTriggers`)
 * and the transaction-review surfaces. All pure — no Firestore, no clock, no
 * side effects — so the review-card chip pre-check, the swipe-approve path, and
 * `updateTransactionCategory`'s dedup all agree on exactly which habits fire.
 */

/**
 * The habit ids whose keywords match a transaction's merchant/title or notes —
 * the set pre-checked as "Also logs: …" chips on the review card. Order follows
 * the input `habits` array. Excludes archived habits (an archived habit should
 * never be auto-suggested).
 */
export function keywordMatchedHabitIds(
  habits: Habit[],
  transaction: Pick<Transaction, 'merchant' | 'notes'>,
): string[] {
  return findMatchingHabits(
    habits.filter(h => !h.archivedAt),
    { merchant: transaction.merchant, notes: transaction.notes },
  ).map(h => h.id);
}

/**
 * Given the habit ids a review/approve wants to fire and the ids this
 * transaction has ALREADY fired, return the ids that should fire NOW (the
 * dedup — each transaction fires a given habit at most once) alongside the
 * next persisted fired-ledger (the union). Preserves the order of
 * `requestedHabitIds` and de-duplicates repeats within it.
 */
export function selectHabitsToFire(
  requestedHabitIds: readonly string[],
  alreadyFiredHabitIds: readonly string[],
): { toFire: string[]; nextFired: string[] } {
  const already = new Set(alreadyFiredHabitIds);
  const seen = new Set<string>();
  const toFire: string[] = [];
  for (const id of requestedHabitIds) {
    if (already.has(id) || seen.has(id)) continue;
    seen.add(id);
    toFire.push(id);
  }
  return { toFire, nextFired: [...alreadyFiredHabitIds, ...toFire] };
}

/**
 * How far back a transaction may back-date a habit completion.
 *
 * Matches SAFE_TO_SPEND_OVERDUE_LOOKBACK_MONTHS (~1 month) — the window in
 * which a `needsCategory` row can legitimately still be sitting unreviewed in
 * the Action Queue. Beyond it we record the association but fire nothing:
 * `bankEmailSync` retro-files a bill payment to the bill's DUE date, and a CSV
 * import can carry arbitrarily old rows, so an unbounded window would let one
 * batch silently rewrite weeks of streak and points history.
 */
export const HABIT_BACKDATE_MAX_DAYS = 30;

/**
 * May a transaction dated `fireDate` fire a habit for that date?
 *
 * FUTURE dates are rejected as well as too-old ones. Several streak primitives
 * assume completions are never future-dated (see `calculateWeeklyStreak`'s
 * current/previous-week anchor), so writing one would corrupt the chain rather
 * than merely misdate it.
 *
 * @param fireDate yyyy-MM-dd the transaction is dated
 * @param today    caller-local yyyy-MM-dd
 */
export function isWithinBackdateWindow(fireDate: string, today: string): boolean {
  const daysAgo = differenceInCalendarDays(parseISO(today), parseISO(fireDate));
  return daysAgo >= 0 && daysAgo <= HABIT_BACKDATE_MAX_DAYS;
}

/**
 * Drop the habits that already have a completion in `fireDate`'s period — the
 * cross-source dedup.
 *
 * The problem this solves: you tap "Order from Amazon" by hand on Monday, the
 * overnight sync ingests Monday's Amazon charge, and Tuesday's approval fires
 * the same habit a second time for the same purchase. By then Monday's counter
 * has been reset, so `completedDates` is the ONLY surviving evidence that the
 * day was logged — and it cannot say whether it was logged once or three times.
 * So this is a prior, not a proof: we assume a day already logged for a habit
 * describes the same event, because that is overwhelmingly the common case.
 *
 * Deliberately ADVISORY, and applied at the SELECTION layer rather than in the
 * mutation. The review form uses it to leave the habit un-preselected (ticking
 * it anyway is the override for a genuine second purchase), while the
 * swipe-approve and bulk-approve paths — which have no UI moment to offer an
 * override — apply it as the effective default. A caller that passes an id
 * through anyway gets the fire.
 *
 * Period-scoped, matching `addHabitSubmission`'s `alreadyCompletedInPeriod`
 * guard: for a WEEKLY habit any completion in that ISO week suppresses, not
 * just the exact date.
 */
export function suppressAlreadyLoggedHabitIds(
  habits: Habit[],
  requestedHabitIds: readonly string[],
  fireDate: string,
): string[] {
  return requestedHabitIds.filter(id => {
    const habit = habits.find(h => h.id === id);
    // An unknown id is left alone — the mutation's own lookup drops it.
    if (!habit) return true;
    return !isHabitCompletedInCurrentPeriod(habit, fireDate);
  });
}

/**
 * The attribution string for a transaction-fired habit, e.g.
 * "via transaction: TARGET T-1234". Falls back to a bare label for an
 * empty/absent merchant so the toast/activity tag is never a dangling prefix.
 */
export function transactionAttribution(merchant: string | undefined): string {
  const label = (merchant ?? '').trim() || 'transaction';
  return attributionString({ type: 'transaction', transactionId: '', habitId: '', label }) ?? `via transaction: ${label}`;
}
