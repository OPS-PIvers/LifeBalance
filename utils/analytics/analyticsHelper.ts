import { Habit, Transaction } from '../../types/schema';
import {
  format, subDays, eachDayOfInterval, parseISO,
  startOfWeek, subWeeks, subMonths
} from 'date-fns';

// Colors for Heatmap
export const HEATMAP_COLORS = {
  0: '#f1f5f9', // slate-100
  1: '#6ee7b7', // emerald-300
  2: '#34d399', // emerald-400
  3: '#10b981', // emerald-500
  4: '#047857', // emerald-700
} as const;

export const CHART_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1'];

// Helper to check negative habit safely
const isNegativeHabit = (h: Habit): boolean => {
  return h.type === 'negative';
};

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
         if (isNegativeHabit(h)) {
            points -= h.basePoints;
         } else {
            points += h.basePoints;
         }
      }
    });

    // Calculate Spending
    const spending = transactions
      .filter(t => t.date === dateStr && t.category !== 'Income')
      .reduce((sum, t) => sum + t.amount, 0);

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
         currentPoints += isNegativeHabit(h) ? -h.basePoints : h.basePoints;
      }
      if (h.completedDates?.includes(lastDateStr)) {
         lastPoints += isNegativeHabit(h) ? -h.basePoints : h.basePoints;
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
  const cutoffDate = subDays(new Date(), 90);

  habits.forEach(habit => {
    const recentCompletions = habit.completedDates?.filter(dateStr => {
      const completionDate = parseISO(dateStr);
      return completionDate >= cutoffDate;
    }).length || 0;

    const points = recentCompletions * habit.basePoints;
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

  habits.forEach(habit => {
    habit.completedDates?.forEach(date => {
      dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
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

export const calculateNetFlowData = (transactions: Transaction[]) => {
  const buckets = new Map<string, { income: number; expense: number }>();

  // Initialize last 6 months
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(new Date(), 5 - i);
    const key = format(d, 'yyyy-MM');
    buckets.set(key, { income: 0, expense: 0 });
    return key;
  });

  // Single pass through transactions
  const sixMonthsAgo = months[0];
  transactions.forEach(t => {
    const monthKey = t.date.substring(0, 7); // YYYY-MM
    if (monthKey >= sixMonthsAgo && buckets.has(monthKey)) {
      const bucket = buckets.get(monthKey)!;
      if (t.category === 'Income') {
        bucket.income += t.amount;
      } else if (t.category === 'Expense') {
        bucket.expense += t.amount;
      }
    }
  });

  return months.map(monthKey => {
    const { income, expense } = buckets.get(monthKey)!;
    return {
      month: format(parseISO(monthKey + '-01'), 'MMM'),
      Income: Math.round(income),
      Expense: Math.round(expense),
      Net: Math.round(income - expense)
    };
  });
};

export const calculateSpendingCategories = (transactions: Transaction[]) => {
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
  const totals = new Map<string, number>();

  transactions
    .filter(t => t.date >= thirtyDaysAgo && t.category !== 'Income')
    .forEach(t => {
      totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
    });

  const totalAllCategories = Array.from(totals.values()).reduce((acc, val) => acc + val, 0);

  const getCategoryColor = (categoryName: string) => {
    let hash = 0;
    for (let i = 0; i < categoryName.length; i++) {
      hash = categoryName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return CHART_COLORS[Math.abs(hash) % CHART_COLORS.length];
  };

  const allCategories = Array.from(totals.entries())
    .map(([name, value]) => ({
      name,
      value: Math.round(value),
      percent: totalAllCategories > 0 ? Math.round((value / totalAllCategories) * 100) : 0,
      fill: getCategoryColor(name),
    }))
    .sort((a, b) => b.value - a.value);

  const top6 = allCategories.slice(0, 6);
  const remaining = allCategories.slice(6);

  if (remaining.length > 0) {
    const otherTotal = remaining.reduce((acc, cat) => acc + cat.value, 0);
    top6.push({
      name: 'Other',
      value: otherTotal,
      percent: totalAllCategories > 0 ? Math.round((otherTotal / totalAllCategories) * 100) : 0,
      fill: '#94a3b8',
    });
  }

  return top6;
};

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

  const sixMonthsAgo = months[0];

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
          monthData[category] = (monthData[category] as number) + amount;
        } else {
          monthData['Other'] = (monthData['Other'] as number) + amount;
        }
      });
    }

    return monthData;
  });

  return { data, categories: topCategories };
};
