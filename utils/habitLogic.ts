import { Habit, HouseholdMember } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  format,
  subDays,
  parseISO,
  isSameDay,
  isSameWeek,
  isValid,
  startOfISOWeek,
  startOfWeek,
  subWeeks,
} from 'date-fns';

/** Convenience alias so callers don't need to import the schema type directly. */
type HabitPeriod = Habit['period'];

/**
 * Normalizes a habit title into the denormalized `Habit.titleLower` field:
 * lowercased and trimmed. Written by the client's `addHabit`/`updateHabit`
 * (hooks/useHabitActions.tsx) so `functions/src/quickAdd/index.ts`'s
 * quickAddHabit endpoint can do an indexed `where('titleLower', '==', ...)`
 * exact-match lookup instead of a full-collection scan for every request.
 * Duplicated (not shared) in functions/src/quickAdd/habitProcessor.ts —
 * Cloud Functions is a separate package with no cross-package import path;
 * change both together.
 */
export const normalizeHabitTitle = (title: string): string => title.toLowerCase().trim();

/**
 * The sign of a habit's points — the SINGLE source of truth is `habit.type`,
 * never the sign of `basePoints`. Two creation paths historically stored
 * negative habits with opposite basePoints conventions (HabitCreatorWizard
 * writes `-2`, HabitFormModal writes `2` with `type: 'negative'`), so any
 * logic that reads `basePoints` raw double-negates one convention or awards
 * points for the other. Always pair `habitSign` with `habitPointsMagnitude`.
 */
export const habitSign = (habit: Pick<Habit, 'type'>): 1 | -1 =>
  habit.type === 'negative' ? -1 : 1;

/** Per-completion base-point magnitude, independent of storage convention. */
export const habitPointsMagnitude = (habit: Pick<Habit, 'basePoints'>): number =>
  Math.abs(habit.basePoints);

/**
 * Signed points for ONE completion of `habit` at the given multiplier:
 * `habitSign × floor(|basePoints| × multiplier)`. This is the canonical
 * per-completion formula — every scoring/display path should use it (or its
 * two components) rather than reading `basePoints` raw.
 */
export const signedHabitPoints = (
  habit: Pick<Habit, 'type' | 'basePoints'>,
  multiplier = 1,
): number => habitSign(habit) * Math.floor(Math.abs(habit.basePoints) * multiplier);

/**
 * Check if a habit is stale (last updated in a previous period)
 * @param habit - The habit to check (must contain id, period, and lastUpdated)
 * @returns true if the habit needs to be reset, false otherwise
 */
export const isHabitStale = (
  habit: Pick<Habit, 'id' | 'period' | 'lastUpdated' | 'pausedUntil'>
): boolean => {
  try {
    // F-HABITS-01: a habit on a planned break is never stale — it's excluded
    // from the auto-reset-to-0 penalty for the duration of the pause.
    if (isHabitPaused(habit)) return false;

    // 1. Handle missing date
    if (!habit.lastUpdated) return true;

    // Get current time for comparison
    const now = new Date();

    let lastUpdate: Date | null = null;
    const rawLastUpdated = habit.lastUpdated as unknown;

    // 2. Normalize date from various possible inputs (string, Date, Firestore Timestamp)
    if (rawLastUpdated instanceof Date) {
      lastUpdate = rawLastUpdated;
    } else if (typeof rawLastUpdated === 'string') {
      lastUpdate = parseISO(rawLastUpdated);
    } else if (
      rawLastUpdated &&
      typeof rawLastUpdated === 'object' &&
      'toDate' in rawLastUpdated &&
      typeof (rawLastUpdated as { toDate: () => Date }).toDate === 'function'
    ) {
      // Firestore Timestamp
      lastUpdate = (rawLastUpdated as { toDate: () => Date }).toDate();
    } else if (
      rawLastUpdated &&
      typeof rawLastUpdated === 'object' &&
      'seconds' in rawLastUpdated &&
      typeof (rawLastUpdated as { seconds: number }).seconds === 'number'
    ) {
      // Plain object representation of Timestamp
      lastUpdate = new Date((rawLastUpdated as { seconds: number }).seconds * 1000);
    }

    // 3. Validate parsed date
    if (!lastUpdate || !isValid(lastUpdate)) {
      console.warn(`[isHabitStale] Invalid date format for habit ${habit.id}:`, habit.lastUpdated);
      return true;
    }

    // 4. Check period logic
    if (habit.period === 'daily') {
      return !isSameDay(now, lastUpdate);
    } else if (habit.period === 'weekly') {
      // weekStartsOn: 1 means Monday is day 0, Sunday is day 6
      // In date-fns v2+, weekStartsOn: 1 makes Monday the first day of the week.
      return !isSameWeek(now, lastUpdate, { weekStartsOn: 1 });
    } else {
      console.warn(`[isHabitStale] Unhandled habit period type: ${habit.period} for habit ${habit.id}`);
      return true; // Treat unknown periods as stale for safety
    }
  } catch (error) {
    console.error(`[isHabitStale] Error checking habit ${habit.id}:`, error);
    return true; // Fail safe
  }
};

/**
 * Calculate the current streak for a habit based on completion dates
 *
 * Frozen dates (Plan 25 auto-applied freeze protection) BRIDGE the chain
 * without counting: a date in `frozenDates` keeps the streak alive across a
 * missed day, but only completed dates increment the streak count. A frozen
 * day is never a completion — it earns zero points (see calculatePointsForDate)
 * and zero streak units; it only preserves continuity. With `frozenDates`
 * empty/omitted, behavior is identical to the pre-freeze implementation.
 *
 * MUST stay in lockstep with functions/src/quickAdd/streakLogic.ts.
 *
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @param today - "Today" in YYYY-MM-DD (caller's local timezone). Injectable for
 *                deterministic tests; defaults to the local date.
 * @param frozenDates - Dates protected by an auto-applied freeze (YYYY-MM-DD)
 * @returns The current streak count (completed days only; frozen days bridge)
 */
export const calculateStreak = (
  dates: string[],
  today: string = getLocalDateString(),
  frozenDates: string[] = []
): number => {
  if (dates.length === 0) return 0;
  const completedSet = new Set(dates);
  const frozenSet = new Set(frozenDates);
  const yesterday = format(subDays(parseISO(today), 1), 'yyyy-MM-dd');

  // Anchor: the streak is alive only if today or yesterday is completed or
  // frozen (completions are never future-dated, so this matches the previous
  // "most recent completion must be today/yesterday" check).
  let checkDate: string;
  if (completedSet.has(today) || frozenSet.has(today)) {
    checkDate = today;
  } else if (completedSet.has(yesterday) || frozenSet.has(yesterday)) {
    checkDate = yesterday;
  } else {
    return 0;
  }

  let currentStreak = 0;
  while (completedSet.has(checkDate) || frozenSet.has(checkDate)) {
    if (completedSet.has(checkDate)) currentStreak++;
    checkDate = format(subDays(parseISO(checkDate), 1), 'yyyy-MM-dd');
  }
  return currentStreak;
};

/**
 * Count consecutive completed days ending ON `date` (inclusive), walking
 * backward day-by-day. Returns 0 if `date` itself isn't in `completedDates`.
 *
 * This reconstructs the streak that existed on a specific day so historical
 * points can be recalculated with the multiplier that actually applied then —
 * rather than retro-applying the habit's *current* streak multiplier to every
 * past day (which causes point totals to drift on each recalc).
 *
 * Note: `streakEndingOn(dates, today)` equals `calculateStreak(dates)` whenever
 * `today` is the most recent completed day, so it matches the prospective streak
 * used at toggle time in `processToggleHabit`.
 *
 * Frozen dates bridge the backward walk without counting (see calculateStreak).
 * Returns 0 when `date` itself is not a completion — a frozen day earns no
 * streak of its own (and no points; the points paths only ever score completed
 * dates).
 *
 * @param completedDates - Array of completion dates in YYYY-MM-DD format
 * @param date - The date (YYYY-MM-DD) the streak should end on
 * @param frozenDates - Dates protected by an auto-applied freeze (YYYY-MM-DD)
 * @returns The streak length ending on `date`
 */
export const streakEndingOn = (
  completedDates: string[],
  date: string,
  frozenDates: string[] = []
): number => {
  const completedSet = new Set(completedDates);
  const frozenSet = new Set(frozenDates);
  if (!completedSet.has(date)) return 0;

  let streak = 0;
  let checkDate = date;
  while (completedSet.has(checkDate) || frozenSet.has(checkDate)) {
    if (completedSet.has(checkDate)) streak++;
    checkDate = format(subDays(parseISO(checkDate), 1), 'yyyy-MM-dd');
  }
  return streak;
};

/**
 * Calculate the current streak for a WEEKLY habit in consecutive ISO weeks.
 *
 * Mirrors `calculateStreak` but counts consecutive ISO weeks that contain at
 * least one completion, ending at the most recent completion's week.  A full
 * week with zero completions resets the streak.
 *
 * ISO weeks start on Monday.  All dates are interpreted in the user's local
 * timezone (matching the `yyyy-MM-dd` strings stored in Firestore).
 *
 * Frozen dates bridge at WEEK granularity: an ISO week containing only a
 * frozen date keeps the chain alive without counting as a completed week.
 *
 * MUST stay in lockstep with functions/src/quickAdd/streakLogic.ts.
 *
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @param today - "Today" in YYYY-MM-DD (caller's local timezone). Injectable for
 *                deterministic tests; defaults to the local date.
 * @param frozenDates - Dates protected by an auto-applied freeze (YYYY-MM-DD)
 * @returns The current consecutive-week streak (completed weeks only)
 */
export const calculateWeeklyStreak = (
  dates: string[],
  today: string = getLocalDateString(),
  frozenDates: string[] = []
): number => {
  if (dates.length === 0) return 0;

  const weekStartOf = (d: string): string =>
    format(startOfISOWeek(parseISO(d)), 'yyyy-MM-dd');
  const completedWeeks = new Set(dates.map(weekStartOf));
  const frozenWeeks = new Set(frozenDates.map(weekStartOf));

  // The streak can only extend from the current week or the immediately past week.
  const todayDate = parseISO(today);
  const nowWeekStart = format(startOfISOWeek(todayDate), 'yyyy-MM-dd');
  const prevWeekStart = format(subWeeks(startOfISOWeek(todayDate), 1), 'yyyy-MM-dd');

  // Anchor: alive only if the current or previous ISO week is completed or
  // frozen (completions are never future-dated, so this matches the previous
  // "most recent completion week must be current/previous" check).
  let checkWeek: string;
  if (completedWeeks.has(nowWeekStart) || frozenWeeks.has(nowWeekStart)) {
    checkWeek = nowWeekStart;
  } else if (completedWeeks.has(prevWeekStart) || frozenWeeks.has(prevWeekStart)) {
    checkWeek = prevWeekStart;
  } else {
    return 0;
  }

  let streak = 0;
  // Walk backward one ISO week at a time: completed → count, frozen → bridge.
  while (completedWeeks.has(checkWeek) || frozenWeeks.has(checkWeek)) {
    if (completedWeeks.has(checkWeek)) streak++;
    checkWeek = format(subWeeks(parseISO(checkWeek), 1), 'yyyy-MM-dd');
  }
  return streak;
};

/**
 * Count consecutive completed ISO weeks ending ON the week that contains `date`,
 * ignoring any completion weeks that come after `date`'s ISO week.
 *
 * Weekly analogue of `streakEndingOn` — used for historical point recalculation
 * so that past weeks earn the multiplier that actually applied then.
 *
 * Returns 0 if `date`'s ISO week contains no completion.
 *
 * Frozen dates bridge at week granularity without counting (see
 * calculateWeeklyStreak). Returns 0 when the reference week has no completion.
 *
 * @param completedDates - Array of completion dates in YYYY-MM-DD format
 * @param date - Reference date (YYYY-MM-DD); we look at its ISO week and earlier
 * @param frozenDates - Dates protected by an auto-applied freeze (YYYY-MM-DD)
 * @returns The consecutive-week streak ending on `date`'s ISO week
 */
export const streakEndingOnWeek = (
  completedDates: string[],
  date: string,
  frozenDates: string[] = []
): number => {
  const weekStartOf = (d: string): string =>
    format(startOfISOWeek(parseISO(d)), 'yyyy-MM-dd');
  const completedWeeks = new Set(completedDates.map(weekStartOf));
  const frozenWeeks = new Set(frozenDates.map(weekStartOf));

  const refWeekStartStr = weekStartOf(date);

  // If the reference week itself has no completion, streak is 0. (The backward
  // walk below only ever visits the reference week and earlier, so completion
  // weeks after `date` are naturally ignored.)
  if (!completedWeeks.has(refWeekStartStr)) return 0;

  let streak = 0;
  let checkWeek = refWeekStartStr;
  while (completedWeeks.has(checkWeek) || frozenWeeks.has(checkWeek)) {
    if (completedWeeks.has(checkWeek)) streak++;
    checkWeek = format(subWeeks(parseISO(checkWeek), 1), 'yyyy-MM-dd');
  }
  return streak;
};

/**
 * F-HABITS-01 — safety cap on the number of synthesized pause-bridge dates, so a
 * pause set implausibly far in the future can never build an unbounded array.
 * ~13 months comfortably exceeds any realistic planned break.
 */
export const MAX_PAUSE_BRIDGE_DAYS = 400;

/**
 * True while a habit's planned break is still in effect (`pausedUntil >= today`).
 * A paused habit is skipped by the auto-reset penalty and never burns a freeze
 * token. `today` defaults to the caller's local date.
 */
export const isHabitPaused = (
  habit: Pick<Habit, 'pausedUntil'>,
  today: string = getLocalDateString(),
): boolean => !!habit.pausedUntil && habit.pausedUntil >= today;

/**
 * F-HABITS-01 — synthesize the frozen-style bridge dates for a planned pause.
 *
 * Rather than duplicate streak math, a pause is expressed as extra "frozen"
 * dates fed into the existing `calculateStreak`/`calculateWeeklyStreak` bridging
 * mechanism: every day from just after the last pre-pause completion through
 * `pausedUntil` is a bridge day (continuity preserved, but never a completion and
 * never scored). This makes the streak survive the break and resume cleanly when
 * the user completes the habit again afterward.
 *
 * The anchor is the latest completion STRICTLY BEFORE `today` (the last pre-pause
 * completion) — never a completion made today, so completing the habit again on
 * the pause-end day doesn't collapse the bridge and re-orphan the pre-pause
 * streak. The bridge covers `(lastPre, pausedUntil]`, so it never extends below
 * `lastPre` and therefore can't link an older, unrelated gap into the streak.
 * Returns [] when there is nothing to bridge.
 *
 * MUST stay in lockstep with functions/src/quickAdd/streakLogic.ts.
 *
 * @param habit - Only `completedDates` and `pausedUntil` are read
 * @param today - "Today" (YYYY-MM-DD, caller-local); defaults to the local date
 * @returns Bridge dates (YYYY-MM-DD), newest first, bounded by MAX_PAUSE_BRIDGE_DAYS
 */
export const pauseBridgeDates = (
  habit: Pick<Habit, 'completedDates' | 'pausedUntil'>,
  today: string = getLocalDateString(),
): string[] => {
  const { pausedUntil } = habit;
  if (!pausedUntil || habit.completedDates.length === 0) return [];

  // Anchor on the last completion made BEFORE today — a resume completion on the
  // pause-end day must not become the anchor (it would empty the bridge).
  const prior = habit.completedDates.filter(d => d < today);
  if (prior.length === 0) return [];
  const lastPre = prior.reduce((a, b) => (a > b ? a : b));
  if (pausedUntil <= lastPre) return []; // nothing to bridge

  const out: string[] = [];
  let d = parseISO(pausedUntil);
  while (out.length < MAX_PAUSE_BRIDGE_DAYS) {
    const ds = format(d, 'yyyy-MM-dd');
    if (ds <= lastPre) break; // reached the pre-pause completion; gap is bridged
    out.push(ds);
    d = subDays(d, 1);
  }
  return out;
};

/**
 * The bridging dates a habit's streak walk should treat as frozen: its stored
 * auto-freeze `frozenDates` PLUS the synthesized pause bridge (F-HABITS-01). All
 * period-aware streak helpers below route through this so pause and freeze share
 * one bridging path.
 */
export const effectiveFrozenDates = (
  habit: Pick<Habit, 'completedDates' | 'frozenDates' | 'pausedUntil'>,
  today: string = getLocalDateString(),
): string[] => [...(habit.frozenDates ?? []), ...pauseBridgeDates(habit, today)];

/**
 * Period-aware streak helper: returns the current streak in the correct unit
 * (days for daily habits, ISO weeks for weekly habits).
 *
 * Use this at call sites that operate on a specific habit so that weekly habits
 * earn week-based streaks while daily habit behaviour is completely unchanged.
 */
export const streakForHabit = (
  habit: Pick<Habit, 'period' | 'completedDates' | 'frozenDates' | 'pausedUntil'>
): number => {
  const bridged = effectiveFrozenDates(habit);
  return habit.period === 'weekly'
    ? calculateWeeklyStreak(habit.completedDates, getLocalDateString(), bridged)
    : calculateStreak(habit.completedDates, getLocalDateString(), bridged);
};

/**
 * Period-aware historical streak helper: the streak (in days or weeks) that
 * ended on the given `date` for this habit.
 *
 * Used in point recalculation so that past completions earn the multiplier that
 * actually applied at the time, not today's streak.
 */
export const streakEndingOnForHabit = (
  habit: Pick<Habit, 'period' | 'completedDates' | 'frozenDates' | 'pausedUntil'>,
  date: string
): number => {
  const bridged = effectiveFrozenDates(habit);
  return habit.period === 'weekly'
    ? streakEndingOnWeek(habit.completedDates, date, bridged)
    : streakEndingOn(habit.completedDates, date, bridged);
};

/**
 * Period-aware "is this habit completed in the current period?" check.
 *
 * Daily habits are done iff `today` itself is in `completedDates`. Weekly habits
 * are done iff ANY completion falls in `today`'s Monday-anchored ISO week — so a
 * weekly chore completed earlier in the week still reads as done on later days of
 * the same week (rather than only on the exact day it was checked off).
 *
 * `today` is the reference (a `getLocalDateString()` yyyy-MM-dd string) and is
 * parsed with `parseISO` for determinism — we never read `new Date()` here, so
 * the result is stable and matches the app's local-date convention.
 *
 * @param habit - The habit (only `period` and `completedDates` are read)
 * @param today - "Today" in YYYY-MM-DD (caller's local timezone)
 * @returns true if the habit is complete for the current day/week
 */
/**
 * The first date of the period `date` falls in for a habit of this cadence:
 * the date itself for a daily habit, its Monday-anchored ISO week start for a
 * weekly one.
 *
 * Two dates are in the same period iff this returns the same value for both —
 * the check every back-dated path needs to decide whether a date belongs to the
 * LIVE period (counter is authoritative) or a past one (counter must not move).
 */
export const habitPeriodStart = (period: HabitPeriod, date: string): string =>
  period === 'weekly'
    ? format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    : date;

export const isHabitCompletedInCurrentPeriod = (
  habit: Pick<Habit, 'period' | 'completedDates'>,
  today: string,
): boolean => {
  if (habit.period === 'weekly') {
    const ref = parseISO(today);
    return habit.completedDates.some(d => isSameWeek(parseISO(d), ref, { weekStartsOn: 1 }));
  }
  return habit.completedDates.includes(today);
};

/**
 * Get the point multiplier based on streak, habit type, and period.
 *
 * Thresholds per period (positive habits only):
 *   - daily:  3 consecutive days → 1.5×,  7 → 2.0×
 *   - weekly: 2 consecutive weeks → 1.5×,  4 → 2.0×
 *
 * The `period` parameter defaults to `'daily'` so every existing call site that
 * omits it retains byte-for-byte identical behaviour.
 *
 * @param streak - Current streak count (days for daily, weeks for weekly)
 * @param isPositive - Whether this is a positive habit
 * @param period - Habit period ('daily' | 'weekly'), defaults to 'daily'
 * @returns The multiplier to apply to base points
 */
export const getMultiplier = (
  streak: number,
  isPositive: boolean,
  period: HabitPeriod = 'daily',
): number => {
  if (!isPositive) return 1.0;
  if (period === 'weekly') {
    if (streak >= 4) return 2.0;
    if (streak >= 2) return 1.5;
    return 1.0;
  }
  // daily (default)
  if (streak >= 7) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
};

export interface ToggleHabitResult {
  updatedHabit: Partial<Habit>;
  pointsChange: number;
  multiplier: number;
}

/**
 * Process a habit toggle (increment/decrement) and calculate resulting state changes
 * This function contains the core business logic for habit scoring and streak tracking
 *
 * @param habit - The habit being toggled
 * @param direction - Whether to increment ('up') or decrement ('down')
 * @returns Object containing updated habit state and points change, or null if invalid
 */
export const processToggleHabit = (
  habit: Habit,
  direction: 'up' | 'down'
): ToggleHabitResult | null => {
  const today = getLocalDateString();

  let newCount = habit.count;
  let newTotalCount = habit.totalCount;
  let newCompletedDates = [...habit.completedDates];
  let pointsChange = 0;
  let multiplier = 1.0;

  // 1. Update Counts
  if (direction === 'up') {
    newCount++;
    newTotalCount++;
  } else {
    if (habit.count === 0) {
      // Can't go below 0
      return null;
    }
    if (newCount > 0) newCount--;
    if (newTotalCount > 0) newTotalCount--;
  }

  // 2. Determine if Scorable (Points + Completion)
  // Sign from type, magnitude from |basePoints| — see habitSign/signedHabitPoints.
  const sign = habitSign(habit);
  const baseMagnitude = habitPointsMagnitude(habit);

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  // Helper: compute the streak for a set of dates using the period-correct
  // algorithm. Frozen dates bridge the chain (continuity) without counting.
  const streakFor = (dates: string[]): number => {
    // Bridge across both auto-freezes and any active planned pause (F-HABITS-01).
    const bridged = effectiveFrozenDates({ ...habit, completedDates: dates }, today);
    return habit.period === 'weekly'
      ? calculateWeeklyStreak(dates, today, bridged)
      : calculateStreak(dates, today, bridged);
  };

  // Logic Split by Scoring Type
  if (habit.scoringType === 'incremental') {
    // Completion: Hit target (or 1 if 0)
    const target = habit.targetCount > 0 ? habit.targetCount : 1;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    // For the multiplier on incremental habits, use the streak that will exist
    // after this action: if toggling up and completing today for the first time,
    // include today in the prospective dates so the new streak drives the multiplier.
    const prospectiveDates =
      direction === 'up' && isCompletedNow && !habit.completedDates.includes(today)
        ? [...habit.completedDates, today]
        : habit.completedDates;
    const prospectiveStreak = streakFor(prospectiveDates);
    multiplier = getMultiplier(prospectiveStreak, habit.type === 'positive', habit.period);

    // Incremental: Points on every action
    if (direction === 'up') {
      pointsChange = sign * Math.floor(baseMagnitude * multiplier);
    } else {
      pointsChange = -sign * Math.floor(baseMagnitude * multiplier);
    }
  } else {
    // Threshold: Points only when target hit
    const target = habit.targetCount;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    if (isCompletedNow && !wasCompletedBefore) {
      // Just hit target -> Award Points using the NEW streak (including today).
      // Today is about to be added to completedDates; computing the streak from
      // the prospective list ensures the correct multiplier threshold is reached
      // on the right day rather than one day/week late.
      const prospectiveDates = habit.completedDates.includes(today)
        ? habit.completedDates
        : [...habit.completedDates, today];
      const prospectiveStreak = streakFor(prospectiveDates);
      multiplier = getMultiplier(prospectiveStreak, habit.type === 'positive', habit.period);
      pointsChange = sign * Math.floor(baseMagnitude * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      // Just lost target -> Remove Points using the OLD streak (today still present).
      const currentStreak = streakFor(habit.completedDates);
      multiplier = getMultiplier(currentStreak, habit.type === 'positive', habit.period);
      pointsChange = -sign * Math.floor(baseMagnitude * multiplier);
    }
  }

  // 3. Update Completion History (for streaks)
  if (isCompletedNow) {
    if (!newCompletedDates.includes(today)) {
      newCompletedDates.push(today);
      newCompletedDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    }
  } else {
    // Only remove if we fell below threshold
    newCompletedDates = newCompletedDates.filter(d => d !== today);
  }

  return {
    updatedHabit: {
      count: newCount,
      totalCount: newTotalCount,
      completedDates: newCompletedDates,
      streakDays: streakFor(newCompletedDates),
      lastUpdated: new Date().toISOString(),
    },
    pointsChange,
    multiplier,
  };
};

/** Result of reversing a STALE habit's prior-period completion (down-toggle). */
export interface StaleDownToggleResult {
  /** Prior-period completion dates to strip from completedDates (may be empty). */
  datesToRemove: string[];
  /** completedDates after the removal. */
  completedDates: string[];
  /** Recomputed (period-aware) streak after the removal. */
  streakDays: number;
  /**
   * Signed deltas to APPLY to the points buckets (≤ 0 for positive habits).
   * Date-aware gating mirrors deleteHabitSubmission/resetHabitDay: `total`
   * always absorbs the reversal, `weekly` only when the reversed date falls in
   * the current Monday-anchored week, `daily` only when it is today — which by
   * construction never happens here (only prior-period dates are removed), so
   * a stale deselect can never drive today's daily bucket negative.
   */
  pointsDelta: { daily: number; weekly: number; total: number };
}

/**
 * Process a 'down' toggle on a STALE habit (its live counter belongs to a
 * previous period that was never auto-reset — e.g. an overnight reset missed
 * on a throttled PWA). Deselecting such a habit means "undo that previous
 * period's completion", so this removes the prior period's completion date(s)
 * — the most recent completed day for daily habits, that day's whole ISO week
 * for weekly ones (mirroring resetHabit's period scoping) — and reverses the
 * points that period actually earned, using the same per-date attribution the
 * corrective recompute uses (`pointsForHabitOnDate`, historical multiplier
 * included) so the next login/midnight recompute agrees with the reversal.
 *
 * Pure: the caller (useHabitActions.toggleHabit's stale-down branch and the
 * Mock context) commits the returned fields plus `count: 0` atomically.
 *
 * @param habit - The stale habit being deselected
 * @param today - "Today" (YYYY-MM-DD, caller-local); injectable for tests
 */
export const processStaleDownToggle = (
  habit: Habit,
  today: string = getLocalDateString(),
): StaleDownToggleResult => {
  const weekStartOf = (d: string): string =>
    format(startOfWeek(parseISO(d), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const currentWeekStart = weekStartOf(today);

  // Only PRIOR-period completions are candidates: the stale counter describes
  // the period of the habit's most recent completion, which staleness
  // guarantees is before the current period. Current-period dates (defensive:
  // e.g. a completion written while lastUpdated stayed unsynced) are left
  // alone — reversing those is resetHabit's job.
  const priorDates = habit.period === 'weekly'
    ? habit.completedDates.filter(d => weekStartOf(d) < currentWeekStart)
    : habit.completedDates.filter(d => d < today);

  let datesToRemove: string[] = [];
  if (priorDates.length > 0) {
    const lastCompleted = priorDates.reduce((a, b) => (a > b ? a : b));
    datesToRemove = habit.period === 'weekly'
      ? priorDates.filter(d => weekStartOf(d) === weekStartOf(lastCompleted))
      : [lastCompleted];
  }

  const removeSet = new Set(datesToRemove);
  const completedDates = habit.completedDates.filter(d => !removeSet.has(d));

  // Reverse exactly what the recompute would attribute to each removed date
  // (historical streak multiplier, weekly once-per-week attribution), gated
  // per bucket by the removed DATE — not blindly against today's counters.
  const pointsDelta = { daily: 0, weekly: 0, total: 0 };
  for (const date of datesToRemove) {
    const earned = pointsForHabitOnDate(habit, date, today);
    if (earned === 0) continue;
    pointsDelta.total -= earned;
    if (date >= currentWeekStart && date <= today) pointsDelta.weekly -= earned;
    if (date === today) pointsDelta.daily -= earned;
  }

  const bridged = effectiveFrozenDates({ ...habit, completedDates }, today);
  const streakDays = habit.period === 'weekly'
    ? calculateWeeklyStreak(completedDates, today, bridged)
    : calculateStreak(completedDates, today, bridged);

  return { datesToRemove, completedDates, streakDays, pointsDelta };
};

/**
 * Calculate points to remove when resetting a habit
 * @param habit - The habit being reset
 * @returns The number of points to deduct
 */
export const calculateResetPoints = (habit: Habit): number => {
  if (habit.count === 0) return 0;

  let pointsToRemove = 0;
  const currentStreak = streakForHabit(habit);
  const multiplier = getMultiplier(currentStreak, habit.type === 'positive', habit.period);
  const sign = habitSign(habit);
  const baseMagnitude = habitPointsMagnitude(habit);

  if (habit.scoringType === 'incremental') {
    // Mirror processToggleHabit's award history: increments made BEFORE the
    // target was reached were credited at the streak WITHOUT today (today only
    // enters completedDates on the completing toggle), while the completing
    // increment and any after it were credited at the streak WITH today.
    // Deducting every increment at the current (with-today) multiplier would
    // over-remove whenever completing today crossed a multiplier threshold.
    const target = habit.targetCount > 0 ? habit.targetCount : 1;
    const preCount = Math.min(habit.count, target - 1);
    const postCount = habit.count - preCount;
    const today = getLocalDateString();
    const preMultiplier = getMultiplier(
      streakForHabit({
        period: habit.period,
        completedDates: habit.completedDates.filter(d => d !== today),
        frozenDates: habit.frozenDates,
      }),
      habit.type === 'positive',
      habit.period,
    );
    pointsToRemove =
      sign *
      (preCount * Math.floor(baseMagnitude * preMultiplier) +
        postCount * Math.floor(baseMagnitude * multiplier));
  } else {
    if (habit.count >= habit.targetCount) {
      pointsToRemove = sign * Math.floor(baseMagnitude * multiplier);
    }
  }

  return pointsToRemove;
};

/**
 * Compute the field updates for auto-resetting a stale habit's period counter.
 *
 * Mirrors the manual `resetHabit` path (hooks/useHabitActions): it zeroes `count`
 * AND drops `today` from `completedDates`, then recomputes `streakDays`. Dropping
 * today preserves the invariant "completedDates contains today ⟺ count reflects
 * today". Without it, a habit completed today but reset (count = 0) would still
 * carry today in `completedDates`, so `calculatePointsForDate` (which skips
 * `count === 0`) returns 0 for today while `calculatePointsForDateRange` (no such
 * guard) still counts it — desyncing the daily total from weekly/total on the
 * next points recalc. See todo/10-daily-points-after-midnight-reset.md.
 *
 * On a genuine new-day reset, `today` is not in `completedDates` (the completion
 * was on a prior day), so the filter is a no-op and historical completions —
 * and their weekly/total points — are preserved.
 *
 * @param habit - The habit being reset (`completedDates` and `period` are read)
 * @param today - Today's date in YYYY-MM-DD format (caller's local timezone)
 * @returns The fields to persist: zeroed count, today-stripped completedDates,
 *          and the recomputed (period-aware) streak
 */
export const getHabitResetUpdate = (
  habit: Pick<Habit, 'completedDates' | 'period' | 'frozenDates' | 'pausedUntil'>,
  today: string
): { count: 0; completedDates: string[]; streakDays: number } => {
  const completedDates = habit.completedDates.filter(date => date !== today);
  return {
    count: 0,
    completedDates,
    // Period-aware: daily habits get a day-based streak, weekly habits an
    // ISO-week-based streak — so a weekly habit isn't reset to ~0 at midnight.
    // Frozen-aware: an auto-applied freeze on yesterday keeps the streak alive
    // across the midnight reset instead of visually collapsing it. Pause-aware:
    // a planned break (pausedUntil) bridges the streak too (F-HABITS-01).
    streakDays: streakForHabit({ period: habit.period, completedDates, frozenDates: habit.frozenDates, pausedUntil: habit.pausedUntil }),
  };
};

/**
 * Calculate points earned from habits completed on a specific date
 * Used to recalculate daily points after a reset or on login
 * @param habits - Array of all habits
 * @param targetDate - The date to check completions for (YYYY-MM-DD format)
 * @param assignedTo - Optional scope: omit for the shared household pool (assigned
 *   chores excluded); pass a member uid to score ONLY that member's assigned chores.
 * @returns Total points earned from habits completed on that date
 */
export const calculatePointsForDate = (
  habits: Habit[],
  targetDate: string,
  assignedTo?: string,
): number => {
  let totalPoints = 0;
  const today = getLocalDateString();

  for (const habit of habits) {
    // Plan 080c scope filter. Default (assignedTo === undefined) = the shared
    // household pool: skip assigned (per-member/kid chore) habits so this recompute
    // can't double-count points already credited to a member. When `assignedTo` is
    // given, score ONLY that member's chores (recomputing a kid's own balance).
    if (assignedTo === undefined ? Boolean(habit.assignedTo) : habit.assignedTo !== assignedTo) {
      continue;
    }

    totalPoints += pointsForHabitOnDate(habit, targetDate, today);
  }

  return totalPoints;
};

/**
 * Signed points ONE habit contributed on ONE date, derived from
 * `completedDates` + the live period counter (the same attribution rules the
 * corrective recompute uses). Extracted from `calculatePointsForDate` so the
 * habit-calendar day cells and the day-reset reversal fallback score a single
 * (habit, date) pair with identical logic.
 *
 * Returns 0 when the date isn't a completion for this habit. Note: past
 * incremental days count as ONE completion (no historical per-day counters are
 * stored) — days logged via the submissions path should be scored from their
 * stored submissions instead (see calculateDayNetPoints).
 *
 * @param habit - The habit to score
 * @param targetDate - The date to check (YYYY-MM-DD)
 * @param today - "Today" (YYYY-MM-DD, caller-local); injectable for tests
 */
export const pointsForHabitOnDate = (
  habit: Habit,
  targetDate: string,
  today: string = getLocalDateString(),
): number => {
  // Check if habit was completed on the target date
  if (!habit.completedDates.includes(targetDate)) return 0;

  // The live `count` only describes the CURRENT period (today for daily
  // habits, the current ISO week for weekly ones) — it is zeroed by every
  // period reset. So the "reset ⇒ no points" short-circuit must apply only
  // when the target date falls in the current period; for a HISTORICAL date,
  // presence in completedDates proves the completion and the (long-reset)
  // counter must not zero it out (mirrors calculatePointsForDateRange).
  const targetInCurrentPeriod =
    habit.period === 'weekly'
      ? isSameWeek(parseISO(targetDate), parseISO(today), { weekStartsOn: 1 })
      : targetDate === today;
  if (targetInCurrentPeriod && habit.count === 0) return 0;

  // Use the streak that ended on the target date, not the habit's CURRENT
  // streak. Retro-applying the current multiplier to a past day over- or
  // under-counts its points on every recalc. For "today" this equals
  // calculateStreak/calculateWeeklyStreak(completedDates), so the common path
  // is unchanged.
  const dateStreak = streakEndingOnForHabit(habit, targetDate);
  const multiplier = getMultiplier(dateStreak, habit.type === 'positive', habit.period);
  const perDayPoints = Math.floor(habitPointsMagnitude(habit) * multiplier);
  const sign = habitSign(habit);

  if (habit.period === 'weekly') {
    // Weekly habits accumulate `count` across the whole ISO week and push
    // every later completion day into completedDates, so scoring the full
    // counter (or the full threshold award) on EACH day of the week would
    // re-award points earned on the week's other days.
    const ref = parseISO(targetDate);
    const sameWeekDates = habit.completedDates.filter(d =>
      isSameWeek(parseISO(d), ref, { weekStartsOn: 1 })
    );
    if (habit.scoringType === 'incremental') {
      const latestSameWeekDay = sameWeekDates.reduce((a, b) => (a > b ? a : b));
      const isCurrentWeekTarget = isSameWeek(parseISO(today), ref, { weekStartsOn: 1 });
      let completionsOnDate: number;
      if (isCurrentWeekTarget) {
        // No per-day counters are stored, so attribute one completion to each
        // other completed day of the week and the remainder to the LATEST day
        // (in practice "today", where the live counter keeps growing) — the
        // per-day attributions then sum to `count`, matching the range recompute.
        completionsOnDate =
          targetDate === latestSameWeekDay
            ? Math.max(habit.count - (sameWeekDates.length - 1), 0)
            : 1;
      } else {
        // PAST ISO week: the live `count` describes the CURRENT week only, so
        // it must not leak into historical attribution. The range recompute
        // scores a past week as ONE completion (per weekStart), so attribute
        // that single completion to the week's latest completed day — the
        // per-day sum across the week then matches calculatePointsForDateRange.
        completionsOnDate = targetDate === latestSameWeekDay ? 1 : 0;
      }
      return sign * completionsOnDate * perDayPoints;
    }
    // Threshold: the week's single award landed on the FIRST completed day
    // of the week; later toggle-days entered completedDates with 0 points.
    // `habit.count` is the live counter for the CURRENT week only, so gate
    // on it just for the current week (a past week's presence in
    // completedDates already proves it was completed) — mirrors the
    // isCurrentWeek bypass in calculatePointsForDateRange.
    const firstSameWeekDay = sameWeekDates.reduce((a, b) => (a < b ? a : b));
    const isCurrentWeek = isSameWeek(parseISO(today), ref, { weekStartsOn: 1 });
    if ((!isCurrentWeek || habit.count >= habit.targetCount) && targetDate === firstSameWeekDay) {
      return sign * perDayPoints;
    }
    return 0;
  }

  if (habit.scoringType === 'incremental') {
    // For incremental: points per count. No historical per-day counts are
    // stored, so a past day counts as a single completion — only "today" is
    // scored from the live counter (mirrors calculatePointsForDateRange).
    const completionsOnDate = targetDate === today ? habit.count : 1;
    return sign * completionsOnDate * perDayPoints;
  }
  // For threshold: points only if target met. The live counter only
  // describes today — a past day's presence in completedDates already
  // proves its target was reached (mirrors calculatePointsForDateRange).
  if (targetDate !== today || habit.count >= habit.targetCount) {
    return sign * perDayPoints;
  }
  return 0;
};

/** Per-(habit, date) totals derived from stored submissions. */
export interface DaySubmissionTotals {
  /** Sum of the day's submission counts. */
  count: number;
  /** Sum of the day's stored (signed) pointsEarned. */
  points: number;
}

/** Map keyed habitId → date (YYYY-MM-DD) → that day's submission totals. */
export type SubmissionTotalsByHabitDate = Map<string, Map<string, DaySubmissionTotals>>;

/**
 * Net signed points ALL given habits earned on one date, for the habit
 * calendar day cells.
 *
 * When a habit has stored submissions for the date, their summed
 * `pointsEarned` is authoritative (it captures multi-count backfills exactly);
 * otherwise fall back to the derived `pointsForHabitOnDate` attribution (days
 * completed via the toggle path leave no submission docs). Callers pass the
 * habit set already scoped to the surface (e.g. parent-visible habits only).
 *
 * @param habits - Habits to score (pre-filtered by the caller)
 * @param date - The date to score (YYYY-MM-DD)
 * @param submissionTotals - Optional per-habit per-date submission totals
 * @param today - "Today" (YYYY-MM-DD, caller-local); injectable for tests
 */
export const calculateDayNetPoints = (
  habits: Habit[],
  date: string,
  submissionTotals?: SubmissionTotalsByHabitDate,
  today: string = getLocalDateString(),
): number => {
  let net = 0;
  for (const habit of habits) {
    const dayTotals = submissionTotals?.get(habit.id)?.get(date);
    if (dayTotals) {
      net += dayTotals.points;
    } else {
      net += pointsForHabitOnDate(habit, date, today);
    }
  }
  return net;
};

/**
 * Calculate points earned from habits completed within a date range
 * Used to recalculate weekly points (Monday-Sunday)
 * @param habits - Array of all habits
 * @param startDate - Start of the range (YYYY-MM-DD format, inclusive)
 * @param endDate - End of the range (YYYY-MM-DD format, inclusive)
 * @param assignedTo - Optional scope: omit for the shared household pool (assigned
 *   chores excluded); pass a member uid to score ONLY that member's assigned chores.
 * @returns Total points earned from habits completed in that range
 */
export const calculatePointsForDateRange = (
  habits: Habit[],
  startDate: string,
  endDate: string,
  assignedTo?: string,
): number => {
  let totalPoints = 0;
  const today = getLocalDateString();

  for (const habit of habits) {
    // Plan 080c scope filter (see calculatePointsForDate): default skips assigned
    // chores (household pool); a given `assignedTo` scores ONLY that member's chores.
    if (assignedTo === undefined ? Boolean(habit.assignedTo) : habit.assignedTo !== assignedTo) {
      continue;
    }

    // Find all completion dates within the range
    const completionsInRange = habit.completedDates.filter(date =>
      date >= startDate && date <= endDate
    );

    if (completionsInRange.length === 0) continue;

    const sign = habitSign(habit);
    const baseMagnitude = habitPointsMagnitude(habit);
    const isPositive = habit.type === 'positive';

    if (habit.period === 'weekly') {
      // Weekly habits earn points once per ISO WEEK, not once per completion
      // day: `count` accumulates across the whole week (only reset on week
      // rollover) and every later toggle-day is pushed into completedDates.
      // Scoring each day independently would re-award the same week's points,
      // so collapse the range to one entry per ISO week.
      const currentWeekStart = format(startOfISOWeek(parseISO(today)), 'yyyy-MM-dd');
      const weekStarts = new Set(
        completionsInRange.map(d => format(startOfISOWeek(parseISO(d)), 'yyyy-MM-dd'))
      );
      for (const weekStart of weekStarts) {
        const weekStreak = streakEndingOnForHabit(habit, weekStart);
        const multiplier = getMultiplier(weekStreak, isPositive, habit.period);
        const perWeekPoints = Math.floor(baseMagnitude * multiplier);
        const isCurrentWeek = weekStart === currentWeekStart;

        if (habit.scoringType === 'incremental') {
          // Current week: the live `count` already covers every completion made
          // this week (on any day), matching what the per-toggle batches
          // credited. Past weeks: no per-week counts are stored, so each counts
          // as a single completion.
          const completionsInWeek = isCurrentWeek ? habit.count : 1;
          totalPoints += sign * completionsInWeek * perWeekPoints;
        } else {
          // Threshold: at most one award per week. For the current week require
          // the counter to actually be at target (a toggle back below target
          // strips only today from completedDates, not earlier week days).
          if (!isCurrentWeek || habit.count >= habit.targetCount) {
            totalPoints += sign * perWeekPoints;
          }
        }
      }
      continue;
    }

    // Sum per-date so each day earns the multiplier its OWN streak warranted.
    // Applying one current-streak multiplier to the whole range causes point
    // totals to drift up/down on every recalc as the streak grows or breaks.
    for (const date of completionsInRange) {
      const dateStreak = streakEndingOnForHabit(habit, date);
      const multiplier = getMultiplier(dateStreak, isPositive, habit.period);
      const perDayPoints = Math.floor(baseMagnitude * multiplier);

      if (habit.scoringType === 'incremental') {
        // We don't store historical per-day counts, so each past day counts as
        // a single completion — except "today", where habit.count reflects the
        // (possibly multiple) completions made today, preserving the
        // multi-completion behavior the per-toggle batch already credited so
        // the corrective sync doesn't erase earned points.
        const completionsOnDate = date === today ? habit.count : 1;
        totalPoints += sign * completionsOnDate * perDayPoints;
      } else {
        // Threshold: each completed day in range earns the threshold points once.
        totalPoints += sign * perDayPoints;
      }
    }
  }

  return totalPoints;
};

/** Shared shape of the household points triple. */
export interface HouseholdPoints {
  daily: number;
  weekly: number;
  total: number;
}

/** Result of recomputing the household points from habit completions. */
export interface PointsSyncResult {
  /** The points the household doc *should* hold given current completions. */
  points: HouseholdPoints;
  /** True when any of daily/weekly/total differs from the stored values. */
  needsUpdate: boolean;
}

/**
 * Pure recompute of the corrective household-points sync.
 *
 * Derives the canonical daily and weekly totals from actual habit completions,
 * then decides the cumulative total:
 *   - if every completion falls within the current week (and at least one
 *     completion exists), the total equals the weekly total;
 *   - otherwise the total is the larger of the stored total and the weekly
 *     total, so an existing cumulative total is never clamped downward.
 *
 * Extracted from `FirebaseHouseholdContext`'s `syncHouseholdPoints` so the
 * (otherwise inline, O(habits × completedDates)) recompute is unit-testable and
 * shared by the `usePointsSync` hook. Behaviour is identical to the previous
 * inline logic.
 *
 * @param habits - All habits to score
 * @param currentPoints - The points currently stored on the household doc
 * @param now - "Now" (injected for deterministic tests)
 * @returns The corrected points plus whether they differ from `currentPoints`
 */
export const computeHouseholdPointsSync = (
  habits: Habit[],
  currentPoints: HouseholdPoints,
  now: Date,
): PointsSyncResult => {
  const today = format(now, 'yyyy-MM-dd');
  const weekStartStr = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');

  const correctDaily = calculatePointsForDate(habits, today);
  const correctWeekly = calculatePointsForDateRange(habits, weekStartStr, today);

  // If every completion is within the current week, the cumulative total equals
  // the weekly total; otherwise keep the stored total (don't clamp it down).
  const allDatesThisWeek = habits.every(habit =>
    habit.completedDates.every(date => date >= weekStartStr)
  );
  const correctTotal =
    allDatesThisWeek && habits.some(h => h.completedDates.length > 0)
      ? correctWeekly
      : Math.max(currentPoints.total, correctWeekly);

  const points: HouseholdPoints = {
    daily: correctDaily,
    weekly: correctWeekly,
    total: correctTotal,
  };

  const needsUpdate =
    currentPoints.daily !== correctDaily ||
    currentPoints.weekly !== correctWeekly ||
    currentPoints.total !== correctTotal;

  return { points, needsUpdate };
};

/** One managed member's recomputed daily/weekly points (Plan 080c-2). */
export interface ManagedMemberPointsReset {
  memberUid: string;
  daily: number;
  weekly: number;
}

/**
 * Plan 080c-2: recompute each managed (kid) member's daily/weekly points from the
 * chores assigned to THEM, for the reset that rolls over their balance on a
 * day/week boundary (see `checkPointsReset`). Mirrors the household recompute but
 * scoped per member via `calculatePointsForDate`/`Range`'s `assignedTo` argument.
 *
 * Only members that are `isManaged` AND actually have an assigned chore are
 * returned — so for households not using Kid Mode this is an empty array and the
 * caller writes nothing. `total` is intentionally omitted: it is a lifetime
 * counter and never resets (only daily/weekly roll over).
 *
 * @param members - The household members (managed kids are filtered in)
 * @param habits - All habits (each kid's assigned chores are selected per member)
 * @param weekStartStr - Monday of the current week (YYYY-MM-DD)
 * @param today - Today (YYYY-MM-DD), caller's local timezone
 */
export const computeManagedMemberPointsReset = (
  members: Pick<HouseholdMember, 'uid' | 'isManaged'>[],
  habits: Habit[],
  weekStartStr: string,
  today: string,
): ManagedMemberPointsReset[] => {
  const out: ManagedMemberPointsReset[] = [];
  for (const member of members) {
    if (!member.isManaged) continue;
    if (!habits.some(h => h.assignedTo === member.uid)) continue;
    out.push({
      memberUid: member.uid,
      daily: calculatePointsForDate(habits, today, member.uid),
      weekly: calculatePointsForDateRange(habits, weekStartStr, today, member.uid),
    });
  }
  return out;
};
