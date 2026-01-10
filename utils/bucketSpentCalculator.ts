import { BudgetBucket, Transaction } from '@/types/schema';

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

  // ⚡ Bolt Optimization: Create a map for fast bucket lookup by name (case-insensitive)
  // Replaces O(Buckets * Transactions) search with O(Buckets + Transactions) map lookup
  const bucketNameMap = new Map<string, string>();
  buckets.forEach(b => {
    bucketNameMap.set(b.name.toLowerCase(), b.id);
  });

  // Sum up spending per bucket
  relevantTransactions.forEach(tx => {
    if (!tx.category) return; // Skip uncategorized transactions

    const bucketId = bucketNameMap.get(tx.category.toLowerCase());

    if (!bucketId) return; // Transaction category doesn't match any bucket

    const currentSpent = spentMap.get(bucketId);

    if (currentSpent) {
      if (tx.status === 'verified') {
        currentSpent.verified += tx.amount;
      } else if (tx.status === 'pending_review') {
        currentSpent.pending += tx.amount;
      }
    }
  });

  // Round all values to 2 decimal places to prevent floating point errors
  spentMap.forEach(spent => {
    spent.verified = Math.round(spent.verified * 100) / 100;
    spent.pending = Math.round(spent.pending * 100) / 100;
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
 * Calculate total verified spending across all buckets for a period
 * @param bucketSpentMap - Map from calculateBucketSpent
 * @returns Total verified spending
 */
export function getTotalVerifiedSpending(bucketSpentMap: Map<string, BucketSpent>): number {
  return Array.from(bucketSpentMap.values()).reduce(
    (sum, spent) => sum + spent.verified,
    0
  );
}

/**
 * Calculate total pending spending across all buckets for a period
 * @param bucketSpentMap - Map from calculateBucketSpent
 * @returns Total pending spending
 */
export function getTotalPendingSpending(bucketSpentMap: Map<string, BucketSpent>): number {
  return Array.from(bucketSpentMap.values()).reduce(
    (sum, spent) => sum + spent.pending,
    0
  );
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
