import { CalendarItem, Account } from '@/types/schema';
import { addDays, format, isSameDay, parseISO, startOfDay, isBefore, isAfter } from 'date-fns';
import { expandCalendarItems } from '@/utils/calendarRecurrence';

export interface ForecastDataPoint {
  date: string;
  balance: number;
  minBalance: number; // For the day (lowest point)
  events: { title: string; amount: number; type: 'income' | 'expense' | 'simulation' }[];
}

export interface SimulatedTransaction {
  id: string;
  title: string;
  amount: number;
  date: string; // YYYY-MM-DD
  type: 'income' | 'expense';
}

/**
 * Calculates the projected balance for the next N days.
 *
 * @param accounts - List of all accounts
 * @param calendarItems - List of calendar items (recurring templates and one-offs)
 * @param startDate - The starting date for the forecast (usually today)
 * @param daysToForecast - Number of days to project forward (default 30)
 * @param simulatedTransactions - Optional "What If" transactions to include
 * @returns Array of daily forecast data points
 */
export const calculateForecast = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  startDate: Date = new Date(),
  daysToForecast: number = 30,
  simulatedTransactions: SimulatedTransaction[] = []
): ForecastDataPoint[] => {
  // 1. Calculate Initial Checking Balance
  let currentBalance = accounts
    .filter(a => a.type === 'checking')
    .reduce((sum, a) => sum + a.balance, 0);

  // 2. Prepare Date Range
  const start = startOfDay(startDate);
  const end = addDays(start, daysToForecast);

  // 3. Expand Recurring Items for the period
  const expandedItems = expandCalendarItems(calendarItems, start, end);

  // 4. Merge Real Items with Simulated Items
  // We treat simulated items as one-off calendar items
  const allItems = [
    ...expandedItems.map(item => ({
      ...item,
      isSimulation: false
    })),
    ...simulatedTransactions.map(sim => ({
      id: sim.id,
      title: sim.title,
      amount: sim.amount,
      date: sim.date,
      type: sim.type,
      isPaid: false, // Simulated items are always future/unpaid
      isRecurring: false,
      isSimulation: true
    }))
  ];

  const forecast: ForecastDataPoint[] = [];

  // 5. Simulate Day by Day
  for (let i = 0; i < daysToForecast; i++) {
    const currentDay = addDays(start, i);
    const dateStr = format(currentDay, 'yyyy-MM-dd');

    // Find items for this day
    const daysItems = allItems.filter(item =>
      isSameDay(parseISO(item.date), currentDay) && !item.isPaid
    );

    const dailyEvents = daysItems.map(item => ({
      title: item.title,
      amount: item.amount,
      type: (item as any).isSimulation ? 'simulation' as const : item.type
    }));

    // Apply transactions
    // We calculate minBalance to catch intra-day dips if we ordered expenses first
    // But typically we just look at end-of-day balance.
    // To be safer, let's assume worst case: expenses happen before income?
    // Or just end of day. Let's stick to end of day for simplicity,
    // but maybe track the "lowest" point if we process expenses first.

    let dailyMin = currentBalance;

    // Process expenses first to see if we dip
    daysItems.filter(i => i.type === 'expense').forEach(item => {
      currentBalance -= item.amount;
      if (currentBalance < dailyMin) dailyMin = currentBalance;
    });

    // Process income
    daysItems.filter(i => i.type === 'income').forEach(item => {
      currentBalance += item.amount;
    });

    forecast.push({
      date: dateStr,
      balance: currentBalance,
      minBalance: dailyMin,
      events: dailyEvents
    });
  }

  return forecast;
};
