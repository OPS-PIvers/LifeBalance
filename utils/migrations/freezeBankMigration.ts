import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { FreezeBank } from '@/types/schema';
import { format } from 'date-fns';

/**
 * Migrates the legacy freezeBank format to the new enhanced FreezeBank structure
 *
 * Old format: { current: number; accrued: number; lastMonth: string }
 * New format: FreezeBank interface with tokens, history, and rollover tracking
 *
 * @param householdId - The household document ID
 * @param currentData - The existing freezeBank data in old format
 */
export async function migrateFreezeBankToEnhanced(
  householdId: string,
  currentData: { current: number; accrued: number; lastMonth: string }
): Promise<void> {
  const now = new Date();
  const currentMonth = format(now, 'yyyy-MM');
  const currentDate = format(now, 'yyyy-MM-dd');

  // Transform old structure to new structure
  const enhanced: FreezeBank = {
    tokens: Math.min(currentData.current, 3), // Cap at 3 tokens
    maxTokens: 3,
    lastRolloverDate: currentDate,
    lastRolloverMonth: currentMonth,
    history: [
      {
        id: crypto.randomUUID(),
        type: 'rollover',
        amount: Math.min(currentData.current, 3),
        date: currentDate,
        notes: `Migrated from legacy system (original balance: ${currentData.current})`,
        createdAt: new Date().toISOString(),
      }
    ]
  };

  // Update the household document with the new structure
  const householdRef = doc(db, `households/${householdId}`);
  await updateDoc(householdRef, {
    freezeBank: enhanced
  });

  console.log(`[FreezeBank Migration] Household ${householdId} migrated successfully`);
}

/**
 * Checks if freezeBank needs migration by detecting old format
 *
 * @param freezeBank - The freezeBank object from household
 * @returns true if migration is needed
 */
export function needsFreezeBankMigration(
  freezeBank: unknown
): freezeBank is { current: number; accrued: number; lastMonth: string } {
  // Check if it's the old format (has 'current' and 'accrued' fields)
  if (!freezeBank || typeof freezeBank !== 'object') {
    return false;
  }
  const candidate = freezeBank as Record<string, unknown>;
  return (
    typeof candidate.current === 'number' &&
    typeof candidate.accrued === 'number' &&
    typeof candidate.lastMonth === 'string' &&
    !('tokens' in candidate) // New format has 'tokens', not 'current'
  );
}
