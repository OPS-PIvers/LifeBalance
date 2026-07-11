import { Habit, Transaction } from '@/types/schema';
import {
  format, subDays, eachDayOfInterval, parseISO,
  startOfWeek, subWeeks, subMonths
} from 'date-fns';
import { sumMoney, roundMoney } from '@/utils/money';
import { signedHabitPoints, habitPointsMagnitude } from '@/utils/habitLogic';

// --- View 1: Pulse (Overview) ---

export const calculatePulseData = (habits: Habit[], transactions: Transaction[], daysToLookBack: number = 14) => {
  const data = [];
  const today = new Date();

  for (let i = daysToLookBack - 1; i >= 0; i--) {
    const date = subDays(today, i);
    const dateStr = format(date, 'yyyy-MM-dd');

    // Calculate Points
    let points = 0;
    habits.forEach(h => {
      if (h.completedDates?.includes(dateStr)) {
         // Sign from type, magnitude from |basePoints| — raw basePoints is
         // stored with either sign depending on the creation path.
         points += signedHabitPoints(h);
      }
    });

    // Calculate Spending
    const spending = sumMoney(
      transactions
        .filter(t => t.date === dateStr && t.category !== 'Income')
        .map(t => t.amount)
    );

    data.push({
      date: format(date, 'MMM d'), // "Oct 24"
      fullDate: dateStr,
      points,
      spending
    });
  }
  return data;
};

export const calculateWeeklyComparison = (habits: Habit[]) => {
  const now = new Date();
  const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 }); // Monday
  const lastWeekStart = subWeeks(currentWeekStart, 1);

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const data = days.map((dayName, index) => {
    // Current Week Date
    const currentDate = new Date(currentWeekStart);
    currentDate.setDate(currentWeekStart.getDate() + index);
    const currentDateStr = format(currentDate, 'yyyy-MM-dd');

    // Last Week Date
    const lastDate = new Date(lastWeekStart);
    lastDate.setDate(lastWeekStart.getDate() + index);
    const lastDateStr = format(lastDate, 'yyyy-MM-dd');

    let currentPoints = 0;
    let lastPoints = 0;

    habits.forEach(h => {
      if (h.completedDates?.includes(currentDateStr)) {
         currentPoints += signedHabitPoints(h);
      }
      if (h.completedDates?.includes(lastDateStr)) {
         lastPoints += signedHabitPoints(h);
      }
    });

    return {
      day: dayName,
      "This Week": currentPoints,
      "Last Week": lastPoints
    };
  });

  return data;
};

// --- View 2: Behavior (Habits) ---

export const calculateHabitConsistency = (habits: Habit[]) => {
  const categoryStats = new Map<string, number>();
  // Pre-compute the cutoff string once — avoids calling new Date() + parseISO per entry
  const cutoffStr = format(subDays(new Date(), 90), 'yyyy-MM-dd');

  habits.forEach(habit => {
    // Compare ISO date strings directly (lexicographic order equals chronological)
    const recentCompletions = habit.completedDates?.filter(dateStr => dateStr >= cutoffStr).length || 0;

    // Magnitude only: this radar chart ranks category activity volume, and a
    // negative-stored basePoints would silently subtract from its category.
    const points = recentCompletions * habitPointsMagnitude(habit);
    categoryStats.set(habit.category, (categoryStats.get(habit.category) || 0) + points);
  });

  return Array.from(categoryStats.entries())
    .map(([subject, points]) => ({ subject, points, fullMark: 100 })) // fullMark for RadarChart
    .sort((a, b) => b.points - a.points)
    .slice(0, 6);
};

export const calculateHeatmapData = (habits: Habit[]) => {
  const endDate = new Date();
  const startDate = subDays(endDate, 89); // 90 days
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  let maxCompletions = 0;
  const dailyCounts = new Map<string, number>();

  // Only count completions inside the rendered window, so the intensity
  // ceiling (maxCompletions) isn't set by a peak day the chart never shows.
  // ISO date strings compare lexicographically = chronologically.
  const startStr = format(startDate, 'yyyy-MM-dd');
  const endStr = format(endDate, 'yyyy-MM-dd');

  habits.forEach(habit => {
    habit.completedDates?.forEach(date => {
      if (date >= startStr && date <= endStr) {
        dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
      }
    });
  });

  dailyCounts.forEach(count => {
    if (count > maxCompletions) maxCompletions = count;
  });

  return days.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const count = dailyCounts.get(dateStr) || 0;

    let intensity = 0;
    if (count > 0) {
      if (maxCompletions < 4) {
        intensity = Math.min(count, 4);
      } else {
        if (count >= maxCompletions * 0.75) intensity = 4;
        else if (count >= maxCompletions * 0.5) intensity = 3;
        else if (count >= maxCompletions * 0.25) intensity = 2;
        else intensity = 1;
      }
    }

    return {
      date: dateStr,
      dayName: format(day, 'EEE'),
      formattedDate: format(day, 'MMM d, yyyy'),
      count,
      intensity
    };
  });
};

// --- View 3: Wallet (Finance) ---

export const calculateCategoryTrend = (transactions: Transaction[]) => {
  // Initialize buckets for each month
  const monthBuckets = new Map<string, Map<string, number>>();
  const categoryTotals = new Map<string, number>();

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i);
    const key = format(d, 'yyyy-MM');
    monthBuckets.set(key, new Map());
    return key;
  });

  // months[0] is always defined: Array.from({length:6},...) always has 6 elements
  const sixMonthsAgo = months[0]!;

  // Single pass to aggregate both total per category (for ranking) and per month (for chart)
  transactions.forEach(t => {
    const monthKey = t.date.substring(0, 7);
    if (monthKey >= sixMonthsAgo && t.category !== 'Income') {
      // Aggregate for ranking
      categoryTotals.set(t.category, (categoryTotals.get(t.category) || 0) + t.amount);

      // Aggregate for month bucket
      if (monthBuckets.has(monthKey)) {
        const bucket = monthBuckets.get(monthKey)!;
        bucket.set(t.category, (bucket.get(t.category) || 0) + t.amount);
      }
    }
  });

  // Identify top categories
  const topCategories = Array.from(categoryTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(entry => entry[0]);

  // Build final data structure
  const data = months.map(monthKey => {
    const monthData: Record<string, number | string> = {
      month: format(parseISO(monthKey + '-01'), 'MMM')
    };

    // Initialize defaults
    topCategories.forEach(cat => {
      monthData[cat] = 0;
    });
    monthData['Other'] = 0;

    // Fill from pre-aggregated buckets
    const bucket = monthBuckets.get(monthKey);
    if (bucket) {
      bucket.forEach((amount, category) => {
        if (topCategories.includes(category)) {
          monthData[category] = roundMoney((monthData[category] as number) + amount);
        } else {
          monthData['Other'] = roundMoney((monthData['Other'] as number) + amount);
        }
      });
    }

    return monthData;
  });

  return { data, categories: topCategories };
};
