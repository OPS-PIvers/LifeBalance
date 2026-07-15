import { Account, CalendarItem, Transaction, INCOME_CATEGORY } from '@/types/schema';
import { endOfMonth, parseISO, isAfter, isBefore, addMonths, subMonths } from 'date-fns';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { sumMoney, subtractMoney } from '@/utils/money';

/**
 * How far BEFORE the current paycheck the formula still reserves unpaid
 * (overdue) bills. Matches the Action Queue's 1-month overdue lookback
 * (hooks/useActionQueue.ts): any bill the queue nags about as owed is money
 * that must not read as spendable. Reserving it here also makes approving an
 * overdue bill from a PREVIOUS pay period StS-neutral for the ACTIVE period —
 * the bill leaves `unpaidBills` in the same moment the checking balance drops,
 * instead of the new period's Safe-to-Spend absorbing an old period's bill.
 * Callers that pre-expand calendar items must expand from at least this far
 * back (see calculateSafeToSpendExpansionStart).
 */
export const SAFE_TO_SPEND_OVERDUE_LOOKBACK_MONTHS = 1;

/**
 * Start of the calendar-expansion window the Safe-to-Spend formula needs:
 * one month before the current paycheck, so overdue unpaid bills from the
 * previous period are visible to the calculation.
 */
export const calculateSafeToSpendExpansionStart = (paycheckA: Date): Date =>
  subMonths(paycheckA, SAFE_TO_SPEND_OVERDUE_LOOKBACK_MONTHS);

/**
 * Helper to find the next unpaid income item after a given date from a list of expanded items.
 *
 * @param expandedItems - Pre-expanded calendar items
 * @param afterDate - Date to search after (exclusive)
 * @returns The date of the next unpaid paycheck, or null if none found
 */
function findNextPaycheckFromExpanded(
  expandedItems: CalendarItem[],
  afterDate: Date
): string | null {
  const upcomingPaychecks = expandedItems
    // ⚡ Bolt Optimization: Map first to parse date ONCE, avoiding redundant parseISO calls
    // during filter and sort (which calls it 2x per comparison).
    .map(item => ({
      item,
      itemDate: parseISO(item.date),
    }))
    .filter(({ item, itemDate }) => {
      return (
        item.type === 'income' &&
        !item.isPaid &&
        isAfter(itemDate, afterDate)
      );
    })
    .sort((a, b) => a.itemDate.getTime() - b.itemDate.getTime())
    .map(({ item }) => item);

  // upcomingPaychecks[0] is defined: the length > 0 guard above ensures non-empty.
  return upcomingPaychecks.length > 0 ? upcomingPaychecks[0]!.date : null;
}

/**
 * Helper to calculate unpaid bills within a date range.
 *
 * Plan 016: buckets and the calendar are separate domains — buckets are a
 * pure tracking overlay and never reserve against Safe-to-Spend, so EVERY
 * unpaid bill in range subtracts (no bill↔bucket exclusion). See the drawer at
 * components/budget/SafeToSpendBreakdownDrawer.tsx for the pool/overlay model.
 *
 * @param expandedItems - Pre-expanded calendar items
 * @param startDate - Start of the range (inclusive)
 * @param endDate - End of the range (inclusive)
 * @returns Total amount of unpaid bills in range
 */
function calculateUnpaidBillsInRange(
  expandedItems: CalendarItem[],
  startDate: Date,
  endDate: Date
): number {
  const billsInRange = expandedItems.filter(item => {
    const itemDate = parseISO(item.date);

    return (
      item.type === 'expense' &&
      !item.isPaid &&
      // INCLUSIVE start: an unpaid bill due on payday itself is still owed and
      // must subtract — an exclusive bound here silently inflated Safe-to-Spend
      // by every bill sharing the paycheck's date.
      !isBefore(itemDate, startDate) &&
      !isAfter(itemDate, endDate) // Up to range end (inclusive)
    );
  });

  // Sum in integer cents to avoid floating-point drift across many bills.
  return sumMoney(billsInRange.map(item => item.amount));
}

/**
 * Find the date of the next unpaid paycheck (income calendar item)
 * after the given paycheck date.
 *
 * @param calendarItems - All calendar items from the database
 * @param lastPaycheckDate - The most recent paycheck date (Paycheck A)
 * @returns The date of the next unpaid paycheck, or null if none found
 */
export function findNextPaycheckDate(
  calendarItems: CalendarItem[],
  lastPaycheckDate: string
): string | null {
  const parsedLastPaycheckDate = parseISO(lastPaycheckDate);
  const searchWindowEnd = addMonths(parsedLastPaycheckDate, 2); // 60-day search window
  const expandedItems = expandCalendarItems(
    calendarItems,
    parsedLastPaycheckDate,
    searchWindowEnd
  );

  return findNextPaycheckFromExpanded(expandedItems, parsedLastPaycheckDate);
}

/**
 * Calculate the safe-to-spend amount using pre-expanded calendar items.
 * Separating expansion from calculation allows for better performance optimization
 * (memoizing the expansion step) in React contexts.
 *
 * @param accounts - All household accounts
 * @param allExpandedItems - Pre-expanded calendar items (should cover at least 2 months from currentPeriodId)
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD)
 * @param transactions - Optional household transactions; pending_review ones are subtracted
 */
export const calculateSafeToSpendFromExpanded = (
  accounts: Account[],
  allExpandedItems: CalendarItem[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): number =>
  // Delegate to the breakdown so the number and its itemization can never
  // diverge — there is exactly one place the formula lives.
  calculateSafeToSpendBreakdownFromExpanded(accounts, allExpandedItems, currentPeriodId, transactions)
    .safeToSpend;

/**
 * Itemized breakdown behind the safe-to-spend number, for display in the UI.
 */
export interface SafeToSpendBreakdown {
  /** Sum of checking-account balances (the only funds counted as available). */
  checkingBalance: number;
  /**
   * Unpaid bills from the overdue lookback (1 month before this paycheck)
   * through the next paycheck (Plan 016: all unpaid bills subtract; overdue
   * bills from the previous period stay reserved until actually paid).
   */
  unpaidBills: number;
  /**
   * Sum of current-period pending_review *spend* deducted from available funds.
   * See {@link sumPendingSpend} for the exact rule (income excluded; period-scoped).
   */
  pendingSpend: number;
  /** checkingBalance - unpaidBills - pendingSpend. */
  safeToSpend: number;
  /** Date of the next paycheck bounding the range, or null if none found. */
  nextPaycheckDate: string | null;
}

/**
 * Sum the current-period pending (un-cleared) *spend*.
 *
 * - Only `pending_review` transactions count (verified spend is already
 *   reflected in the manually-entered checking balance).
 * - Income transactions (`category === INCOME_CATEGORY`) are excluded: they are
 *   money coming IN, so subtracting them would wrongly lower safe-to-spend.
 *   This mirrors how income is excluded from spend totals elsewhere
 *   (e.g. BudgetBuckets, bucketSpentCalculator).
 * - When `currentPeriodId` is set, only transactions in that pay period count;
 *   otherwise all pending_review spend counts. (Matches bucketSpentCalculator.)
 * - A transaction tagged to a NON-checking account (savings/credit) is excluded:
 *   it does not draw down liquid checking cash, so it must not reduce
 *   Safe-to-Spend. Untagged transactions (no `accountId`) keep legacy behavior
 *   and count as checking spend. Pass `accounts` so checking ids can be
 *   resolved; with no accounts only the account-agnostic filters apply (the
 *   only production caller always passes accounts).
 *
 * Exported so display surfaces (e.g. the Money → Overview Safe-to-Spend detail)
 * can itemize the same value the canonical formula subtracts — one rule, one
 * source of truth.
 */
export const sumPendingSpend = (
  transactions: Transaction[],
  currentPeriodId: string = '',
  accounts: Account[] = []
): number => {
  const checkingIds = new Set(
    accounts.filter(a => a.type === 'checking' && !a.archived).map(a => a.id)
  );
  return sumMoney(
    transactions
      .filter(tx => {
        if (tx.status !== 'pending_review') return false;
        if (tx.category === INCOME_CATEGORY) return false;
        // A pending charge on a non-checking account (savings/credit) does not
        // reduce liquid checking funds, so it must not lower Safe-to-Spend. Only
        // apply this when accounts are known: if `accounts` is empty (no arg, or
        // a transient cold-load state where transactions arrived before
        // accounts) fall back to account-agnostic filtering so tagged spend
        // isn't wrongly dropped (which would spike Safe-to-Spend).
        if (accounts.length > 0 && tx.accountId && !checkingIds.has(tx.accountId)) return false;
        if (currentPeriodId) return tx.payPeriodId === currentPeriodId;
        return true;
      })
      .map(tx => tx.amount)
  );
};

/**
 * Breakdown variant using pre-expanded calendar items (memo-friendly).
 * This is the single source of truth for the safe-to-spend formula:
 *   safeToSpend = checkingBalance - unpaidBills (this paycheck → next) - pendingSpend.
 *
 * @param transactions - Optional list of household transactions. Only
 *   `pending_review` transactions are counted; when currentPeriodId is set
 *   only those whose payPeriodId matches are included.
 */
export const calculateSafeToSpendBreakdownFromExpanded = (
  accounts: Account[],
  allExpandedItems: CalendarItem[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): SafeToSpendBreakdown => {
  // 1. Available Checking Balance (Assets)
  // STRICT: Only Checking. No Savings, No Credit. Archived accounts (F-MONEY-08)
  // are excluded too — a stale archived-checking balance must not keep
  // counting toward Safe-to-Spend.
  const checkingBalance = sumMoney(
    accounts.filter(a => a.type === 'checking' && !a.archived).map(a => a.balance)
  );

  // 2. Pending spend: current-period pending_review spend (income excluded,
  //    non-checking-tagged excluded).
  const pendingSpend = sumPendingSpend(transactions, currentPeriodId, accounts);

  // 3. Without paycheck tracking, the full checking balance (minus pending) is available.
  if (!currentPeriodId) {
    return {
      checkingBalance,
      unpaidBills: 0,
      pendingSpend,
      safeToSpend: subtractMoney(checkingBalance, pendingSpend),
      nextPaycheckDate: null,
    };
  }

  // 4. Determine the bill date range (Paycheck A to Paycheck B)
  const paycheckA = parseISO(currentPeriodId);
  const paycheckBDate = findNextPaycheckFromExpanded(allExpandedItems, paycheckA);
  // Fallback: end of current month if no next paycheck found.
  const rangeEndDate = paycheckBDate ? parseISO(paycheckBDate) : endOfMonth(paycheckA);

  // 5. Unpaid bills in range — from the overdue lookback (bills from the
  //    previous period still owed) through the next paycheck, inclusive.
  const unpaidBills = calculateUnpaidBillsInRange(
    allExpandedItems,
    calculateSafeToSpendExpansionStart(paycheckA),
    rangeEndDate
  );

  return {
    checkingBalance,
    unpaidBills,
    pendingSpend,
    safeToSpend: subtractMoney(subtractMoney(checkingBalance, unpaidBills), pendingSpend),
    nextPaycheckDate: paycheckBDate,
  };
};

/**
 * Breakdown variant that expands calendar items internally.
 *
 * @param transactions - Optional household transactions; pending_review ones are subtracted
 */
export const calculateSafeToSpendBreakdown = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): SafeToSpendBreakdown => {
  if (!currentPeriodId) {
    return calculateSafeToSpendBreakdownFromExpanded(accounts, [], currentPeriodId, transactions);
  }
  const paycheckA = parseISO(currentPeriodId);
  const searchWindowEnd = addMonths(paycheckA, 2);
  const allExpandedItems = expandCalendarItems(
    calendarItems,
    calculateSafeToSpendExpansionStart(paycheckA),
    searchWindowEnd
  );
  return calculateSafeToSpendBreakdownFromExpanded(accounts, allExpandedItems, currentPeriodId, transactions);
};

/**
 * Calculate the safe-to-spend amount based on checking balance and unpaid bills
 * between paychecks. This is the primary financial health metric for the household.
 *
 * Formula: Checking Balance - Unpaid Bills (from last paycheck to next paycheck) - Pending Spend
 *
 * @param accounts - All household accounts
 * @param calendarItems - All calendar items (bills/income)
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD), or empty string to return full checking balance
 * @param transactions - Optional household transactions; pending_review ones are subtracted
 * @returns The safe-to-spend amount
 */
export const calculateSafeToSpend = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): number => {
  if (!currentPeriodId) {
    return calculateSafeToSpendFromExpanded(accounts, [], currentPeriodId, transactions);
  }

  const paycheckA = parseISO(currentPeriodId);

  // ⚡ Bolt Optimization: Expand items ONCE for the whole window
  // This covers the overdue lookback, the search for the next paycheck
  // (Paycheck B), AND the bills in between — one expansion instead of several.
  const searchWindowEnd = addMonths(paycheckA, 2);
  const allExpandedItems = expandCalendarItems(
    calendarItems,
    calculateSafeToSpendExpansionStart(paycheckA),
    searchWindowEnd
  );

  return calculateSafeToSpendFromExpanded(accounts, allExpandedItems, currentPeriodId, transactions);
};
