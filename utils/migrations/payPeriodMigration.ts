import {
  collection,
  query,
  getDocs,
  writeBatch,
  doc,
  deleteField,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Transaction, BudgetBucket } from '@/types/schema';
import { getPayPeriodForDate } from '../payPeriodCalculator';

/**
 * One-time migration to assign payPeriodId to existing transactions
 * Call this on app initialization if householdSettings.startDate exists
 * but transactions without payPeriodId are found
 *
 * @param householdId - The household ID
 * @param startDate - Pay period anchor date (YYYY-MM-DD)
 */
export async function migrateTransactionsToPeriods(
  householdId: string,
  startDate: string
): Promise<void> {
  try {
    const txQuery = query(collection(db, `households/${householdId}/transactions`));
    const snapshot = await getDocs(txQuery);

    const batch = writeBatch(db);
    let count = 0;

    snapshot.docs.forEach(docSnapshot => {
      const tx = docSnapshot.data() as Transaction;

      // Only migrate if missing payPeriodId
      if (!tx.payPeriodId) {
        const period = getPayPeriodForDate(tx.date, startDate);
        batch.update(docSnapshot.ref, { payPeriodId: period.periodId });
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`[Migration] Assigned payPeriodId to ${count} transactions`);
    }
  } catch (error) {
    console.error('[Migration] Failed to migrate transactions:', error);
    throw error;
  }
}

/**
 * Migrate buckets to include currentPeriodId and remove deprecated spent field
 *
 * @param householdId - The household ID
 * @param currentPeriodId - Current pay period ID (YYYY-MM-DD)
 */
export async function migrateBucketsToPeriods(
  householdId: string,
  currentPeriodId: string
): Promise<void> {
  try {
    const bucketsQuery = query(collection(db, `households/${householdId}/buckets`));
    const snapshot = await getDocs(bucketsQuery);

    const batch = writeBatch(db);
    let count = 0;

    snapshot.docs.forEach(docSnapshot => {
      const bucket = docSnapshot.data() as BudgetBucket;

      // Only migrate if missing currentPeriodId
      if (!bucket.currentPeriodId) {
        const updates: Record<string, any> = {
          currentPeriodId: currentPeriodId,
          lastResetDate: currentPeriodId,
        };

        // Remove deprecated 'spent' field if it exists
        if ('spent' in bucket) {
          updates.spent = deleteField();
        }

        batch.update(docSnapshot.ref, updates);
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`[Migration] Updated ${count} buckets for period tracking`);
    }
  } catch (error) {
    console.error('[Migration] Failed to migrate buckets:', error);
    throw error;
  }
}

/**
 * Check if migration is needed for a household
 * Returns true if any transactions or buckets are missing period fields
 *
 * @param transactions - All transactions
 * @param buckets - All buckets
 * @returns true if migration is needed
 */
export function needsMigration(
  transactions: Transaction[],
  buckets: BudgetBucket[]
): boolean {
  const transactionsNeedMigration = transactions.some(t => !t.payPeriodId);
  const bucketsNeedMigration = buckets.some(b => !b.currentPeriodId);

  return transactionsNeedMigration || bucketsNeedMigration;
}
