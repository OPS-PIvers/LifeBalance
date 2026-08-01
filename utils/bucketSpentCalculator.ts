import { BudgetBucket, Transaction, CREDIT_CARD_CATEGORY, INCOME_CATEGORY } from '@/types/schema';
import { sumMoney } from '@/utils/money';

export interface BucketSpent {
  verified: number;
  pending: number;
}

/**
 * Calculate spent amounts for all buckets based on transactions
 * Returns a map of bucket ID to {verified, pending} amounts
 * @param buckets - All budget buckets
 * @param transactions - All transactions
 * @param currentPeriodId - Current pay period ID (YYYY-MM-DD), or empty string for all time
 * @returns Map of bucket ID to spent amounts
 */
export function calculateBucketSpent(
  buckets: BudgetBucket[],
  transactions: Transaction[],
  currentPeriodId: string
): Map<string, BucketSpent> {
  const spentMap = new Map<string, BucketSpent>();

  // Initialize all buckets with zero spending
  buckets.forEach(bucket => {
    spentMap.set(bucket.id, { verified: 0, pending: 0 });
  });

  // Filter transactions by period if period tracking is enabled
  const relevantTransactions = currentPeriodId
    ? transactions.filter(tx => tx.payPeriodId === currentPeriodId)
    : transactions; // No period tracking = include all transactions

  // ⚡ Fast bucket lookup by name (case-insensitive) — replaces an
  // O(Buckets * Transactions) search with O(Buckets + Transactions) map lookups.
  //
  // Transactions link to buckets only by their `category` name (the Transaction
  // schema has no bucket-id field), so a name is the only available key. When two
  // buckets share a (case-insensitive) name we cannot disambiguate which one a
  // transaction belongs to, so we map each name to ALL matching bucket ids and
  // credit every one of them. This avoids the previous first-match-only behavior
  // where a duplicate-named bucket silently showed $0.
  const bucketIdsByName = new Map<string, string[]>();
  buckets.forEach(b => {
    const key = b.name.toLowerCase();
    const existing = bucketIdsByName.get(key);
    if (existing) {
      existing.push(b.id);
    } else {
      bucketIdsByName.set(key, [b.id]);
    }
  });

  // Sum up spending per bucket
  relevantTransactions.forEach(tx => {
    if (!tx.category) return; // Skip uncategorized transactions
    if (tx.category === INCOME_CATEGORY) return; // Skip income transactions
    // Credit-card spend never counts toward buckets — even if a bucket happens
    // to be named "Credit Card" (the sentinel is not a bucket category).
    if (tx.category === CREDIT_CARD_CATEGORY) return;

    const bucketIds = bucketIdsByName.get(tx.category.toLowerCase());

    if (!bucketIds) return; // Transaction category doesn't match any bucket

    // Accumulate in integer cents to avoid floating-point drift; converted back
    // to dollars once at the end. (e.g. 0.1 + 0.2 must not become 0.30000000000000004)
    const cents = Math.round(tx.amount * 100);

    bucketIds.forEach(bucketId => {
      // spentMap is initialized from buckets, so every id here is present.
      const currentSpent = spentMap.get(bucketId)!;
      if (tx.status === 'verified') {
        currentSpent.verified += cents;
      } else if (tx.status === 'pending_review') {
        currentSpent.pending += cents;
      }
    });
  });

  // Convert the accumulated cents back to dollars.
  spentMap.forEach(spent => {
    spent.verified = spent.verified / 100;
    spent.pending = spent.pending / 100;
  });

  return spentMap;
}

/**
 * Get all transactions for a specific bucket in a given period
 * @param bucketName - Name of the bucket
 * @param transactions - All transactions
 * @param periodId - Pay period ID (YYYY-MM-DD), or empty string for all time
 * @returns Filtered and sorted transactions (newest first)
 */
export function getTransactionsForBucket(
  bucketName: string,
  transactions: Transaction[],
  periodId: string
): Transaction[] {
  return transactions
    .filter(tx => {
      // Match category (case-insensitive)
      const categoryMatches = tx.category?.toLowerCase() === bucketName.toLowerCase();

      // Match period if period tracking is enabled
      const periodMatches = periodId ? tx.payPeriodId === periodId : true;

      return categoryMatches && periodMatches;
    })
    .sort((a, b) => {
      // Sort by date, newest first
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
}

/**
 * The transactions that actually make up a bucket's `spent` figure — the
 * itemization behind {@link calculateBucketSpent}, newest first.
 *
 * Deliberately narrower than {@link getTransactionsForBucket}: it applies the
 * SAME two exclusions the spent math applies (income, and the credit-card
 * sentinel category), so a list rendered from this can be summed back to the
 * bucket's spent total. `getTransactionsForBucket` keeps its looser
 * category-only matching for the reallocation flow, which needs every row
 * carrying the category regardless of how it scores.
 *
 * Like the spent math, duplicate-named buckets share one list — a transaction
 * links to a bucket only by category NAME, so the two cannot be told apart.
 */
export function getBucketSpendTransactions(
  bucketName: string,
  transactions: Transaction[],
  periodId: string
): Transaction[] {
  return getTransactionsForBucket(bucketName, transactions, periodId).filter(
    tx => tx.category !== INCOME_CATEGORY && tx.category !== CREDIT_CARD_CATEGORY
  );
}

/**
 * Calculate total verified spending across all buckets for a period
 * @param bucketSpentMap - Map from calculateBucketSpent
 * @returns Total verified spending
 */
export function getTotalVerifiedSpending(bucketSpentMap: Map<string, BucketSpent>): number {
  return sumMoney(Array.from(bucketSpentMap.values(), spent => spent.verified));
}

/**
 * Calculate total pending spending across all buckets for a period
 * @param bucketSpentMap - Map from calculateBucketSpent
 * @returns Total pending spending
 */
export function getTotalPendingSpending(bucketSpentMap: Map<string, BucketSpent>): number {
  return sumMoney(Array.from(bucketSpentMap.values(), spent => spent.pending));
}

/**
 * Get bucket spending for a specific bucket
 * @param bucketId - Bucket ID
 * @param bucketSpentMap - Map from calculateBucketSpent
 * @returns Spent amounts or {verified: 0, pending: 0} if not found
 */
export function getBucketSpent(
  bucketId: string,
  bucketSpentMap: Map<string, BucketSpent>
): BucketSpent {
  return bucketSpentMap.get(bucketId) || { verified: 0, pending: 0 };
}
