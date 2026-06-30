import { Account, CalendarItem, BudgetBucket, Transaction, INCOME_CATEGORY } from '@/types/schema';
import { endOfMonth, parseISO, isAfter, isBefore, addMonths } from 'date-fns';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { sumMoney, subtractMoney } from '@/utils/money';

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
 * Minimum number of characters a bucket name must have for name-based matching
 * to be attempted. Short names like "Co" or "Gas" produce too many false positives
 * against unrelated bill titles (e.g. "Bob's Gasoline Station").
 */
const BUCKET_NAME_MIN_MATCH_LENGTH = 3;

/**
 * Splits a string into lowercase word tokens, stripping punctuation.
 * e.g. "Bob's Gasoline Station" → ["bob", "s", "gasoline", "station"]
 */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 0);
}

/**
 * Determine whether a calendar expense item is covered by any budget bucket.
 *
 * Matching rules (applied in order):
 *  1. EXACT ID MATCH: if the item carries a `bucketId`, compare it directly to
 *     bucket IDs — this is precise and bypasses all name heuristics.
 *  2. WHOLE-WORD NAME MATCH (fallback): the bucket name (normalised to lowercase,
 *     punctuation stripped) must appear as one or more consecutive whole words
 *     inside the bill title's token list.
 *     - Bucket names shorter than BUCKET_NAME_MIN_MATCH_LENGTH characters are
 *       skipped to avoid short tokens ("Co", "Gas") matching unrelated bills.
 *     - Only the bill→bucket direction is checked (bucket name found inside bill
 *       title). The reverse direction (bill title inside bucket name) is dropped
 *       because it is almost always wrong and was the primary source of false
 *       exclusions.
 */
function isBillCoveredByBucket(item: CalendarItem, buckets: BudgetBucket[]): boolean {
  // Strategy 1: precise id-based match (no false positives possible)
  if (item.bucketId !== undefined) {
    return buckets.some(b => b.id === item.bucketId);
  }

  // Strategy 2: whole-word name match
  const titleTokens = tokenize(item.title);

  return buckets.some(bucket => {
    const bucketNormalized = bucket.name.toLowerCase().trim();
    if (bucketNormalized.length < BUCKET_NAME_MIN_MATCH_LENGTH) {
      // Too short to match reliably — skip.
      return false;
    }

    // Tokenize the bucket name so multi-word bucket names (e.g. "Natural Gas")
    // are matched as a phrase inside the bill title tokens.
    const bucketTokens = tokenize(bucketNormalized);
    if (bucketTokens.length === 0) return false;

    // Slide a window of bucketTokens.length over titleTokens and check equality.
    const windowSize = bucketTokens.length;
    for (let i = 0; i <= titleTokens.length - windowSize; i++) {
      const windowMatches = bucketTokens.every((bt, j) => titleTokens[i + j] === bt);
      if (windowMatches) return true;
    }
    return false;
  });
}

/**
 * Helper to calculate unpaid bills within a date range, excluding bucket-covered items.
 *
 * @param expandedItems - Pre-expanded calendar items
 * @param startDate - Start of the range (exclusive)
 * @param endDate - End of the range (inclusive)
 * @param buckets - Budget buckets for exclusion logic
 * @returns Total amount of unpaid bills in range
 */
function calculateUnpaidBillsInRange(
  expandedItems: CalendarItem[],
  startDate: Date,
  endDate: Date,
  buckets: BudgetBucket[]
): number {
  const billsInRange = expandedItems.filter(item => {
    const itemDate = parseISO(item.date);

    // Exclude bills covered by buckets to avoid double-counting.
    // Uses precise id-based matching when available, with whole-word name
    // matching as a fallback. See isBillCoveredByBucket for full rule details.
    const coveredByBucket = isBillCoveredByBucket(item, buckets);

    return (
      item.type === 'expense' &&
      !item.isPaid &&
      isAfter(itemDate, startDate) && // AFTER start date (exclusive)
      (isBefore(itemDate, endDate) || itemDate.getTime() === endDate.getTime()) && // Up to range end (inclusive)
      !coveredByBucket
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
 * @param buckets - All budget buckets
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD)
 * @param transactions - Optional household transactions; pending_review ones are subtracted
 */
export const calculateSafeToSpendFromExpanded = (
  accounts: Account[],
  allExpandedItems: CalendarItem[],
  buckets: BudgetBucket[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): number =>
  // Delegate to the breakdown so the number and its itemization can never
  // diverge — there is exactly one place the formula lives.
  calculateSafeToSpendBreakdownFromExpanded(accounts, allExpandedItems, buckets, currentPeriodId, transactions)
    .safeToSpend;

/**
 * Itemized breakdown behind the safe-to-spend number, for display in the UI.
 */
export interface SafeToSpendBreakdown {
  /** Sum of checking-account balances (the only funds counted as available). */
  checkingBalance: number;
  /** Unpaid bills from this paycheck to the next (bucket-covered bills excluded). */
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
    accounts.filter(a => a.type === 'checking').map(a => a.id)
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
  buckets: BudgetBucket[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): SafeToSpendBreakdown => {
  // 1. Available Checking Balance (Assets)
  // STRICT: Only Checking. No Savings, No Credit.
  const checkingBalance = sumMoney(
    accounts.filter(a => a.type === 'checking').map(a => a.balance)
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

  // 5. Unpaid bills in range (AFTER paycheck A, up to and including range end).
  const unpaidBills = calculateUnpaidBillsInRange(allExpandedItems, paycheckA, rangeEndDate, buckets);

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
  buckets: BudgetBucket[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): SafeToSpendBreakdown => {
  if (!currentPeriodId) {
    return calculateSafeToSpendBreakdownFromExpanded(accounts, [], buckets, currentPeriodId, transactions);
  }
  const paycheckA = parseISO(currentPeriodId);
  const searchWindowEnd = addMonths(paycheckA, 2);
  const allExpandedItems = expandCalendarItems(calendarItems, paycheckA, searchWindowEnd);
  return calculateSafeToSpendBreakdownFromExpanded(accounts, allExpandedItems, buckets, currentPeriodId, transactions);
};

/**
 * Calculate the safe-to-spend amount based on checking balance and unpaid bills
 * between paychecks. This is the primary financial health metric for the household.
 *
 * Formula: Checking Balance - Unpaid Bills (from last paycheck to next paycheck) - Pending Spend
 *
 * @param accounts - All household accounts
 * @param calendarItems - All calendar items (bills/income)
 * @param buckets - All budget buckets (for bill matching only)
 * @param currentPeriodId - Last paycheck date (YYYY-MM-DD), or empty string to return full checking balance
 * @param transactions - Optional household transactions; pending_review ones are subtracted
 * @returns The safe-to-spend amount
 */
export const calculateSafeToSpend = (
  accounts: Account[],
  calendarItems: CalendarItem[],
  buckets: BudgetBucket[],
  currentPeriodId: string = '',
  transactions: Transaction[] = []
): number => {
  if (!currentPeriodId) {
    return calculateSafeToSpendFromExpanded(accounts, [], buckets, currentPeriodId, transactions);
  }

  const paycheckA = parseISO(currentPeriodId);

  // ⚡ Bolt Optimization: Expand items ONCE for a 60-day window
  // This covers the search for the next paycheck (Paycheck B) AND the bills in between.
  // Previously, this function called `findNextPaycheckDate` (which expanded for 60 days)
  // and then called `expandCalendarItems` AGAIN for the determined range.
  // This approach reduces the expensive expansion operation from 2x to 1x.
  const searchWindowEnd = addMonths(paycheckA, 2);
  const allExpandedItems = expandCalendarItems(calendarItems, paycheckA, searchWindowEnd);

  return calculateSafeToSpendFromExpanded(accounts, allExpandedItems, buckets, currentPeriodId, transactions);
};
