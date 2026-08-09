/**
 * Server-side twin of `computeBackdatedHabitFire` in utils/habitTriggerFire.ts.
 *
 * MUST stay in lockstep with that function — this is the same duplication the
 * project already accepts for `streakLogic.ts` ↔ `utils/habitLogic.ts` and
 * `habitProcessor.ts` ↔ the client toggle, and for the same reason: a Cloud
 * Function cannot import from the app's `utils/` tree, and points/streaks that
 * disagree between the two paths are corruption, not a cosmetic drift. If you
 * change the scoring rules in one, change both, and update both test tables.
 *
 * Why a BACK-DATED fire and not the ordinary toggle: the nightly `bankEmailSync`
 * runs at ~3am and credits the day that just ENDED, not the day it happens to be
 * running on. `processToggleHabit` hard-codes "today" and has no date parameter,
 * so firing through it would credit the wrong day — exactly the bug PR #1093/4
 * fixed for the transaction-keyword path.
 *
 * Pure: date-fns and `streakLogic` only, no firebase-admin, no Firestore. The
 * caller turns the returned deltas into batch writes (`increment`/`arrayUnion`/
 * `arrayRemove`) — never whole-array writes, per the 2026-07-15 habit-history
 * clobber incident.
 *
 * ONE KNOWN DIVERGENCE from the client, asserted by the parity block in
 * backdatedHabitFire.test.ts rather than left to be discovered:
 *
 *   `isHabitStale` is not the same function in the two trees. The server's
 *   (habitProcessor.ts) takes a caller-local `today` and anchors staleness on
 *   `completedDates`; the client's (utils/habitLogic.ts) takes no `today` and
 *   only ever compares `lastUpdated` against the machine clock. So for a habit
 *   whose stored counter is stale but whose `lastUpdated` is recent, the two
 *   disagree about `resetCount`.
 *
 *   Reconciling them is a much larger change (the client's version is also used
 *   by the toggle, the midnight reset and the points recompute), and it is
 *   UNREACHABLE from the no-spend path regardless: that path always credits
 *   yesterday, which is never the current period for a daily habit, and the
 *   weekend rule only ever credits a Sunday from Monday's email — the previous
 *   ISO week. `resetCount` is `inCurrentPeriod && stale`, so it is always false
 *   here. Anything reusing this twin for a CURRENT-period fire must revisit it.
 */

import { format, parseISO, differenceInCalendarDays, startOfISOWeek } from "date-fns";
import {
  effectiveFrozenDates,
  getMultiplier,
  habitPeriodStart,
  isCompletedInPeriod,
  signedHabitPoints,
  streakEndingOnForPeriod,
  streakForPeriod,
  type HabitPeriod,
} from "./streakLogic";
import { isHabitStale } from "./habitProcessor";

/**
 * Maximum age (in days) of a date a fire may be credited to. Mirrors
 * `HABIT_BACKDATE_MAX_DAYS` in utils/transactionHabitFiring.ts.
 */
export const HABIT_BACKDATE_MAX_DAYS = 30;

/** Mirrors `isWithinBackdateWindow` in utils/transactionHabitFiring.ts. */
export function isWithinBackdateWindow(fireDate: string, today: string): boolean {
  const daysAgo = differenceInCalendarDays(parseISO(today), parseISO(fireDate));
  return daysAgo >= 0 && daysAgo <= HABIT_BACKDATE_MAX_DAYS;
}

/** The habit fields a back-dated fire reads. */
export interface BackdatableHabit {
  id: string;
  type: "positive" | "negative";
  basePoints: number;
  scoringType: "incremental" | "threshold";
  period: HabitPeriod;
  targetCount: number;
  count: number;
  totalCount: number;
  completedDates: string[];
  streakDays: number;
  lastUpdated: string;
  frozenDates?: string[];
  pausedUntil?: string;
  archivedAt?: string;
}

/**
 * Mirrors `BackdatedHabitFireDelta` in utils/habitTriggerFire.ts. Plain data —
 * no Firestore `FieldValue`s.
 */
export interface BackdatedHabitFireDelta {
  /** True when `fireDate` falls in the habit's CURRENT period. */
  inCurrentPeriod: boolean;
  /** Live-counter change, to write as `increment()`. 0 for a past-period fire. */
  countDelta: number;
  /**
   * True only on a current-period stale lazy-reset: write `count` ABSOLUTELY
   * (the stored counter is prior-period garbage the reset discards) and ignore
   * `countDelta`.
   */
  resetCount: boolean;
  /** Absolute live counter — write only when `resetCount` is true. */
  count: number;
  /** Lifetime-counter change, to write as `increment()`. Always 1. */
  totalCountDelta: number;
  /** Date to arrayUnion into `completedDates`, when this fire newly completes it. */
  addedDate?: string;
  /**
   * Date to arrayRemove from `frozenDates` — set when the fire completes a day a
   * freeze token had been spent protecting. The caller must ALSO refund the
   * token, in the same batch.
   */
  unfrozenDate?: string;
  /** Recomputed period-aware streak for the habit doc. */
  streakDays: number;
  /** Signed points this fire credits (may be 0). Stored on the submission doc. */
  pointsEarned: number;
  /** `pointsEarned` split by bucket — see the DATE gating below. */
  pointsDelta: { daily: number; weekly: number; total: number };
  /** The multiplier that produced `pointsEarned` (1.0 / 2.0 / 3.0). */
  multiplier: number;
  /** Streak ending on `fireDate`, snapshotted onto the submission doc. */
  streakAtFireDate: number;
}

/**
 * Compute the delta for firing `habit` on `fireDate` — a date that is NOT
 * necessarily today.
 *
 * @param habit    The habit to fire
 * @param fireDate yyyy-MM-dd the completion belongs to
 * @param today    caller-local yyyy-MM-dd (the household's local date, not the
 *                 function's UTC date — Cloud Functions run in UTC and an
 *                 off-by-one "today" here misdates the whole fire)
 * @param priorPeriodCount Units ALREADY recorded for `fireDate`'s period when
 *   that period is in the past — the sum of its stored submissions, since the
 *   live counter says nothing about a past day/week. Ignored for a
 *   current-period fire and for incremental habits, so callers may pass 0 there.
 * @returns the delta, or `null` when the fire is a no-op: an archived habit, or
 *   a date outside the back-date window (re-checked here as defense in depth —
 *   a FUTURE completion would corrupt the streak chain, not merely misdate it).
 *
 * ⚠️ DELIBERATE DIVERGENCE FROM THE CLIENT TWIN (utils/habitTriggerFire.ts).
 * The client version takes an optional acting `memberId` + freeze mode and, under
 * `Household.freezeMode: 'per_member'`, un-freezes `Habit.frozenDatesBy[date]`
 * for that uid, refunds that member's own bank, and bridges their personal
 * frozen dates into the multiplier. This one deliberately does NOT: its trigger
 * is the no-spend-day evaluation, which has no acting user at all — nobody
 * "did" it, so there is no member whose token could be the one to refund, and
 * guessing one would debit/credit a bank at random. It therefore stays
 * per-member-blind and reads only the shared `frozenDates`. Under
 * `'per_member'` that means a server-side no-spend fire neither un-freezes nor
 * refunds; the day is still credited and the household flame still updates.
 * If this ever needs to become per-member aware, the trigger has to carry an
 * intended member first — do not copy the client's `createdByUid` heuristic
 * here, because there isn't one.
 */
export function computeBackdatedHabitFire(
  habit: BackdatableHabit,
  fireDate: string,
  today: string,
  priorPeriodCount = 0
): BackdatedHabitFireDelta | null {
  if (habit.archivedAt) return null;
  if (!isWithinBackdateWindow(fireDate, today)) return null;

  const inCurrentPeriod =
    habitPeriodStart(habit.period, fireDate) === habitPeriodStart(habit.period, today);

  // Lazy-reset parity with the toggle path: a stale habit's counter belongs to a
  // previous period, so its live period counter is effectively 0.
  const stale = isHabitStale(habit, today);
  const liveCount = stale ? 0 : habit.count;

  // A past-period fire must leave the live counter completely alone — it
  // describes a LATER period than the one being credited.
  const basePeriodCount = inCurrentPeriod ? liveCount : priorPeriodCount;
  const newPeriodCount = basePeriodCount + 1;

  // Threshold habits only mark the date complete once the fire's OWN period
  // reaches the target, preserving the invariant "date in completedDates ⟹
  // target met that period". Incremental habits complete on any action.
  const marksDateComplete =
    habit.scoringType === "incremental" || newPeriodCount >= habit.targetCount;
  const dateNewlyCompleted = marksDateComplete && !habit.completedDates.includes(fireDate);

  const nextCompletedDates = dateNewlyCompleted
    ? [...habit.completedDates, fireDate].sort((a, b) => (a < b ? 1 : -1))
    : habit.completedDates;

  // A day that turns out to have been completed must not stay frozen: the
  // schema's invariant is that a frozen date NEVER appears in completedDates,
  // and the token it cost was spent protecting a miss that didn't happen.
  const unfrozenDate =
    dateNewlyCompleted && (habit.frozenDates ?? []).includes(fireDate) ? fireDate : undefined;
  const nextFrozenDates = (habit.frozenDates ?? []).filter((d) => d !== unfrozenDate);

  const bridged = effectiveFrozenDates(
    {
      completedDates: nextCompletedDates,
      frozenDates: nextFrozenDates,
      ...(habit.pausedUntil !== undefined ? { pausedUntil: habit.pausedUntil } : {}),
    },
    today
  );

  // Multiplier from the streak ending ON fireDate — never the habit's CURRENT
  // streak, which would retro-apply today's multiplier to a past day.
  const streakAtFireDate = streakEndingOnForPeriod(
    nextCompletedDates,
    habit.period,
    fireDate,
    bridged
  );
  const multiplier = getMultiplier(streakAtFireDate, habit.type === "positive", habit.period);

  // Incremental scores every action; threshold scores only the unit that pushes
  // its own period over the target, and never when that period was already
  // credited (a period completed via the toggle path leaves no submissions
  // behind, so completedDates is the guard).
  let pointsEarned = 0;
  if (habit.scoringType === "incremental") {
    pointsEarned = signedHabitPoints(habit, multiplier);
  } else if (
    newPeriodCount >= habit.targetCount &&
    basePeriodCount < habit.targetCount &&
    !isCompletedInPeriod(habit.completedDates, habit.period, fireDate)
  ) {
    pointsEarned = signedHabitPoints(habit, multiplier);
  }

  // Bucket gating by DATE: `total` is lifetime so it always absorbs the points;
  // `daily` only when the fire lands on today; `weekly` only when it lands in
  // the current Monday-anchored week. Without this a Sunday fire processed on
  // Monday would inflate Monday's daily total and this week's weekly total.
  const weekStart = format(startOfISOWeek(parseISO(today)), "yyyy-MM-dd");
  const pointsDelta = {
    daily: fireDate === today ? pointsEarned : 0,
    weekly: fireDate >= weekStart && fireDate <= today ? pointsEarned : 0,
    total: pointsEarned,
  };

  return {
    inCurrentPeriod,
    countDelta: inCurrentPeriod ? 1 : 0,
    resetCount: inCurrentPeriod && stale,
    count: liveCount + 1,
    totalCountDelta: 1,
    ...(dateNewlyCompleted ? { addedDate: fireDate } : {}),
    ...(unfrozenDate !== undefined ? { unfrozenDate } : {}),
    streakDays: streakForPeriod(nextCompletedDates, habit.period, today, bridged),
    pointsEarned,
    pointsDelta,
    multiplier,
    streakAtFireDate,
  };
}
