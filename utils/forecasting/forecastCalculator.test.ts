import { describe, it, expect } from 'vitest';
import { calculateForecast, SimulatedTransaction } from './forecastCalculator';
import { Account, CalendarItem } from '@/types/schema';
import { addDays, format } from 'date-fns';

describe('calculateForecast', () => {
  const today = new Date();

  const mockAccounts: Account[] = [
    {
      id: 'acc1',
      name: 'Checking',
      type: 'checking',
      balance: 1000,
      lastUpdated: new Date().toISOString()
    },
    {
      id: 'acc2',
      name: 'Savings',
      type: 'savings',
      balance: 5000,
      lastUpdated: new Date().toISOString()
    }
  ];

  const mockCalendarItems: CalendarItem[] = [
    {
      id: 'item1',
      title: 'Salary',
      amount: 2000,
      date: format(addDays(today, 5), 'yyyy-MM-dd'),
      type: 'income',
      isPaid: false,
      isRecurring: false
    },
    {
      id: 'item2',
      title: 'Rent',
      amount: 1500,
      date: format(addDays(today, 10), 'yyyy-MM-dd'),
      type: 'expense',
      isPaid: false,
      isRecurring: false
    }
  ];

  it('projects balance correctly with basic items', () => {
    const forecast = calculateForecast(mockAccounts, mockCalendarItems, today, 15);

    // Day 0-4: Balance should be 1000
    expect(forecast[0].balance).toBe(1000);
    expect(forecast[4].balance).toBe(1000);

    // Day 5: Salary comes in (+2000) -> 3000
    expect(forecast[5].balance).toBe(3000);

    // Day 10: Rent goes out (-1500) -> 1500
    expect(forecast[10].balance).toBe(1500);
  });

  it('handles simulated transactions', () => {
    const simulations: SimulatedTransaction[] = [
      {
        id: 'sim1',
        title: 'New TV',
        amount: 500,
        date: format(addDays(today, 2), 'yyyy-MM-dd'),
        type: 'expense'
      }
    ];

    const forecast = calculateForecast(mockAccounts, [], today, 5, simulations);

    // Day 0-1: 1000
    expect(forecast[0].balance).toBe(1000);

    // Day 2: TV bought (-500) -> 500
    expect(forecast[2].balance).toBe(500);
  });

  it('detects minBalance dips within a day', () => {
    // If we have an expense and income on the same day,
    // and expense happens "first" (in our worst-case logic), minBalance should reflect the dip.

    const sameDayItems: CalendarItem[] = [
      {
        id: 'exp1',
        title: 'Big Bill',
        amount: 1200, // More than balance (1000)
        date: format(today, 'yyyy-MM-dd'),
        type: 'expense',
        isPaid: false,
        isRecurring: false
      },
      {
        id: 'inc1',
        title: 'Paycheck',
        amount: 1500,
        date: format(today, 'yyyy-MM-dd'),
        type: 'income',
        isPaid: false,
        isRecurring: false
      }
    ];

    const forecast = calculateForecast(mockAccounts, sameDayItems, today, 1);

    // End balance: 1000 - 1200 + 1500 = 1300
    expect(forecast[0].balance).toBe(1300);

    // Min balance: 1000 - 1200 = -200 (Dip detected!)
    expect(forecast[0].minBalance).toBe(-200);
  });
});
