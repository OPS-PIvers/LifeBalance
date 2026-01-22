import { Transaction, Habit } from '../types/schema';
import { subDays, getDay, parseISO, format } from 'date-fns';

// Define specific data types for each action
interface TransactionData {
  merchant: string;
  amount: number;
  category: string;
  date: string;
}

interface HabitData {
  habitId: string;
  direction: 'up' | 'down';
}

interface ShoppingData {
  item: string;
  quantity?: string;
  category?: string;
  store?: string;
}

export interface SuggestedAction {
  id: string;
  type: 'transaction' | 'habit' | 'shopping';
  title: string;
  subtitle?: string;
  confidence: number;
  data: TransactionData | HabitData | ShoppingData;
}

/**
 * Analyzing past transactions to find patterns for the current day of the week.
 * Returns suggested transactions that are likely to happen today but haven't been logged yet.
 */
const getPredictedTransactions = (
  transactions: Transaction[],
  todayDate: string
): SuggestedAction[] => {
  const today = parseISO(todayDate);
  const currentDayOfWeek = getDay(today); // 0 = Sunday, 1 = Monday, etc.

  // Filter for last 90 days to keep suggestions relevant
  const cutoffDate = format(subDays(today, 90), 'yyyy-MM-dd');
  const recentTransactions = transactions.filter(t => t.date >= cutoffDate);

  // Group by Merchant + Category
  // We want to find "Starbucks (Dining)" or "Shell (Gas)"
  const patterns: Record<string, { count: number; totalAmount: number; occurrencesOnDay: number; category: string; merchant: string }> = {};

  recentTransactions.forEach(tx => {
    const key = `${tx.merchant.toLowerCase()}|${tx.category}`;

    if (!patterns[key]) {
      patterns[key] = { count: 0, totalAmount: 0, occurrencesOnDay: 0, category: tx.category, merchant: tx.merchant };
    }

    patterns[key].count++;
    patterns[key].totalAmount += tx.amount;

    if (getDay(parseISO(tx.date)) === currentDayOfWeek) {
      patterns[key].occurrencesOnDay++;
    }
  });

  const suggestions: SuggestedAction[] = [];

  // Thresholds
  const MIN_OCCURRENCES = 3; // Must have happened at least 3 times on this day of week
  const MIN_CONFIDENCE = 0.2; // 20% chance (lowered for testing and realism, since 3/12 is 25%)

  Object.values(patterns).forEach(pattern => {
    // Calculate probability: How often does it happen on this day vs total days of that type in the period?
    // Approx 12-13 weeks in 90 days.
    const weeksInPeriod = 12;
    const probability = pattern.occurrencesOnDay / weeksInPeriod;

    if (pattern.occurrencesOnDay >= MIN_OCCURRENCES && probability >= MIN_CONFIDENCE) {
      // Check if ALREADY logged today
      const alreadyLogged = transactions.some(tx =>
        tx.date === todayDate &&
        tx.merchant.toLowerCase() === pattern.merchant.toLowerCase()
      );

      if (!alreadyLogged) {
        const avgAmount = pattern.totalAmount / pattern.count;
        suggestions.push({
          id: `suggest-tx-${pattern.merchant}`,
          type: 'transaction',
          title: pattern.merchant,
          subtitle: `$${avgAmount.toFixed(2)}`,
          confidence: probability,
          data: {
            merchant: pattern.merchant,
            amount: Number(avgAmount.toFixed(2)),
            category: pattern.category,
            date: todayDate
          } as TransactionData
        });
      }
    }
  });

  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
};

/**
 * Suggests habits that need to be completed today.
 * Prioritizes habits with active streaks.
 */
const getPredictedHabits = (
  habits: Habit[],
  todayDate: string
): SuggestedAction[] => {
  const suggestions: SuggestedAction[] = [];

  habits.forEach(habit => {
    // Check if completed today
    const isCompletedToday = habit.completedDates.includes(todayDate);

    // Only suggest uncompleted habits
    // Filter for Daily habits (Weekly support could be added later)
    if (!isCompletedToday && habit.period === 'daily') {
      const isStreakActive = habit.streakDays > 0;

      suggestions.push({
        id: `suggest-habit-${habit.id}`,
        type: 'habit',
        title: habit.title,
        subtitle: isStreakActive ? `🔥 ${habit.streakDays} day streak` : 'Start a streak!',
        confidence: isStreakActive ? 0.9 : 0.5, // High confidence if preserving streak
        data: {
          habitId: habit.id,
          direction: 'up'
        } as HabitData
      });
    }
  });

  // Sort by streak length (descending)
  return suggestions.sort((a, b) => {
    const streakA = parseInt(a.subtitle?.match(/\d+/)?.[0] || '0');
    const streakB = parseInt(b.subtitle?.match(/\d+/)?.[0] || '0');
    return streakB - streakA;
  }).slice(0, 3);
};

export const getSuggestedActions = (
  transactions: Transaction[],
  habits: Habit[],
  todayDate: string
): SuggestedAction[] => {
  const txSuggestions = getPredictedTransactions(transactions, todayDate);
  const habitSuggestions = getPredictedHabits(habits, todayDate);

  // Interleave or prioritize?
  // Let's take top 2 habits (streak protection is key) and top 2 transactions.

  return [...habitSuggestions.slice(0, 2), ...txSuggestions.slice(0, 2)];
};
