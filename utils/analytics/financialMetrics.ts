import { Transaction } from '../../types/schema';
import { differenceInDays, parseISO, addDays, format, isAfter } from 'date-fns';

export const calculateBurnDown = (
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string,
  totalBudget: number
) => {
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  const daysInPeriod = differenceInDays(end, start) + 1;

  // Avoid division by zero
  if (daysInPeriod <= 0) return [];

  const idealDailyBurn = totalBudget / daysInPeriod;

  const data = [];
  let cumulativeSpent = 0;

  for (let i = 0; i < daysInPeriod; i++) {
    const currentDate = addDays(start, i);
    const dateStr = format(currentDate, 'yyyy-MM-dd');

    // Stop plotting "actual" line if date is in future
    // We check if the start of the day is after "now"
    if (isAfter(currentDate, new Date())) {
      // We still want to include the ideal pacing for the whole period?
      // Recharts handles missing data keys by breaking the line.
      // But here we are pushing objects to the array.
      // If we break the loop, we won't have the ideal line for future dates.
      // So we should continue the loop but maybe put null for 'spent'?

      data.push({
        date: dateStr,
        day: `Day ${i + 1}`,
        spent: null, // Future: no actual data
        budget: totalBudget,
        idealPacing: (i + 1) * idealDailyBurn
      });
      continue;
    }

    const daySpend = transactions
      .filter(t => t.date === dateStr && t.category !== 'Income')
      .reduce((sum, t) => sum + t.amount, 0);

    cumulativeSpent += daySpend;

    data.push({
      date: dateStr,
      day: `Day ${i + 1}`,
      spent: cumulativeSpent,
      budget: totalBudget,
      idealPacing: (i + 1) * idealDailyBurn
    });
  }

  return data;
};
