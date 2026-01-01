import { Account, CalendarItem, BudgetBucket, Transaction } from '@/types/schema';
import { startOfToday, endOfMonth, parseISO, isAfter, isBefore } from 'date-fns';
import { calculateBucketSpent } from './bucketSpentCalculator';

/**
 * Calculate the safe-to-spend amount based on checking balance, unpaid bills, and bucket liabilities
 * This is the primary financial health metric for the household
 *
 * Formula: Checking Balance - (Unpaid Bills + Bucket Liabilities)
 *
 * @param accounts - All household accounts
 * @param calendarItems - All calendar items (bills/income)
 * @param buckets - All budget buckets
 * @param transactions - All transactions
 * @param currentPeriodId - Current pay period ID (YYYY-MM-DD), or empty string for all-time calculation
 * @returns The safe-to-spend amount
 */
export const calculateSafeToSpend = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  buckets: BudgetBucket[],
  transactions: Transaction[],
  currentPeriodId: string = ''
): number => {
  // 1. Available Checking Balance (Assets)
  // STRICT: Only Checking. No Savings, No Credit.
  const checkingBalance = accounts
    .filter(a => a.type === 'checking')
    .reduce((sum, a) => sum + a.balance, 0);

  // 2. Liabilities (Unpaid Bills for rest of month)
  const today = startOfToday();
  const endOfMonthDate = endOfMonth(today);

  const unpaidBills = calendarItems
    .filter(item => {
      const itemDate = parseISO(item.date);

      // Exclude bills likely covered by buckets to avoid double-counting liability
      const isCoveredByBucket = buckets.some(b =>
        item.title.toLowerCase().includes(b.name.toLowerCase()) ||
        b.name.toLowerCase().includes(item.title.toLowerCase())
      );

      return (
        item.type === 'expense' &&
        !item.isPaid &&
        (isAfter(itemDate, today) || itemDate.getTime() === today.getTime()) && // Future or today
        (isBefore(itemDate, endOfMonthDate) || itemDate.getTime() === endOfMonthDate.getTime()) && // Within this month
        !isCoveredByBucket // EXCLUDE IF COVERED
      );
    })
    .reduce((sum, item) => sum + item.amount, 0);

  // 3. Bucket Liabilities (Remaining Limit)
  // This represents money "earmarked" for specific categories.
  // Calculate bucket spent amounts from transactions (period-aware if currentPeriodId is set)
  const bucketSpentMap = calculateBucketSpent(buckets, transactions, currentPeriodId);

  const bucketLiabilities = buckets.reduce((sum, bucket) => {
    const spent = bucketSpentMap.get(bucket.id)?.verified || 0;
    const remaining = Math.max(0, bucket.limit - spent);
    return sum + remaining;
  }, 0);

  // 4. Pending Spending Adjustment
  // Pending transactions have already reduced 'checkingBalance' (via account balance update in addTransaction)
  // but haven't reduced 'bucketLiabilities' yet (bucket.spent isn't verified).
  // To prevent S2S from dropping "twice", we offset the liability.
  // Only count pending transactions from the current period if period tracking is enabled.
  const pendingSpend = transactions
    .filter(t => {
      const isPending = t.status === 'pending_review';
      const inCurrentPeriod = currentPeriodId ? t.payPeriodId === currentPeriodId : true;
      return isPending && inCurrentPeriod;
    })
    .reduce((sum, t) => sum + t.amount, 0);

  const adjustedBucketLiabilities = Math.max(0, bucketLiabilities - pendingSpend);

  // Final Calculation: Checking - Bills - Buckets
  return checkingBalance - (unpaidBills + adjustedBucketLiabilities);
};
