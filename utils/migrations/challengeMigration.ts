import { collection, query, getDocs, updateDoc, doc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Challenge } from '@/types/schema';

/**
 * Migrates existing challenges to the enhanced schema
 *
 * Adds new fields while preserving backward compatibility:
 * - targetType: 'count' (default)
 * - targetValue: from existing targetTotalCount
 * - description: empty string
 * - currentValue: 0 (will be calculated by context)
 *
 * @param householdId - The household document ID
 */
export async function migrateChallengesToEnhancedSchema(
  householdId: string
): Promise<void> {
  const challengesQuery = query(collection(db, `households/${householdId}/challenges`));
  const snapshot = await getDocs(challengesQuery);

  let migratedCount = 0;

  for (const docSnapshot of snapshot.docs) {
    const oldData = docSnapshot.data() as Challenge;

    // Check if migration is needed
    if (needsChallengeMigration(oldData)) {
      const updates: Partial<Challenge> = {
        targetType: 'count',
        targetValue: oldData.targetTotalCount || 100, // Use existing value or default
        description: '',
        currentValue: 0, // Will be calculated on first load
      };

      await updateDoc(docSnapshot.ref, updates);
      migratedCount++;
    }
  }

  console.log(`[Challenge Migration] Migrated ${migratedCount} challenges for household ${householdId}`);
}

/**
 * Checks if a challenge needs migration
 *
 * @param challenge - The challenge object to check
 * @returns true if migration is needed
 */
export function needsChallengeMigration(challenge: Challenge): boolean {
  // If targetType and targetValue don't exist, migration is needed
  return !challenge.targetType || !challenge.targetValue;
}

/**
 * Gets the effective target value for a challenge, supporting both old and new formats
 *
 * @param challenge - The challenge object
 * @returns the target value
 */
export function getEffectiveTargetValue(challenge: Challenge): number {
  // Prefer targetValue, fall back to targetTotalCount
  return challenge.targetValue ?? challenge.targetTotalCount ?? 100;
}

/**
 * Gets the effective target type for a challenge, supporting both old and new formats
 *
 * @param challenge - The challenge object
 * @returns the target type
 */
export function getEffectiveTargetType(challenge: Challenge): 'count' | 'percentage' {
  // Default to 'count' if not set
  return challenge.targetType ?? 'count';
}
