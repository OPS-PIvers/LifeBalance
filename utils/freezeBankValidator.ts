import { Habit } from '@/types/schema';
import { format, subDays, parseISO, differenceInDays } from 'date-fns';

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Gets dates (within lookback period) where a habit was not completed
 *
 * The lookback is floored at the habit's earliest known existence so we never
 * flag days that predate the habit as "missed" — a habit had no streak to
 * protect before its first-ever completion. Without a `createdAt` on the habit,
 * the earliest `completedDate` is used as that floor; callers may pass an
 * explicit `habitCreatedAt` for greater precision once the schema supports it.
 *
 * @param habit - The habit to check
 * @param lookbackDays - Number of days to look back (default 7)
 * @param habitCreatedAt - Optional creation date (YYYY-MM-DD) used as the floor
 * @returns Array of date strings (YYYY-MM-DD) where habit was missed
 */
export function getMissedHabitDates(
  habit: Habit,
  lookbackDays: number = 7,
  habitCreatedAt?: string
): string[] {
  // Only consider positive habits for freeze bank usage
  if (habit.type !== 'positive') {
    return [];
  }

  // Without any completion history there is no streak to protect, so nothing
  // counts as "missed".
  if (habit.completedDates.length === 0) {
    return [];
  }

  // Determine the earliest date the habit could plausibly have been missed.
  // Prefer an explicit creation date when provided, otherwise fall back to the
  // earliest completed date. Days before this floor predate the habit.
  const earliestCompleted = habit.completedDates.reduce((min, d) => (d < min ? d : min));
  const floorDate =
    habitCreatedAt && habitCreatedAt < earliestCompleted ? habitCreatedAt : earliestCompleted;

  const missedDates: string[] = [];
  const today = new Date();
  const completedDatesSet = new Set(habit.completedDates);

  for (let i = 1; i <= lookbackDays; i++) {
    const checkDate = subDays(today, i);
    const dateStr = format(checkDate, 'yyyy-MM-dd');

    // Don't look back earlier than the habit existed.
    if (dateStr < floorDate) break;

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
    // parseISO returns an Invalid Date (NaN time) for unparseable input rather
    // than throwing, so the catch below never fires for e.g. 'not-a-date'. Guard
    // explicitly — otherwise every NaN comparison below is false and an invalid
    // date slips through as allowed.
    if (Number.isNaN(targetTime)) {
      return {
        allowed: false,
        reason: 'Invalid date format. Expected YYYY-MM-DD.',
      };
    }
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

  } catch {
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

  // Return the most recent missed date (first in array since we iterate backwards from today)
  // missedDates[0] is defined: the length === 0 guard above ensures the array is non-empty.
  return missedDates[0] ?? null;
}
