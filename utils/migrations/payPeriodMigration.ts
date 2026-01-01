import {
  collection,
  query,
  getDocs,
  writeBatch,
  doc,
  deleteField,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Transaction, BudgetBucket, Household } from '@/types/schema';
import toast from 'react-hot-toast';

// DEPRECATED: Old date-based period migration - no longer used
// Kept for reference only
export async function migrateTransactionsToPeriods(
  householdId: string,
  startDate: string
): Promise<void> {
  console.warn('[Migration] migrateTransactionsToPeriods is deprecated');
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

/**
 * Migrate from date-based pay periods to paycheck-triggered pay periods
 * Converts payPeriodSettings to lastPaycheckDate
 *
 * @param householdId - The household ID
 * @param oldStartDate - The old payPeriodSettings.startDate value
 */
export async function migrateToPaycheckPeriods(
  householdId: string,
  oldStartDate: string
): Promise<void> {
  try {
    const householdRef = doc(db, `households/${householdId}`);

    // Convert old startDate to lastPaycheckDate and remove old settings
    await updateDoc(householdRef, {
      lastPaycheckDate: oldStartDate,
      payPeriodSettings: deleteField(),
    });

    console.log('[Migration] Converted to paycheck-based period tracking');
    toast.success('Updated to paycheck-based period tracking');
  } catch (error) {
    console.error('[Migration] Failed to migrate to paycheck periods:', error);
    throw error;
  }
}

/**
 * Check if paycheck period migration is needed
 * Returns true if old payPeriodSettings exists but lastPaycheckDate doesn't
 *
 * @param householdSettings - The household settings object
 * @returns true if migration is needed
 */
export function needsPaycheckMigration(householdSettings: any): boolean {
  return !!(householdSettings?.payPeriodSettings?.startDate && !householdSettings?.lastPaycheckDate);
}
