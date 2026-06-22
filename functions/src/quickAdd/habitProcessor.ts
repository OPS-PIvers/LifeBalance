/**
 * Server-side habit processing logic
 * Ported from utils/habitLogic.ts for use in Cloud Functions
 */

import { format, parseISO, isSameDay, isSameWeek, isValid } from "date-fns";
import { streakForPeriod, getMultiplier } from "./streakLogic";

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
    const rawLastUpdated = habit.lastUpdated as
      | Date
      | string
      | { toDate?: () => Date; seconds?: number; nanoseconds?: number };

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
 * Process a habit toggle and calculate resulting state changes
 */
export function processToggleHabit(
  habit: Habit,
  direction: "up" | "down",
  // The caller's LOCAL date (yyyy-MM-dd). Cloud Functions run in UTC, so when a
  // local date is available (e.g. from the Shortcut payload) it must be passed
  // in to avoid recording completions on the wrong day for non-UTC users.
  // Defaults to the server's date to preserve prior behavior.
  today: string = format(new Date(), "yyyy-MM-dd")
): ToggleHabitResult | null {

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
  // The multiplier must reflect the streak INCLUDING the current completion
  // (the "prospective" streak), matching the client (utils/habitLogic.ts).
  // We dispatch by period so weekly habits use the ISO-week streak rather than
  // the day-based one (which would reset on every ~7-day gap).
  const prospectiveDates = habit.completedDates.includes(today)
    ? habit.completedDates
    : [...habit.completedDates, today];
  const completionStreak = streakForPeriod(prospectiveDates, habit.period, today);
  const multiplier = getMultiplier(
    completionStreak,
    habit.type === "positive",
    habit.period
  );
  const sign = habit.type === "positive" ? 1 : -1;

  let isCompletedNow = false;
  let wasCompletedBefore = false;

  if (habit.scoringType === "incremental") {
    // Incremental: Points on every action
    if (direction === "up") {
      pointsChange = sign * Math.floor(habit.basePoints * multiplier);
    } else {
      pointsChange = -sign * Math.floor(habit.basePoints * multiplier);
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
      pointsChange = sign * Math.floor(habit.basePoints * multiplier);
    } else if (!isCompletedNow && wasCompletedBefore) {
      pointsChange = -sign * Math.floor(habit.basePoints * multiplier);
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
      streakDays: streakForPeriod(newCompletedDates, habit.period, today),
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
