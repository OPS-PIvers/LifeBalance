import {
  writeBatch,
  doc,
  deleteField,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Habit } from '@/types/schema';
import { PRESET_HABITS } from '@/data/presetHabits';
import toast from 'react-hot-toast';

/**
 * Check if habit migration is needed
 * Returns true if any habit has a presetId that is NOT in the current PRESET_HABITS list
 * and is not already marked as custom.
 *
 * @param habits - All habits
 * @returns true if migration is needed
 */
export function needsHabitMigration(
  habits: Habit[]
): boolean {
  const presetIds = new Set(PRESET_HABITS.map(h => h.id));

  return habits.some(habit =>
    habit.presetId &&
    !habit.isCustom &&
    !presetIds.has(habit.presetId)
  );
}

/**
 * Migrate orphaned preset habits to custom habits
 * Finds habits with presetIds that no longer exist in PRESET_HABITS
 * and converts them to custom habits (isCustom: true, remove presetId).
 * Handles batching for large datasets (Firestore limit: 500 writes per batch).
 *
 * @param householdId - The household ID
 * @param habits - All habits
 */
export async function migrateOrphanedHabits(
  householdId: string,
  habits: Habit[]
): Promise<void> {
  try {
    const presetIds = new Set(PRESET_HABITS.map(h => h.id));
    const orphanedHabits = habits.filter(habit =>
      habit.presetId && !habit.isCustom && !presetIds.has(habit.presetId)
    );

    if (orphanedHabits.length === 0) return;

    // Process in chunks of 500 to respect Firestore limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < orphanedHabits.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const chunk = orphanedHabits.slice(i, i + CHUNK_SIZE);

      chunk.forEach(habit => {
        const habitRef = doc(db, `households/${householdId}/habits`, habit.id);
        batch.update(habitRef, {
          isCustom: true,
          presetId: deleteField(),
        });
      });

      await batch.commit();
    }

    console.log(`[HabitMigration] Converted ${orphanedHabits.length} orphaned preset habits to custom habits`);

    // User-friendly toast explaining why habits changed (if they noticed)
    toast.success('Your habits have been preserved after an update.');

  } catch (error) {
    console.error('[HabitMigration] Failed to migrate habits:', error);
    // Don't throw, just log, to avoid crashing the app loop
  }
}
