import { describe, it, expect } from 'vitest';
import { calculateSafeToSpend, findNextPaycheckDate } from './safeToSpendCalculator';
import { Account, BudgetBucket, CalendarItem } from '@/types/schema';
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

  it('should ignore unpaid income items on or before the last paycheck date', () => {
    const lastPaycheckDate = formatIso(today);
    const pastDate = formatIso(subDays(today, 1));

    const items: CalendarItem[] = [
      {
        id: '1',
        title: 'Old Paycheck',
        amount: 2000,
        date: pastDate,
        type: 'income',
        isPaid: false
      },
      {
        id: '2',
        title: 'Current Paycheck',
        amount: 2000,
        date: lastPaycheckDate,
        type: 'income',
        isPaid: false
      }
    ];

    const result = findNextPaycheckDate(items, lastPaycheckDate);
    expect(result).toBeNull();
  });

  it('should ignore paid income items after the last paycheck date', () => {
    const lastPaycheckDate = formatIso(today);
    const nextPaycheckDate = formatIso(addDays(today, 14));

    const items: CalendarItem[] = [
      {
        id: '1',
        title: 'Paid Future Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
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

  it('should return checking balance if no currentPeriodId provided', () => {
    const result = calculateSafeToSpend(
      mockAccounts,
      [],
      [],
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
      lastPaycheckDate
    );

    // Should ignore the 2000 rent bill because it's covered by bucket
    expect(result).toBe(5000);
  });

  it('should handle bills on boundary dates correctly', () => {
    // Logic: After lastPaycheckDate (Exclusive) AND Before or Equal to nextPaycheckDate (Inclusive)

    const onStartBillDate = lastPaycheckDate; // Should be IGNORED (Exclusive start)
    const onEndBillDate = nextPaycheckDate;   // Should be INCLUDED (Inclusive end)

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
        title: 'Start Boundary Bill',
        amount: 100,
        date: onStartBillDate,
        type: 'expense',
        isPaid: false
      },
      {
        id: 'b2',
        title: 'End Boundary Bill',
        amount: 200,
        date: onEndBillDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      lastPaycheckDate
    );

    // 5000 - 200 (End Bill) = 4800. Start bill (100) is ignored.
    expect(result).toBe(4800);
  });

  it('should ignore income items within the calculation period', () => {
    const incomeDate = formatIso(addDays(today, 5));
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
        id: 'i1',
        title: 'Bonus',
        amount: 500,
        date: incomeDate,
        type: 'income',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      lastPaycheckDate
    );

    // 5000 - 0 = 5000. Income item ignored.
    expect(result).toBe(5000);
  });

  it('should use end of month if no next paycheck is found', () => {
    // If no next paycheck, range ends at endOfMonth(lastPaycheckDate)
    const startOfMonthDate = formatIso(new Date(2025, 0, 1)); // Jan 1 2025
    const midMonthDate = formatIso(new Date(2025, 0, 15));   // Jan 15 2025
    const nextMonthDate = formatIso(new Date(2025, 1, 1));   // Feb 1 2025

    // We mock specific dates here to be deterministic
    const items: CalendarItem[] = [
      {
        id: 'b1',
        title: 'Bill Inside Month',
        amount: 100,
        date: midMonthDate,
        type: 'expense',
        isPaid: false
      },
      {
        id: 'b2',
        title: 'Bill Outside Month',
        amount: 200,
        date: nextMonthDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      startOfMonthDate
    );

    // 5000 - 100 = 4900. Only bill inside month is counted.
    expect(result).toBe(4900);
  });

  it('should handle bucket matching case insensitively', () => {
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
        title: 'rEnT pAyMeNt', // Mixed case, contains "Rent"
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
      lastPaycheckDate
    );

    // Should match "Rent" bucket and be excluded
    expect(result).toBe(5000);
  });

  it('should aggregate multiple unpaid bills', () => {
    const billDate1 = formatIso(addDays(today, 2));
    const billDate2 = formatIso(addDays(today, 4));

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
        title: 'Bill 1',
        amount: 100,
        date: billDate1,
        type: 'expense',
        isPaid: false
      },
      {
        id: 'b2',
        title: 'Bill 2',
        amount: 250,
        date: billDate2,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      [],
      lastPaycheckDate
    );

    // 5000 - 100 - 250 = 4650
    expect(result).toBe(4650);
  });

  it('should aggregate multiple checking accounts', () => {
    const multiAccounts: Account[] = [
      { id: '1', name: 'Checking 1', type: 'checking', balance: 1000, lastUpdated: '' },
      { id: '2', name: 'Checking 2', type: 'checking', balance: 2000, lastUpdated: '' },
      { id: '3', name: 'Savings', type: 'savings', balance: 5000, lastUpdated: '' }
    ];

    const result = calculateSafeToSpend(
      multiAccounts,
      [],
      [],
      ''
    );

    // 1000 + 2000 = 3000
    expect(result).toBe(3000);
  });
});
