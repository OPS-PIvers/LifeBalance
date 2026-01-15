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
    const batch = writeBatch(db);
    let count = 0;

    habits.forEach(habit => {
      // Check if this is an orphaned preset habit
      if (habit.presetId && !habit.isCustom && !presetIds.has(habit.presetId)) {
        const habitRef = doc(db, `households/${householdId}/habits`, habit.id);

        batch.update(habitRef, {
          isCustom: true,
          presetId: deleteField(),
          // We can optionally explicitly set fields that might be missing if they were purely relied upon from preset
          // but usually the habit object in DB has copies of title, category, etc.
        });

        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`[HabitMigration] Converted ${count} orphaned preset habits to custom habits`);
      toast.success(`Updated ${count} habits to custom`);
    }
  } catch (error) {
    console.error('[HabitMigration] Failed to migrate habits:', error);
    // Don't throw, just log, to avoid crashing the app loop
  }
}
