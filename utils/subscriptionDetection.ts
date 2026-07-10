/**
 * Pure recurring-charge / subscription detector.
 *
 * Transactions already carry `merchant`, `date`, `amount`, and `category` —
 * this module scans the already-listened transaction history for periodicity
 * and reports merchants that look like a monthly or weekly subscription,
 * without any new Firestore data. See advisor-plans/20-subscription-detection.md.
 *
 * Zero React/Firestore dependencies — pure functions, unit-tested.
 */
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import { INCOME_CATEGORY, type Transaction } from '@/types/schema';
import { merchantSimilar } from '@/utils/transactionIdentity';

/** Minimum consecutive-gap window (days) for a MONTHLY cadence. */
export const MONTHLY_GAP_MIN_DAYS = 28;
/** Maximum consecutive-gap window (days) for a MONTHLY cadence. */
export const MONTHLY_GAP_MAX_DAYS = 33;
/** Minimum occurrences required to call a group MONTHLY. */
export const MONTHLY_MIN_OCCURRENCES = 3;

/** Minimum consecutive-gap window (days) for a WEEKLY cadence. */
export const WEEKLY_GAP_MIN_DAYS = 6;
/** Maximum consecutive-gap window (days) for a WEEKLY cadence. */
export const WEEKLY_GAP_MAX_DAYS = 8;
/** Minimum occurrences required to call a group WEEKLY. */
export const WEEKLY_MIN_OCCURRENCES = 4;

/**
 * Amount stability tolerance: the max amount in a group may not exceed this
 * multiple of the min amount (both compared in integer cents).
 */
const AMOUNT_STABILITY_RATIO = 1.3;

/** Minimum merchant-name token length considered for the existing-bill exclusion match (mirrors safeToSpendCalculator's bucket↔bill token matching). */
const MERCHANT_TOKEN_MIN_MATCH_LENGTH = 3;

export interface DetectedSubscription {
  /** Display merchant — the most frequent raw spelling seen in the group. */
  merchant: string;
  cadence: 'monthly' | 'weekly';
  /** Decimal dollars — cents-safe math internally. */
  averageAmount: number;
  occurrences: number;
  /** yyyy-MM-dd of the most recent occurrence. */
  lastDate: string;
  /** yyyy-MM-dd — lastDate + median gap (days). */
  nextExpectedDate: string;
  transactionIds: string[];
}

type DetectableTransaction = Pick<Transaction, 'id' | 'merchant' | 'amount' | 'date' | 'category'>;

/** Convert a stored (always-positive) dollar amount to integer cents. */
const amountCents = (amount: number): number => Math.round(Math.abs(amount) * 100);

/** Splits a string into lowercase word tokens, stripping punctuation. */
function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 0);
}

/**
 * Whether `merchant` matches one of the existing calendar-bill titles, using
 * whole-word token-window matching (merchant tokens found as a consecutive
 * phrase inside a bill title's tokens) — mirrors
 * `resolveBucketForCalendarItem`'s bucket↔bill approach documented in
 * CLAUDE.md's Safe-to-Spend section. Merchant names shorter than
 * {@link MERCHANT_TOKEN_MIN_MATCH_LENGTH} chars are skipped (too short to
 * match reliably).
 */
function matchesExistingBill(merchant: string, existingBillTitles: string[]): boolean {
  const merchantNormalized = merchant.toLowerCase().trim();
  if (merchantNormalized.length < MERCHANT_TOKEN_MIN_MATCH_LENGTH) return false;

  const merchantTokens = tokenize(merchantNormalized);
  if (merchantTokens.length === 0) return false;

  return existingBillTitles.some(title => {
    const titleTokens = tokenize(title);
    const windowSize = merchantTokens.length;
    for (let i = 0; i <= titleTokens.length - windowSize; i++) {
      const windowMatches = merchantTokens.every((mt, j) => titleTokens[i + j] === mt);
      if (windowMatches) return true;
    }
    return false;
  });
}

/** Median of a sorted (or unsorted) array of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Determine the cadence (and validity) of a date-sorted, same-day-deduped
 * group of occurrences, per the plan's gap rules. Returns `null` when the
 * group doesn't qualify as either cadence.
 */
function classifyCadence(sortedDates: string[]): 'monthly' | 'weekly' | null {
  if (sortedDates.length < MONTHLY_MIN_OCCURRENCES) return null;

  const gaps: number[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = parseISO(sortedDates[i - 1] as string);
    const curr = parseISO(sortedDates[i] as string);
    gaps.push(differenceInCalendarDays(curr, prev));
  }

  const allMonthlyGaps = gaps.every(g => g >= MONTHLY_GAP_MIN_DAYS && g <= MONTHLY_GAP_MAX_DAYS);
  if (allMonthlyGaps && sortedDates.length >= MONTHLY_MIN_OCCURRENCES) return 'monthly';

  const allWeeklyGaps = gaps.every(g => g >= WEEKLY_GAP_MIN_DAYS && g <= WEEKLY_GAP_MAX_DAYS);
  if (allWeeklyGaps && sortedDates.length >= WEEKLY_MIN_OCCURRENCES) return 'weekly';

  return null;
}

/**
 * Scan transaction history for recurring-charge patterns.
 *
 * Algorithm:
 *  1. Only expense-signed transactions (income excluded).
 *  2. Greedy merchant grouping via {@link merchantSimilar} — each transaction
 *     joins the first existing group whose representative (first member)
 *     matches; otherwise it starts a new group.
 *  3. Per group: sort by date, drop same-day duplicates (keep the first),
 *     then classify cadence off the CONSECUTIVE gaps (monthly: ≥3 occurrences,
 *     every gap 28–33 days; weekly: ≥4 occurrences, every gap 6–8 days).
 *  4. Amount stability: max amount ≤ 1.3× min amount within the group (cents).
 *  5. Drop groups whose merchant matches an existing calendar-bill title.
 *  6. `nextExpectedDate` = lastDate + median gap (days).
 */
export function detectSubscriptions(
  transactions: DetectableTransaction[],
  existingBillTitles: string[]
): DetectedSubscription[] {
  const expenseTxns = transactions.filter(t => t.category !== INCOME_CATEGORY);

  // Step 2: greedy merchant grouping.
  const groups: DetectableTransaction[][] = [];
  for (const txn of expenseTxns) {
    const group = groups.find(g => merchantSimilar((g[0] as DetectableTransaction).merchant, txn.merchant));
    if (group) {
      group.push(txn);
    } else {
      groups.push([txn]);
    }
  }

  const results: DetectedSubscription[] = [];

  for (const group of groups) {
    // Sort by date, then dedupe same-day entries (keep the first-seen row per day).
    const sortedByDate = [...group].sort((a, b) => a.date.localeCompare(b.date));
    const dedupedByDay: DetectableTransaction[] = [];
    const seenDates = new Set<string>();
    for (const txn of sortedByDate) {
      if (seenDates.has(txn.date)) continue;
      seenDates.add(txn.date);
      dedupedByDay.push(txn);
    }

    const dates = dedupedByDay.map(t => t.date);
    const cadence = classifyCadence(dates);
    if (!cadence) continue;

    // Amount stability check (integer cents).
    const cents = dedupedByDay.map(t => amountCents(t.amount));
    const minCents = Math.min(...cents);
    const maxCents = Math.max(...cents);
    if (minCents <= 0 || maxCents > minCents * AMOUNT_STABILITY_RATIO) continue;

    // Display merchant: the most frequent raw spelling in the group.
    const merchantCounts = new Map<string, number>();
    for (const txn of dedupedByDay) {
      merchantCounts.set(txn.merchant, (merchantCounts.get(txn.merchant) ?? 0) + 1);
    }
    let displayMerchant = dedupedByDay[0]?.merchant ?? '';
    let bestCount = 0;
    for (const [name, count] of merchantCounts) {
      if (count > bestCount) {
        bestCount = count;
        displayMerchant = name;
      }
    }

    if (matchesExistingBill(displayMerchant, existingBillTitles)) continue;

    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(differenceInCalendarDays(parseISO(dates[i] as string), parseISO(dates[i - 1] as string)));
    }
    const medianGap = Math.round(median(gaps));
    const lastDate = dates[dates.length - 1] as string;
    const nextExpectedDate = format(addDays(parseISO(lastDate), medianGap), 'yyyy-MM-dd');

    const averageAmount = Math.round(cents.reduce((sum, c) => sum + c, 0) / cents.length) / 100;

    results.push({
      merchant: displayMerchant,
      cadence,
      averageAmount,
      occurrences: dedupedByDay.length,
      lastDate,
      nextExpectedDate,
      transactionIds: dedupedByDay.map(t => t.id),
    });
  }

  return results;
}
