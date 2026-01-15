import { Habit, Challenge } from '@/types/schema';
import { format, parseISO, getDaysInMonth } from 'date-fns';
import { getEffectiveTargetValue, getEffectiveTargetType } from './migrations/challengeMigration';

export interface ChallengeProgress {
  currentValue: number;
  progress: number; // Percentage 0-100
  completedHabitsCount?: number; // For count type
  daysCompleted?: number; // For percentage type
}

/**
 * Calculates challenge progress based on linked habits
 *
 * For count type: Sums totalCount from positive habits, subtracts from negative habits (inverse tracking)
 * For percentage type: Calculates % of days in month where at least one linked habit was completed
 *
 * @param challenge - The challenge to calculate progress for
 * @param linkedHabits - Array of habits linked to this challenge
 * @returns Progress information including currentValue and percentage
 */
export function calculateChallengeProgress(
  challenge: Challenge,
  linkedHabits: Habit[]
): ChallengeProgress {
  if (linkedHabits.length === 0) {
    return { currentValue: 0, progress: 0, completedHabitsCount: 0 };
  }

  const targetType = getEffectiveTargetType(challenge);
  const targetValue = getEffectiveTargetValue(challenge);

  if (targetType === 'count') {
    return calculateCountProgress(linkedHabits, targetValue);
  } else {
    return calculatePercentageProgress(challenge, linkedHabits, targetValue);
  }
}

/**
 * Calculates progress for count-based challenges
 *
 * Positive habits: Each completion adds to progress
 * Negative habits (inverse tracking): Each day WITHOUT completion adds to progress
 *
 * @param linkedHabits - Habits linked to the challenge
 * @param targetValue - Target count to reach
 */
function calculateCountProgress(
  linkedHabits: Habit[],
  targetValue: number
): ChallengeProgress {
  let currentValue = 0;

  for (const habit of linkedHabits) {
    if (habit.type === 'positive') {
      // Positive habits: add their totalCount
      currentValue += habit.totalCount;
    } else {
      // Negative habits (inverse tracking): For count mode, we don't subtract
      // Instead, we count "resistance days" - days without the bad habit
      // This is tracked separately and doesn't directly add to count
      // For simplicity in count mode, negative habits are not counted
      // (They're better suited for percentage mode)
    }
  }

  const progress = Math.min(100, (currentValue / targetValue) * 100);

  return {
    currentValue,
    progress,
    completedHabitsCount: currentValue,
  };
}

/**
 * Calculates progress for percentage-based challenges
 *
 * Calculates the % of days in the current month where the challenge goals were met:
 * - Positive habits: Count days where habit was completed
 * - Negative habits (inverse tracking): Count days where habit was NOT completed
 *
 * @param challenge - The challenge
 * @param linkedHabits - Habits linked to the challenge
 * @param targetValue - Target percentage to reach
 */
function calculatePercentageProgress(
  challenge: Challenge,
  linkedHabits: Habit[],
  targetValue: number
): ChallengeProgress {
  const currentDate = new Date();
  const monthKey = format(currentDate, 'yyyy-MM');

  // Check if challenge month matches current month
  // If challenge.month is set and different, use that month instead
  const challengeMonth = challenge.month || monthKey;
  const [year, month] = challengeMonth.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  // const monthEnd = endOfMonth(monthStart); // Unused
  const daysInMonth = getDaysInMonth(monthStart);

  // For percentage mode, we track unique "success days"
  const successDays = new Set<string>();

  for (const habit of linkedHabits) {
    if (habit.type === 'positive') {
      // Positive habits: Add days where habit was completed
      habit.completedDates
        .filter(dateStr => dateStr.startsWith(challengeMonth))
        .forEach(dateStr => successDays.add(dateStr));
    } else {
      // Negative habits (inverse tracking): Add days where habit was NOT completed
      const negativeHabitSuccessDays = calculateNegativeHabitSuccessDays(
        habit,
        challengeMonth,
        daysInMonth
      );
      negativeHabitSuccessDays.forEach(dateStr => successDays.add(dateStr));
    }
  }

  const daysCompleted = successDays.size;
  const currentValue = Math.round((daysCompleted / daysInMonth) * 100);
  const progress = Math.min(100, (currentValue / targetValue) * 100);

  return {
    currentValue,
    progress,
    daysCompleted,
  };
}

/**
 * Calculates "success days" for negative habits (inverse tracking)
 *
 * A success day = a day where the negative habit was NOT completed
 *
 * @param habit - The negative habit
 * @param monthKey - Month in YYYY-MM format
 * @param daysInMonth - Number of days in the month
 * @returns Array of date strings (YYYY-MM-DD) representing success days
 */
function calculateNegativeHabitSuccessDays(
  habit: Habit,
  monthKey: string,
  daysInMonth: number
): string[] {
  const successDays: string[] = [];

  // Get all days in the month where habit was completed
  const completedDaysInMonth = new Set(
    habit.completedDates.filter(d => d.startsWith(monthKey))
  );

  // All days NOT in completedDates are success days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${monthKey}-${String(day).padStart(2, '0')}`;

    // Only count up to current date (don't count future days)
    const date = parseISO(dateStr);
    if (date > new Date()) break;

    if (!completedDaysInMonth.has(dateStr)) {
      successDays.push(dateStr);
    }
  }

  return successDays;
}

/**
 * Gets a human-readable status message for challenge progress
 *
 * @param progress - Challenge progress object
 * @param targetType - Type of challenge (count or percentage)
 * @returns Status message string
 */
export function getChallengeStatusMessage(
  progress: ChallengeProgress,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _targetType: 'count' | 'percentage'
): string {
  const { progress: progressPercent } = progress;

  if (progressPercent >= 100) {
    return '🎉 Challenge Complete!';
  }

  if (progressPercent >= 80) {
    return '🔥 Almost there!';
  }

  if (progressPercent >= 50) {
    return '💪 Making great progress';
  }

  if (progressPercent >= 25) {
    return '📈 Keep it up!';
  }

  return '🎯 Just getting started';
}
