import { Habit } from '@/types/schema';
import { format, subDays, parseISO, differenceInDays } from 'date-fns';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Gets dates (within lookback period) where a habit was not completed
 *
 * @param habit - The habit to check
 * @param lookbackDays - Number of days to look back (default 7)
 * @returns Array of date strings (YYYY-MM-DD) where habit was missed
 */
export function getMissedHabitDates(habit: Habit, lookbackDays: number = 7): string[] {
  // Only consider positive habits for freeze bank usage
  if (habit.type !== 'positive') {
    return [];
  }

  const missedDates: string[] = [];
  const today = new Date();
  const completedDatesSet = new Set(habit.completedDates);

  for (let i = 1; i <= lookbackDays; i++) {
    const checkDate = subDays(today, i);
    const dateStr = format(checkDate, 'yyyy-MM-dd');

    // Check if date is NOT in completedDates
    if (!completedDatesSet.has(dateStr)) {
      missedDates.push(dateStr);
    }
  }

  return missedDates;
}

/**
 * Validates whether a freeze bank token can be used
 *
 * @param habit - The habit to patch
 * @param targetDate - Date string (YYYY-MM-DD) to patch
 * @param currentTokens - Current freeze bank token balance
 * @returns Validation result with allowed flag and optional reason
 */
export function canUseFreezeBankToken(
  habit: Habit,
  targetDate: string,
  currentTokens: number
): ValidationResult {
  // Check 1: Must have tokens available
  if (currentTokens <= 0) {
    return {
      allowed: false,
      reason: 'No freeze tokens available. Tokens rollover monthly (2 new + 1 carryover).',
    };
  }

  // Check 2: Only positive habits can be frozen
  if (habit.type !== 'positive') {
    return {
      allowed: false,
      reason: 'Freeze tokens can only be used on positive habits.',
    };
  }

  // Check 3: Habit must not already be completed on that date
  if (habit.completedDates.includes(targetDate)) {
    return {
      allowed: false,
      reason: `${habit.title} was already completed on this date.`,
    };
  }

  // Check 4: Date must be in the past (not today or future)
  try {
    const targetTime = parseISO(targetDate).getTime();
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    if (targetTime >= todayStart) {
      return {
        allowed: false,
        reason: 'Freeze tokens can only be used on past dates, not today or future dates.',
      };
    }

    // Check 5: Date must be within reasonable range (last 30 days)
    const daysDiff = differenceInDays(now, parseISO(targetDate));

    if (daysDiff > 30) {
      return {
        allowed: false,
        reason: 'Freeze tokens can only be used for dates within the last 30 days.',
      };
    }

    if (daysDiff < 1) {
      return {
        allowed: false,
        reason: 'Date must be at least 1 day in the past.',
      };
    }

  } catch (error) {
    return {
      allowed: false,
      reason: 'Invalid date format. Expected YYYY-MM-DD.',
    };
  }

  // All validations passed
  return { allowed: true };
}

/**
 * Checks if a habit would benefit from using a freeze token
 * (i.e., if it has missed days that could be patched to restore a streak)
 *
 * @param habit - The habit to check
 * @returns true if habit has missed days in the last 7 days
 */
export function wouldBenefitFromFreezeToken(habit: Habit): boolean {
  if (habit.type !== 'positive') return false;

  const missedDates = getMissedHabitDates(habit, 7);
  return missedDates.length > 0;
}

/**
 * Suggests the best date to freeze for a habit (the most recent missed date)
 *
 * @param habit - The habit to check
 * @returns Date string (YYYY-MM-DD) or null if no missed dates
 */
export function suggestFreezeBankDate(habit: Habit): string | null {
  const missedDates = getMissedHabitDates(habit, 7);

  if (missedDates.length === 0) return null;

  // Return the most recent missed date (last in array since we iterate backwards)
  return missedDates[0];
}
