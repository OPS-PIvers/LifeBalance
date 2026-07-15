import { describe, it, expect } from 'vitest';
import { calculateSafeToSpend, findNextPaycheckDate, sumPendingSpend } from './safeToSpendCalculator';
import { Account, CalendarItem, Transaction, INCOME_CATEGORY } from '@/types/schema';
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

  it('should return checking balance if no currentPeriodId provided', () => {
    const result = calculateSafeToSpend(
      mockAccounts,
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
      lastPaycheckDate
    );

    // 5000 - 150 = 4850
    expect(result).toBe(4850);
  });

  it('should reserve overdue unpaid bills from before the current period (within 1-month lookback)', () => {
    // A still-unpaid bill from the PREVIOUS pay period is money owed — it must
    // subtract, so that approving it later is StS-neutral for the active period.
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
      lastPaycheckDate
    );

    // 5000 - 150 = 4850
    expect(result).toBe(4850);
  });

  it('should ignore unpaid bills older than the 1-month overdue lookback', () => {
    const ancientBillDate = formatIso(subDays(today, 40));
    const items: CalendarItem[] = [
      {
        id: 'b1',
        title: 'Ancient Bill',
        amount: 150,
        date: ancientBillDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(mockAccounts, items, lastPaycheckDate);
    // Outside the lookback window: 5000 - 0 = 5000
    expect(result).toBe(5000);
  });

  it('approving an overdue prior-period bill is StS-neutral for the active period', () => {
    const oldBillDate = formatIso(subDays(today, 2));
    const unpaidItems: CalendarItem[] = [
      { id: 'b1', title: 'Old Bill', amount: 150, date: oldBillDate, type: 'expense', isPaid: false }
    ];

    const before = calculateSafeToSpend(mockAccounts, unpaidItems, lastPaycheckDate);

    // Paying it: bill flips to isPaid and the checking balance drops by the amount.
    const paidItems: CalendarItem[] = [{ ...unpaidItems[0]!, isPaid: true }];
    const accountsAfter: Account[] = mockAccounts.map(a =>
      a.id === '1' ? { ...a, balance: a.balance - 150 } : a
    );
    const after = calculateSafeToSpend(accountsAfter, paidItems, lastPaycheckDate);

    expect(before).toBe(4850); // 5000 - 150 owed
    expect(after).toBe(before); // reserve released exactly as the cash left
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
      lastPaycheckDate
    );

    // 5000 - 0 = 5000
    expect(result).toBe(5000);
  });

  // NEW TEST CASE: Verify boundary of searchWindow vs rangeEndDate
  it('should ignore bills after the next paycheck but within the search window', () => {
    // nextPaycheck is day 14. searchWindow extends to day 60.
    // Bill at day 30 should be ignored.
    const wayFutureBillDate = formatIso(addDays(today, 30));

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
        title: 'Way Future Bill',
        amount: 150,
        date: wayFutureBillDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      lastPaycheckDate
    );

    // 5000 - 0 = 5000 (Should ignore the 150 bill)
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
      lastPaycheckDate
    );

    expect(result).toBe(5000);
  });

  // Plan 016: buckets are a pure tracking overlay and NEVER reduce Safe-to-Spend,
  // so a bill whose title matches a bucket name is subtracted like any other
  // unpaid bill (no bill↔bucket exclusion). This replaces the old
  // "should exclude bills covered by buckets" suite, which asserted the reverse.
  it('subtracts an unpaid bill even when its title matches a bucket name (no bucket exclusion)', () => {
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
        title: 'Rent Payment', // Would have matched a "Rent" bucket under the old rules
        amount: 2000,
        date: billDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      lastPaycheckDate
    );

    // 5000 - 2000 (rent bill still subtracts) = 3000
    expect(result).toBe(3000);
  });

  it('subtracts an unpaid bill that carries an explicit bucketId (no bucket exclusion)', () => {
    // Even a bill explicitly tagged to a bucket via bucketId now subtracts —
    // buckets never reserve against Safe-to-Spend (Plan 016).
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
        title: 'Monthly Housing Payment',
        amount: 1800,
        date: billDate,
        type: 'expense',
        isPaid: false,
        bucketId: 'rent-bucket-id'
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      lastPaycheckDate
    );

    // 5000 - 1800 = 3200 (bucketId no longer excludes the bill)
    expect(result).toBe(3200);
  });

  it('should handle bills on boundary dates correctly', () => {
    // Logic: On or after lastPaycheckDate (Inclusive) AND before or equal to nextPaycheckDate (Inclusive)
    // An unpaid bill due on payday itself is still owed and must subtract.

    const onStartBillDate = lastPaycheckDate; // Should be INCLUDED (Inclusive start)
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
      lastPaycheckDate
    );

    // 5000 - 100 (Start Bill) - 200 (End Bill) = 4700.
    expect(result).toBe(4700);
  });

  it('subtracts multiple unpaid bills dated exactly on the paycheck date', () => {
    // Regression: bills sharing the paycheck's date were excluded by an
    // exclusive lower bound, dangerously inflating Safe-to-Spend on payday.
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
        title: 'Car Payment',
        amount: 498,
        date: lastPaycheckDate,
        type: 'expense',
        isPaid: false
      },
      {
        id: 'b2',
        title: 'HELOC Payment',
        amount: 400,
        date: lastPaycheckDate,
        type: 'expense',
        isPaid: false
      },
      {
        id: 'b3',
        title: 'Paid Same-Day Bill',
        amount: 999,
        date: lastPaycheckDate,
        type: 'expense',
        isPaid: true // paid bills still excluded
      }
    ];

    const result = calculateSafeToSpend(mockAccounts, items, lastPaycheckDate);

    // 5000 - 498 - 400 = 4102
    expect(result).toBe(4102);
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
      startOfMonthDate
    );

    // 5000 - 100 = 4900. Only bill inside month is counted.
    expect(result).toBe(4900);
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
      ''
    );

    // 1000 + 2000 = 3000
    expect(result).toBe(3000);
  });

  // --- Pending transaction tests ---

  it('(a) a current-period pending_review transaction reduces STS by its amount', () => {
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
        amount: 100,
        date: billDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const transactions: Transaction[] = [
      {
        id: 'tx1',
        amount: 75,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: lastPaycheckDate,
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: lastPaycheckDate,
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      lastPaycheckDate,
      transactions
    );

    // 5000 - 100 (bill) - 75 (pending) = 4825
    expect(result).toBe(4825);
  });

  it('(b) a verified transaction does NOT reduce STS (only pending_review does)', () => {
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
        amount: 100,
        date: billDate,
        type: 'expense',
        isPaid: false
      }
    ];

    const transactions: Transaction[] = [
      {
        id: 'tx1',
        amount: 75,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: lastPaycheckDate,
        status: 'verified',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: lastPaycheckDate,
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      lastPaycheckDate,
      transactions
    );

    // 5000 - 100 (bill) - 0 (verified tx not counted) = 4900
    expect(result).toBe(4900);
  });

  it('(c) a pending_review transaction in a different payPeriodId is excluded when currentPeriodId is set', () => {
    const otherPeriodId = formatIso(subDays(today, 14));
    const items: CalendarItem[] = [
      {
        id: 'p1',
        title: 'Next Paycheck',
        amount: 2000,
        date: nextPaycheckDate,
        type: 'income',
        isPaid: false
      }
    ];

    const transactions: Transaction[] = [
      {
        id: 'tx1',
        amount: 200,
        merchant: 'Old Period Store',
        category: 'Groceries',
        date: otherPeriodId,
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: otherPeriodId, // Different period — should be excluded
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      items,
      lastPaycheckDate,
      transactions
    );

    // 5000 - 0 (no bills) - 0 (pending from different period excluded) = 5000
    expect(result).toBe(5000);
  });

  it('(d) no transactions → result unchanged from before (regression guard)', () => {
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
        amount: 300,
        date: billDate,
        type: 'expense',
        isPaid: false
      }
    ];

    // Call with no transactions arg (default) and with empty array — both should be identical
    const resultNoArg = calculateSafeToSpend(mockAccounts, items, lastPaycheckDate);
    const resultEmptyArr = calculateSafeToSpend(mockAccounts, items, lastPaycheckDate, []);

    // 5000 - 300 = 4700
    expect(resultNoArg).toBe(4700);
    expect(resultEmptyArr).toBe(4700);
  });

  it('pending_review transaction included when no currentPeriodId (all-period mode)', () => {
    // When currentPeriodId is empty, ALL pending_review transactions are counted
    // regardless of their payPeriodId.
    const transactions: Transaction[] = [
      {
        id: 'tx1',
        amount: 150,
        merchant: 'Restaurant',
        category: 'Dining',
        date: lastPaycheckDate,
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: lastPaycheckDate,
      }
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      [],
      '', // no currentPeriodId
      transactions
    );

    // 5000 - 150 (pending, included because no period filter) = 4850
    expect(result).toBe(4850);
  });

  it('(f) a pending_review INCOME transaction does NOT reduce STS', () => {
    // Income is money coming IN; a pending deposit must never be subtracted
    // from the checking balance (regression guard for the income-exclusion fix).
    const transactions: Transaction[] = [
      {
        id: 'income-tx',
        amount: 2000,
        merchant: 'Employer',
        category: INCOME_CATEGORY,
        date: lastPaycheckDate,
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: lastPaycheckDate,
      },
      {
        id: 'expense-tx',
        amount: 60,
        merchant: 'Coffee Shop',
        category: 'Dining',
        date: lastPaycheckDate,
        status: 'pending_review',
        isRecurring: false,
        source: 'manual',
        autoCategorized: false,
        payPeriodId: lastPaycheckDate,
      },
    ];

    const result = calculateSafeToSpend(
      mockAccounts,
      [],
      lastPaycheckDate,
      transactions
    );

    // 5000 - 60 (pending expense only; the 2000 pending income is excluded) = 4940
    expect(result).toBe(4940);
  });
});

// ===========================================================================
// VERIFIED-ONLY BALANCE MODEL (Plan 015 — "Option A"; was the pending
// double-count characterization).
//
// The calculator subtracts `pendingSpend` ON THE ASSUMPTION that the manually-
// entered checking balance does NOT already reflect pending_review spend
// (safeToSpendCalculator.ts:sumPendingSpend). Plan 015 adopted Option A and
// fixed the WRITE side to honor that assumption: a pending_review transaction
// NEVER debits the checking balance (addTransaction no longer pre-debits
// pending; the debit happens only when the txn is verified — see
// contexts/FirebaseHouseholdContext.tsx and its verified-only tests). The pure
// calculator math here is UNCHANGED — it still subtracts pending exactly once —
// so with the write side fixed the end-to-end number is now correct.
//
// The first two tests below were previously pinned to the BUGGY double-count;
// they are now converted to assert the CORRECT Option-A behavior. The voice
// tests pin a SEPARATE, still-open bug (the voice path omits payPeriodId, so a
// tracked-period voice expense is invisible to pendingSpend) — its no-debit
// behavior is now CORRECT under Option A; only the missing payPeriodId remains.
// Full analysis: plans/015-money-model-investigation.md.
// ===========================================================================
describe('verified-only balance model (Plan 015 — Option A)', () => {
  const lastPaycheckDate = '2026-06-01';
  const nextPaycheckDate = '2026-06-15';
  const INITIAL_BALANCE = 5000;
  const BILL = 100;
  const PENDING = 75;

  const incomeAndBill: CalendarItem[] = [
    { id: 'p', title: 'Next Paycheck', amount: 2000, date: nextPaycheckDate, type: 'income', isPaid: false },
    { id: 'b', title: 'Utility Bill', amount: BILL, date: '2026-06-05', type: 'expense', isPaid: false },
  ];

  const checking = (balance: number): Account[] => [
    { id: 'c', name: 'Checking', type: 'checking', balance, lastUpdated: '' },
  ];

  const pendingTx = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 'tx-pending',
    amount: PENDING,
    merchant: 'Coffee Shop',
    category: 'Dining',
    date: lastPaycheckDate,
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    payPeriodId: lastPaycheckDate,
    ...overrides,
  });

  it('CORRECT baseline: when the balance does NOT include the pending debit, pending is subtracted exactly once', () => {
    // The calculator's model (now honored by the write side under Option A): the
    // manually-entered balance excludes pending spend.
    const result = calculateSafeToSpend(
      checking(INITIAL_BALANCE), incomeAndBill, lastPaycheckDate, [pendingTx()],
    );
    // 5000 - 100 (bill) - 75 (pending, once) = 4825
    expect(result).toBe(INITIAL_BALANCE - BILL - PENDING); // 4825
  });

  it('Option A (fixed): a pending_review capture does NOT debit checking, so it is counted EXACTLY ONCE (no double-count)', () => {
    // Was the pinned DOUBLE-COUNT bug. Under Option A addTransaction no longer
    // pre-debits a pending_review transaction (see the verified-only tests in
    // contexts/FirebaseHouseholdContext.test.tsx), so the balance the calculator
    // receives still equals the un-debited INITIAL_BALANCE...
    const balanceAfterAddPendingTransaction = INITIAL_BALANCE; // 5000 — NOT debited
    // ...and the same pending txn is passed to the calculator, subtracted once.
    const result = calculateSafeToSpend(
      checking(balanceAfterAddPendingTransaction), incomeAndBill, lastPaycheckDate, [pendingTx()],
    );
    // 5000 - 100 (bill) - 75 (pending, ONCE) = 4825 — identical to the baseline.
    // The pending amount is counted exactly once; the prior 75-too-low result is
    // gone now that pending no longer debits the balance.
    expect(result).toBe(INITIAL_BALANCE - BILL - PENDING); // 4825
  });

  it('Option A: once that same pending capture is VERIFIED, the debit lands in the balance and pending drops out — still counted once', () => {
    // After verification the write side debits checking by the amount AND the
    // transaction leaves pendingSpend (status verified). Net effect on
    // Safe-to-Spend is unchanged from the pending state: the spend is reflected
    // exactly once across the txn's whole lifetime.
    const balanceAfterVerify = INITIAL_BALANCE - PENDING; // 4925 — now debited
    const verifiedTx = pendingTx({ status: 'verified' });
    const result = calculateSafeToSpend(
      checking(balanceAfterVerify), incomeAndBill, lastPaycheckDate, [verifiedTx],
    );
    // 4925 - 100 (bill) - 0 (verified => excluded from pendingSpend) = 4825.
    expect(result).toBe(INITIAL_BALANCE - BILL - PENDING); // 4825
  });

  it('SEPARATE BUG (invisible): a voice expense that omits payPeriodId vanishes from Safe-to-Spend when a period is tracked', () => {
    // voice handleExpense writes pending_review and does NOT debit the balance —
    // which is now CORRECT under Option A (a pending capture should not debit).
    // The REMAINING bug is unrelated to the balance: it also omits payPeriodId,
    // and pendingSpend filters by payPeriodId === currentPeriodId, so an
    // undefined payPeriodId is excluded. The voice path's defining trait for THIS
    // (still-open) bug is the MISSING payPeriodId. (Its raw addDoc also writes
    // source:'voice', a value not in the Transaction.source union — an incidental
    // schema gap, immaterial here.)
    const voiceExpense = pendingTx({ id: 'tx-voice', payPeriodId: undefined });
    const result = calculateSafeToSpend(
      checking(INITIAL_BALANCE), incomeAndBill, lastPaycheckDate, [voiceExpense],
    );
    // 5000 - 100 (bill) - 0 (voice expense EXCLUDED) = 4900. The real $75 voice
    // spend is invisible -> Safe-to-Spend overstated by 75. Pinning current
    // behavior; the remaining fix is for the voice path to set payPeriodId.
    expect(result).toBe(INITIAL_BALANCE - BILL); // 4900
  });

  it('the voice expense IS counted (once) when no pay period is tracked', () => {
    // With currentPeriodId empty, pendingSpend ignores payPeriodId and counts all
    // pending_review, so the voice expense is correctly subtracted once. (This is
    // why the bug only manifests once paycheck tracking is enabled.)
    // The voice path's defining trait for this bug is the MISSING payPeriodId.
    // (Its raw addDoc also writes source:'voice', a value not in the
    // Transaction.source union — an incidental schema gap, immaterial here.)
    const voiceExpense = pendingTx({ id: 'tx-voice', payPeriodId: undefined });
    const result = calculateSafeToSpend(
      checking(INITIAL_BALANCE), [], '', [voiceExpense],
    );
    // No period -> full balance minus pending (once): 5000 - 75 = 4925
    expect(result).toBe(INITIAL_BALANCE - PENDING); // 4925
  });
});

describe('sumPendingSpend — account-aware exclusion', () => {
  const accounts: Account[] = [
    { id: 'chk', name: 'Checking', type: 'checking', balance: 5000, lastUpdated: '' },
    { id: 'sav', name: 'Savings', type: 'savings', balance: 10000, lastUpdated: '' },
    { id: 'cc', name: 'Visa', type: 'credit', balance: 200, lastUpdated: '' },
  ];

  const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 'tx',
    amount: 50,
    merchant: 'Shop',
    category: 'Groceries',
    date: '2026-06-10',
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    payPeriodId: '2026-06-01',
    ...overrides,
  });

  it('counts an untagged pending transaction (legacy behavior)', () => {
    expect(sumPendingSpend([tx({ accountId: undefined })], '2026-06-01', accounts)).toBe(50);
  });

  it('counts a pending transaction tagged to a checking account', () => {
    expect(sumPendingSpend([tx({ accountId: 'chk' })], '2026-06-01', accounts)).toBe(50);
  });

  it('excludes a pending transaction tagged to a credit account', () => {
    expect(sumPendingSpend([tx({ accountId: 'cc' })], '2026-06-01', accounts)).toBe(0);
  });

  it('excludes a pending transaction tagged to a savings account', () => {
    expect(sumPendingSpend([tx({ accountId: 'sav' })], '2026-06-01', accounts)).toBe(0);
  });

  it('still excludes income and verified transactions', () => {
    expect(sumPendingSpend([tx({ category: INCOME_CATEGORY })], '2026-06-01', accounts)).toBe(0);
    expect(sumPendingSpend([tx({ status: 'verified' })], '2026-06-01', accounts)).toBe(0);
  });

  it('with no accounts arg, untagged still counts (backward compatible)', () => {
    expect(sumPendingSpend([tx({ accountId: undefined })], '2026-06-01')).toBe(50);
  });

  it('with no accounts arg, a tagged tx also counts (cold-load fallback, no spurious exclusion)', () => {
    // accounts unknown ⇒ account-agnostic filtering, so a tagged pending tx is
    // NOT dropped (which would transiently spike Safe-to-Spend during load).
    expect(sumPendingSpend([tx({ accountId: 'cc' })], '2026-06-01')).toBe(50);
    expect(sumPendingSpend([tx({ accountId: 'cc' })], '2026-06-01', [])).toBe(50);
  });

  it('a pending credit charge does not lower Safe-to-Spend', () => {
    const items: CalendarItem[] = [
      { id: 'p', title: 'Next Paycheck', amount: 2000, date: '2026-06-15', type: 'income', isPaid: false },
    ];
    const withCardCharge = calculateSafeToSpend(
      accounts, items, '2026-06-01', [tx({ accountId: 'cc' })],
    );
    const withCheckingCharge = calculateSafeToSpend(
      accounts, items, '2026-06-01', [tx({ accountId: 'chk' })],
    );
    // Credit charge leaves the full 5000 checking; checking charge subtracts 50.
    expect(withCardCharge).toBe(5000);
    expect(withCheckingCharge).toBe(4950);
  });
});

describe('F-MONEY-08 — archived accounts excluded from Safe-to-Spend', () => {
  const accountsWithArchivedChecking: Account[] = [
    { id: 'chk', name: 'Checking', type: 'checking', balance: 5000, lastUpdated: '' },
    { id: 'old-chk', name: 'Old Checking', type: 'checking', balance: 10000, lastUpdated: '', archived: true },
  ];

  const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 'tx',
    amount: 50,
    merchant: 'Shop',
    category: 'Groceries',
    date: '2026-06-10',
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    payPeriodId: '2026-06-01',
    ...overrides,
  });

  it('excludes an archived checking account balance from Safe-to-Spend', () => {
    const sts = calculateSafeToSpend(accountsWithArchivedChecking, [], '', []);
    // Only the active $5000 checking account counts; the archived $10000
    // account's stale balance must not keep inflating Safe-to-Spend.
    expect(sts).toBe(5000);
  });

  it('excludes a pending transaction tagged to an archived checking account', () => {
    expect(
      sumPendingSpend([tx({ accountId: 'old-chk' })], '2026-06-01', accountsWithArchivedChecking)
    ).toBe(0);
  });

  it('still counts a pending transaction tagged to an active checking account', () => {
    expect(
      sumPendingSpend([tx({ accountId: 'chk' })], '2026-06-01', accountsWithArchivedChecking)
    ).toBe(50);
  });
});
