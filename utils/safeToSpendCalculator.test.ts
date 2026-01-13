
import { describe, it, expect } from 'vitest';
import { calculateSafeToSpend, findNextPaycheckDate } from './safeToSpendCalculator';
import { Account, BudgetBucket, CalendarItem, Transaction } from '@/types/schema';
import { addDays, format, subDays } from 'date-fns';

describe('findNextPaycheckDate', () => {
  const today = new Date();
  const formatIso = (d: Date) => format(d, 'yyyy-MM-dd');

  it('should find the next unpaid income item after the last paycheck', () => {
    const lastPaycheckDate = formatIso(today);
    const nextPaycheckDate = formatIso(addDays(today, 14));

    const items: CalendarItem[] = [
      {
        id: '1',
        title: 'Paycheck 1',
        amount: 2000,
        date: lastPaycheckDate,
        type: 'income',
        isPaid: true
      },
      {
        id: '2',
        title: 'Paycheck 2',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      }
    ];

    const result = findNextPaycheckDate(items, lastPaycheckDate);
    expect(result).toBe(nextPaycheckDate);
  });

  it('should return null if no future income exists', () => {
    const lastPaycheckDate = formatIso(today);
    const items: CalendarItem[] = [
      {
        id: '1',
        title: 'Paycheck 1',
        amount: 2000,
        date: lastPaycheckDate,
        type: 'income',
        isPaid: true
      }
    ];

    const result = findNextPaycheckDate(items, lastPaycheckDate);
    expect(result).toBeNull();
  });
});

describe('calculateSafeToSpend', () => {
  const today = new Date();
  const formatIso = (d: Date) => format(d, 'yyyy-MM-dd');
  const lastPaycheckDate = formatIso(today);
  const nextPaycheckDate = formatIso(addDays(today, 14));

  const mockAccounts: Account[] = [
    { id: '1', name: 'Checking', type: 'checking', balance: 5000, lastUpdated: '' },
    { id: '2', name: 'Savings', type: 'savings', balance: 10000, lastUpdated: '' },
  ];

  const mockBuckets: BudgetBucket[] = [
    { id: 'b1', name: 'Rent', limit: 2000, color: 'red', isVariable: false, isCore: true }
  ];

  // Transactions are currently unused in calculation but required by type
  const mockTransactions: Transaction[] = [];

  it('should return checking balance if no currentPeriodId provided', () => {
    const result = calculateSafeToSpend(
      mockAccounts,
      [],
      [],
      mockTransactions,
      ''
    );
    expect(result).toBe(5000);
  });

  it('should deduct unpaid bills between periods', () => {
    const billDate = formatIso(addDays(today, 5));
    const items: CalendarItem[] = [
      {
        id: 'p1',
        title: 'Next Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      },
      {
        id: 'b1',
        title: 'Utility Bill',
        amount: 150,
        date: billDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      mockTransactions,
      lastPaycheckDate
    );

    // 5000 - 150 = 4850
    expect(result).toBe(4850);
  });

  it('should ignore bills before the current period (last paycheck)', () => {
    const oldBillDate = formatIso(subDays(today, 5));
    const items: CalendarItem[] = [
      {
        id: 'p1',
        title: 'Next Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      },
      {
        id: 'b1',
        title: 'Old Bill',
        amount: 150,
        date: oldBillDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      mockTransactions,
      lastPaycheckDate
    );

    // 5000 - 0 = 5000
    expect(result).toBe(5000);
  });

  it('should ignore bills after the next paycheck', () => {
    const futureBillDate = formatIso(addDays(today, 20)); // After next paycheck (day 14)
    const items: CalendarItem[] = [
      {
        id: 'p1',
        title: 'Next Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      },
      {
        id: 'b1',
        title: 'Future Bill',
        amount: 150,
        date: futureBillDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      mockTransactions,
      lastPaycheckDate
    );

    // 5000 - 0 = 5000
    expect(result).toBe(5000);
  });

  it('should ignore paid bills', () => {
    const billDate = formatIso(addDays(today, 5));
    const items: CalendarItem[] = [
      {
        id: 'p1',
        title: 'Next Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      },
      {
        id: 'b1',
        title: 'Paid Bill',
        amount: 150,
        date: billDate,
        type: 'expense',
        isPaid: true
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      mockTransactions,
      lastPaycheckDate
    );

    expect(result).toBe(5000);
  });

  it('should exclude bills covered by buckets', () => {
    const billDate = formatIso(addDays(today, 5));
    const items: CalendarItem[] = [
      {
        id: 'p1',
        title: 'Next Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      },
      {
        id: 'b1',
        title: 'Rent Payment', // Matches "Rent" bucket
        amount: 2000,
        date: billDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      mockBuckets, // Contains "Rent" bucket
      mockTransactions,
      lastPaycheckDate
    );

    // Should ignore the 2000 rent bill because it's covered by bucket
    expect(result).toBe(5000);
  });
});
