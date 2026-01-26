/**
 * Server-side habit processing logic
 * Ported from utils/habitLogic.ts for use in Cloud Functions
 */

import { format, subDays, parseISO, isSameDay, isSameWeek, isValid } from "date-fns";

export interface Habit {
  id: string;
  title: string;
  category: string;
  type: "positive" | "negative";
  basePoints: number;
  scoringType: "incremental" | "threshold";
  period: "daily" | "weekly";
  targetCount: number;
  count: number;
  totalCount: number;
  completedDates: string[];
  streakDays: number;
  lastUpdated: string | Date | { seconds: number; nanoseconds: number };
  isShared?: boolean;
  ownerId?: string;
}

export interface ToggleHabitResult {
  updatedHabit: Partial<Habit>;
  pointsChange: number;
  multiplier: number;
}

/**
 * Check if a habit is stale (last updated in a previous period)
 */
export function isHabitStale(
  habit: Pick<Habit, "id" | "period" | "lastUpdated">
): boolean {
  try {
    if (!habit.lastUpdated) return true;

    const now = new Date();
    let lastUpdate: Date | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawLastUpdated = habit.lastUpdated as any;

    // Normalize date from various possible inputs
    if (rawLastUpdated instanceof Date) {
      lastUpdate = rawLastUpdated;
    } else if (typeof rawLastUpdated === "string") {
      lastUpdate = parseISO(rawLastUpdated);
    } else if (rawLastUpdated && typeof rawLastUpdated.toDate === "function") {
      // Firestore Timestamp
      lastUpdate = rawLastUpdated.toDate();
    } else if (rawLastUpdated && typeof rawLastUpdated.seconds === "number") {
      // Plain object representation of Timestamp
      lastUpdate = new Date(rawLastUpdated.seconds * 1000);
    }

    if (!lastUpdate || !isValid(lastUpdate)) {
      return true;
    }

    if (habit.period === "daily") {
      return !isSameDay(now, lastUpdate);
    } else if (habit.period === "weekly") {
      return !isSameWeek(now, lastUpdate, { weekStartsOn: 1 });
    }

    return true;
  } catch {
    return true;
  }
}

/**
 * Calculate the current streak for a habit based on completion dates
 */
export function calculateStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const uniqueDates = Array.from(new Set(dates));
  const sortedDates = uniqueDates.sort(
    (a, b) => new Date(b).getTime() - new Date(a).getTime()
  );

  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");

  let currentStreak = 0;
  let checkDate = sortedDates[0] === today ? today : yesterday;

  if (sortedDates[0] !== today && sortedDates[0] !== yesterday) return 0;

  for (const dateStr of sortedDates) {
    if (dateStr === checkDate) {
      currentStreak++;
      checkDate = format(subDays(parseISO(checkDate), 1), "yyyy-MM-dd");
    } else {
      break;
    }
  }

  return currentStreak;
}

/**
 * Get the point multiplier based on streak and habit type
 */
export function getMultiplier(streak: number, isPositive: boolean): number {
  let multiplier = 1.0;
  if (isPositive) {
    if (streak >= 7) multiplier = 2.0;
    else if (streak >= 3) multiplier = 1.5;
  }
  return multiplier;
}

/**
 * Process a habit toggle and calculate resulting state changes
 */
export function processToggleHabit(
  habit: Habit,
  direction: "up" | "down"
): ToggleHabitResult | null {
  const today = format(new Date(), "yyyy-MM-dd");

  let newCount = habit.count;
  let newTotalCount = habit.totalCount;
  let newCompletedDates = [...habit.completedDates];
  let pointsChange = 0;

  // 1. Update Counts
  if (direction === "up") {
    newCount++;
    newTotalCount++;
  } else {
    if (habit.count === 0) {
      return null; // Can't go below 0
    }
    if (newCount > 0) newCount--;
    if (newTotalCount > 0) newTotalCount--;
  }

  // 2. Calculate Points
  const currentStreak = calculateStreak(habit.completedDates);
  const multiplier = getMultiplier(currentStreak, habit.type === "positive");

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  if (habit.scoringType === "incremental") {
    // Incremental: Points on every action
    if (direction === "up") {
      pointsChange = Math.floor(habit.basePoints * multiplier);
    } else {
      pointsChange = -Math.floor(habit.basePoints * multiplier);
    }
    const target = habit.targetCount > 0 ? habit.targetCount : 1;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;
  } else {
    // Threshold: Points only when target hit
    const target = habit.targetCount;
    isCompletedNow = newCount >= target;
    wasCompletedBefore = habit.count >= target;

    if (isCompletedNow && !wasCompletedBefore) {
      pointsChange = Math.floor(habit.basePoints * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      pointsChange = -Math.floor(habit.basePoints * multiplier);
    }
  }

  // 3. Update Completion History
  if (isCompletedNow) {
    if (!newCompletedDates.includes(today)) {
      newCompletedDates.push(today);
      newCompletedDates.sort(
        (a, b) => new Date(b).getTime() - new Date(a).getTime()
      );
    }
  } else {
    newCompletedDates = newCompletedDates.filter((d) => d !== today);
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
}

/**
 * Reset a stale habit to 0 count while preserving history
 */
export function resetStaleHabit(_habit: Habit): Partial<Habit> {
  return {
    count: 0,
    lastUpdated: new Date().toISOString(),
    // Keep completedDates and streakDays - they'll be recalculated on next toggle
  };
}

/**
 * Fuzzy match a habit by title
 * Returns the best matching habit or null
 */
export function fuzzyMatchHabit(
  habits: Habit[],
  searchTerm: string
): Habit | null {
  const normalizedSearch = searchTerm.toLowerCase().trim();

  // Exact match first
  const exactMatch = habits.find(
    (h) => h.title.toLowerCase() === normalizedSearch
  );
  if (exactMatch) return exactMatch;

  // Contains match
  const containsMatch = habits.find((h) =>
    h.title.toLowerCase().includes(normalizedSearch)
  );
  if (containsMatch) return containsMatch;

  // Starts with match
  const startsWithMatch = habits.find((h) =>
    h.title.toLowerCase().startsWith(normalizedSearch)
  );
  if (startsWithMatch) return startsWithMatch;

  return null;
}
