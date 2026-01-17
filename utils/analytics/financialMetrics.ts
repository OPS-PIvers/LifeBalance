import { Transaction } from '../../types/schema';
import { differenceInDays, parseISO, addDays, format, isAfter, startOfDay } from 'date-fns';

export const calculateBurnDown = (
  transactions: Transaction[],
  periodStart: string,
  periodEnd: string,
  totalBudget: number
) => {
  const start = parseISO(periodStart);
  const end = parseISO(periodEnd);
  const totalDays = differenceInDays(end, start) + 1;

  // Avoid division by zero
  if (totalDays <= 0) return [];

  const idealDailyBurn = totalBudget / totalDays;

  const data = [];
  let cumulativeSpent = 0;

  for (let i = 0; i < totalDays; i++) {
    const currentDate = addDays(start, i);
    const dateStr = format(currentDate, 'yyyy-MM-dd');

    // Stop plotting "actual" line if date is in future
    // Use startOfDay to compare dates without time components
    if (isAfter(startOfDay(currentDate), startOfDay(new Date()))) {
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
