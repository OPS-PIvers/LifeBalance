import { Habit } from '@/types/schema';
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
 * Check if a habit is stale (last updated in a previous period)
 * @param habit - The habit to check (must contain id, period, and lastUpdated)
 * @returns true if the habit needs to be reset, false otherwise
 */
export const isHabitStale = (habit: Pick<Habit, 'id' | 'period' | 'lastUpdated'>): boolean => {
  try {
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
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @returns The current streak count
 */
export const calculateStreak = (dates: string[]): number => {
  if (dates.length === 0) return 0;
  // Deduplicate dates to handle multiple completions on the same day
  const uniqueDates = Array.from(new Set(dates));
  const sortedDates = uniqueDates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const today = format(new Date(), 'yyyy-MM-dd');
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  let currentStreak = 0;
  let checkDate = sortedDates[0] === today ? today : yesterday;
  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) return 0;
  for (const dateStr of sortedDates) {
    if (dateStr === checkDate) {
      currentStreak++;
      checkDate = format(subDays(parseISO(checkDate), 1), 'yyyy-MM-dd');
    } else {
      break;
    }
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
 * @param completedDates - Array of completion dates in YYYY-MM-DD format
 * @param date - The date (YYYY-MM-DD) the streak should end on
 * @returns The streak length ending on `date`
 */
export const streakEndingOn = (completedDates: string[], date: string): number => {
  const completedSet = new Set(completedDates);
  if (!completedSet.has(date)) return 0;

  let streak = 0;
  let checkDate = date;
  while (completedSet.has(checkDate)) {
    streak++;
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
 * @param dates - Array of completion dates in YYYY-MM-DD format
 * @returns The current consecutive-week streak
 */
export const calculateWeeklyStreak = (dates: string[]): number => {
  if (dates.length === 0) return 0;

  // Deduplicate, then collect the Monday of each completion's ISO week.
  const uniqueDates = Array.from(new Set(dates));
  const weekStarts = Array.from(
    new Set(
      uniqueDates.map(d => format(startOfISOWeek(parseISO(d)), 'yyyy-MM-dd'))
    )
  ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()); // newest first

  // The streak can only extend from the current week or the immediately past week.
  const nowWeekStart = format(startOfISOWeek(new Date()), 'yyyy-MM-dd');
  const prevWeekStart = format(subWeeks(startOfISOWeek(new Date()), 1), 'yyyy-MM-dd');

  // If the most recent completion is not in the current or previous ISO week, no streak.
  if (weekStarts[0] !== nowWeekStart && weekStarts[0] !== prevWeekStart) return 0;

  let streak = 0;
  // Walk backward: each step should be exactly one ISO week earlier.
  let expectedWeek = weekStarts[0]!;
  for (const weekStart of weekStarts) {
    if (weekStart === expectedWeek) {
      streak++;
      expectedWeek = format(subWeeks(parseISO(expectedWeek), 1), 'yyyy-MM-dd');
    } else {
      break;
    }
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
 * @param completedDates - Array of completion dates in YYYY-MM-DD format
 * @param date - Reference date (YYYY-MM-DD); we look at its ISO week and earlier
 * @returns The consecutive-week streak ending on `date`'s ISO week
 */
export const streakEndingOnWeek = (completedDates: string[], date: string): number => {
  const refWeekStart = startOfISOWeek(parseISO(date));

  // Collect the Monday of every completion's ISO week, filtered to <= refWeekStart.
  const weekStartStrings = Array.from(
    new Set(
      completedDates
        .filter(d => {
          const ws = startOfISOWeek(parseISO(d));
          return ws <= refWeekStart;
        })
        .map(d => format(startOfISOWeek(parseISO(d)), 'yyyy-MM-dd'))
    )
  ).sort((a, b) => new Date(b).getTime() - new Date(a).getTime()); // newest first

  const refWeekStartStr = format(refWeekStart, 'yyyy-MM-dd');

  // If the reference week itself has no completion, streak is 0.
  if (!weekStartStrings.includes(refWeekStartStr)) return 0;

  let streak = 0;
  let expectedWeek = refWeekStartStr;
  for (const ws of weekStartStrings) {
    if (ws === expectedWeek) {
      streak++;
      expectedWeek = format(subWeeks(parseISO(expectedWeek), 1), 'yyyy-MM-dd');
    } else {
      break;
    }
  }
  return streak;
};

/**
 * Period-aware streak helper: returns the current streak in the correct unit
 * (days for daily habits, ISO weeks for weekly habits).
 *
 * Use this at call sites that operate on a specific habit so that weekly habits
 * earn week-based streaks while daily habit behaviour is completely unchanged.
 */
export const streakForHabit = (
  habit: Pick<Habit, 'period' | 'completedDates'>
): number =>
  habit.period === 'weekly'
    ? calculateWeeklyStreak(habit.completedDates)
    : calculateStreak(habit.completedDates);

/**
 * Period-aware historical streak helper: the streak (in days or weeks) that
 * ended on the given `date` for this habit.
 *
 * Used in point recalculation so that past completions earn the multiplier that
 * actually applied at the time, not today's streak.
 */
export const streakEndingOnForHabit = (
  habit: Pick<Habit, 'period' | 'completedDates'>,
  date: string
): number =>
  habit.period === 'weekly'
    ? streakEndingOnWeek(habit.completedDates, date)
    : streakEndingOn(habit.completedDates, date);

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
  const today = format(new Date(), 'yyyy-MM-dd');

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
  const sign = habit.type === 'positive' ? 1 : -1;

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  // Helper: compute the streak for a set of dates using the period-correct algorithm.
  const streakFor = (dates: string[]): number =>
    habit.period === 'weekly'
      ? calculateWeeklyStreak(dates)
      : calculateStreak(dates);

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
      pointsChange = sign * Math.floor(habit.basePoints * multiplier);
    } else {
      pointsChange = -sign * Math.floor(habit.basePoints * multiplier);
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
      pointsChange = sign * Math.floor(habit.basePoints * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      // Just lost target -> Remove Points using the OLD streak (today still present).
      const currentStreak = streakFor(habit.completedDates);
      multiplier = getMultiplier(currentStreak, habit.type === 'positive', habit.period);
      pointsChange = -sign * Math.floor(habit.basePoints * multiplier);
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
  const sign = habit.type === 'positive' ? 1 : -1;

  if (habit.scoringType === 'incremental') {
    pointsToRemove = sign * habit.count * Math.floor(habit.basePoints * multiplier);
  } else {
    if (habit.count >= habit.targetCount) {
      pointsToRemove = sign * Math.floor(habit.basePoints * multiplier);
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
 * @param habit - The habit being reset (only `completedDates` is read)
 * @param today - Today's date in YYYY-MM-DD format (caller's local timezone)
 * @returns The fields to persist: zeroed count, today-stripped completedDates,
 *          and the recomputed streak
 */
export const getHabitResetUpdate = (
  habit: Pick<Habit, 'completedDates'>,
  today: string
): { count: 0; completedDates: string[]; streakDays: number } => {
  const completedDates = habit.completedDates.filter(date => date !== today);
  return {
    count: 0,
    completedDates,
    streakDays: calculateStreak(completedDates),
  };
};

/**
 * Calculate points earned from habits completed on a specific date
 * Used to recalculate daily points after a reset or on login
 * @param habits - Array of all habits
 * @param targetDate - The date to check completions for (YYYY-MM-DD format)
 * @returns Total points earned from habits completed on that date
 */
export const calculatePointsForDate = (habits: Habit[], targetDate: string): number => {
  let totalPoints = 0;

  for (const habit of habits) {
    // Check if habit was completed on the target date
    if (!habit.completedDates.includes(targetDate)) continue;

    // Only count if the habit currently has a count > 0 (hasn't been reset yet)
    // or if the targetDate is in completedDates (which means it was completed)
    if (habit.count === 0) continue;

    // Use the streak that ended on the target date, not the habit's CURRENT
    // streak. Retro-applying the current multiplier to a past day over- or
    // under-counts its points on every recalc. For "today" this equals
    // calculateStreak/calculateWeeklyStreak(completedDates), so the common path
    // is unchanged.
    const dateStreak = streakEndingOnForHabit(habit, targetDate);
    const multiplier = getMultiplier(dateStreak, habit.type === 'positive', habit.period);
    const sign = habit.type === 'positive' ? 1 : -1;

    if (habit.scoringType === 'incremental') {
      // For incremental: points per count
      totalPoints += sign * habit.count * Math.floor(habit.basePoints * multiplier);
    } else {
      // For threshold: points only if target met
      if (habit.count >= habit.targetCount) {
        totalPoints += sign * Math.floor(habit.basePoints * multiplier);
      }
    }
  }

  return totalPoints;
};

/**
 * Calculate points earned from habits completed within a date range
 * Used to recalculate weekly points (Monday-Sunday)
 * @param habits - Array of all habits
 * @param startDate - Start of the range (YYYY-MM-DD format, inclusive)
 * @param endDate - End of the range (YYYY-MM-DD format, inclusive)
 * @returns Total points earned from habits completed in that range
 */
export const calculatePointsForDateRange = (
  habits: Habit[],
  startDate: string,
  endDate: string
): number => {
  let totalPoints = 0;
  const today = format(new Date(), 'yyyy-MM-dd');

  for (const habit of habits) {
    // Find all completion dates within the range
    const completionsInRange = habit.completedDates.filter(date =>
      date >= startDate && date <= endDate
    );

    if (completionsInRange.length === 0) continue;

    const sign = habit.type === 'positive' ? 1 : -1;
    const isPositive = habit.type === 'positive';

    // Sum per-date so each day earns the multiplier its OWN streak warranted.
    // Applying one current-streak multiplier to the whole range causes point
    // totals to drift up/down on every recalc as the streak grows or breaks.
    for (const date of completionsInRange) {
      const dateStreak = streakEndingOnForHabit(habit, date);
      const multiplier = getMultiplier(dateStreak, isPositive, habit.period);
      const perDayPoints = Math.floor(habit.basePoints * multiplier);

      if (habit.scoringType === 'incremental') {
        // We don't store historical per-day counts, so each past day counts as a
        // single completion. The one exception is "today" on a daily habit, where
        // habit.count reflects the (possibly multiple) completions made today —
        // preserving the multi-completion behavior daily recalc relies on.
        const completionsOnDate =
          date === today && habit.period === 'daily' ? habit.count : 1;
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
