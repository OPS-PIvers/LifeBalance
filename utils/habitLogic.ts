import { Habit, HouseholdMember } from '@/types/schema';
import { format, subDays, parseISO, isSameDay, isSameWeek, isValid } from 'date-fns';

/**
 * Check if a habit is stale (last updated in a previous period)
 * @param habit - The habit to check (must contain id, period, and lastUpdated)
 * @returns true if the habit needs to be reset, false otherwise
 */
export const isHabitStale = (habit: Pick<Habit, 'id' | 'period' | 'lastUpdated'>): boolean => {
  try {
    // 1. Handle missing date
    if (!habit.lastUpdated) return true;

    let lastUpdate: Date | null = null;
    const rawLastUpdated = habit.lastUpdated as any;

    // 2. Normalize date from various possible inputs (string, Date, Firestore Timestamp)
    if (rawLastUpdated instanceof Date) {
      lastUpdate = rawLastUpdated;
    } else if (typeof rawLastUpdated === 'string') {
      lastUpdate = parseISO(rawLastUpdated);
    } else if (rawLastUpdated && typeof rawLastUpdated.toDate === 'function') {
      // Firestore Timestamp
      lastUpdate = rawLastUpdated.toDate();
    } else if (rawLastUpdated && typeof rawLastUpdated.seconds === 'number') {
      // Plain object representation of Timestamp
      lastUpdate = new Date(rawLastUpdated.seconds * 1000);
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
  const sortedDates = [...dates].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
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
 * Get the point multiplier based on streak and habit type
 * @param streak - Current streak count
 * @param isPositive - Whether this is a positive habit
 * @returns The multiplier to apply to base points
 */
export const getMultiplier = (streak: number, isPositive: boolean): number => {
  let multiplier = 1.0;
  if (isPositive) {
    if (streak >= 7) multiplier = 2.0;
    else if (streak >= 3) multiplier = 1.5;
  }
  return multiplier;
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
 * @param currentUser - The current user (for validation, not modified)
 * @returns Object containing updated habit state and points change, or null if invalid
 */
export const processToggleHabit = (
  habit: Habit,
  direction: 'up' | 'down',
  currentUser: HouseholdMember
): ToggleHabitResult | null => {
  const today = format(new Date(), 'yyyy-MM-dd');

  let newCount = habit.count;
  let newTotalCount = habit.totalCount;
  let newCompletedDates = [...habit.completedDates];
  let pointsChange = 0;

  // 1. Update Counts
  if (direction === 'up') {
    newCount++;
    newTotalCount++;
  } else {
    if (newCount > 0) newCount--;
    if (newTotalCount > 0) newTotalCount--;
    if (newCount === 0 && direction === 'down') {
      // Can't go below 0
      return null;
    }
  }

  // 2. Determine if Scorable (Points + Completion)
  const currentStreak = calculateStreak(habit.completedDates);
  const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  // Logic Split by Scoring Type
  if (habit.scoringType === 'incremental') {
    // Incremental: Points on every action
    if (direction === 'up') {
      pointsChange = Math.floor(habit.basePoints * multiplier);
    } else {
      pointsChange = -Math.floor(habit.basePoints * multiplier);
    }
    // Completion: Hit target (or 1 if 0)
    const target = habit.targetCount > 0 ? habit.targetCount : 1;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;
  } else {
    // Threshold: Points only when target hit
    const target = habit.targetCount;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    if (isCompletedNow && !wasCompletedBefore) {
      // Just hit target -> Award Points
      pointsChange = Math.floor(habit.basePoints * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      // Just lost target -> Remove Points
      pointsChange = -Math.floor(habit.basePoints * multiplier);
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
      streakDays: calculateStreak(newCompletedDates),
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
  const currentStreak = calculateStreak(habit.completedDates);
  const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

  if (habit.scoringType === 'incremental') {
    pointsToRemove = habit.count * Math.floor(habit.basePoints * multiplier);
  } else {
    if (habit.count >= habit.targetCount) {
      pointsToRemove = Math.floor(habit.basePoints * multiplier);
    }
  }

  return pointsToRemove;
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

    const currentStreak = calculateStreak(habit.completedDates);
    const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

    if (habit.scoringType === 'incremental') {
      // For incremental: points per count
      totalPoints += habit.count * Math.floor(habit.basePoints * multiplier);
    } else {
      // For threshold: points only if target met
      if (habit.count >= habit.targetCount) {
        totalPoints += Math.floor(habit.basePoints * multiplier);
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

  for (const habit of habits) {
    // Find all completion dates within the range
    const completionsInRange = habit.completedDates.filter(date =>
      date >= startDate && date <= endDate
    );

    if (completionsInRange.length === 0) continue;

    // For each completion date in range, calculate points
    // Note: We use the current streak for multiplier calculation
    const currentStreak = calculateStreak(habit.completedDates);
    const multiplier = getMultiplier(currentStreak, habit.type === 'positive');

    if (habit.scoringType === 'incremental') {
      // For incremental habits, we need to estimate points per completion
      // Since we don't store historical counts, use basePoints * multiplier per completion day
      // This is an approximation - for accurate tracking we'd need per-day snapshots
      totalPoints += completionsInRange.length * Math.floor(habit.basePoints * multiplier);
    } else {
      // For threshold: each completed day in range earns the threshold points
      totalPoints += completionsInRange.length * Math.floor(habit.basePoints * multiplier);
    }
  }

  return totalPoints;
};
