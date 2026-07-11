import { writeBatch, doc } from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Habit } from '@/types/schema';
import { normalizeHabitTitle } from '@/utils/habitLogic';

/**
 * One-off client-side backfill (TODO.md §2A) for `Habit.titleLower` — the
 * denormalized field the quickAddHabit Cloud Function uses for an indexed
 * exact-match lookup instead of a full-collection scan. New habits get it from
 * addHabit/updateHabit (hooks/useHabitActions.tsx); this migration patches
 * habits that predate that write.
 *
 * @param habits - All habits
 * @returns true if any habit is missing `titleLower`
 */
export function needsTitleLowerMigration(habits: Habit[]): boolean {
  return habits.some(habit => !habit.titleLower);
}

/**
 * Backfill `titleLower` on every habit doc missing it.
 * Handles batching for large datasets (Firestore limit: 500 writes per batch).
 *
 * @param householdId - The household ID
 * @param habits - All habits
 */
export async function backfillTitleLower(
  householdId: string,
  habits: Habit[]
): Promise<void> {
  try {
    const staleHabits = habits.filter(habit => !habit.titleLower);
    if (staleHabits.length === 0) return;

    // Process in chunks of 500 to respect Firestore limits
    const CHUNK_SIZE = 500;
    for (let i = 0; i < staleHabits.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const chunk = staleHabits.slice(i, i + CHUNK_SIZE);

      chunk.forEach(habit => {
        const habitRef = doc(db, `households/${householdId}/habits`, habit.id);
        batch.update(habitRef, {
          titleLower: normalizeHabitTitle(habit.title),
        });
      });

      await batch.commit();
    }

    console.log(`[TitleLowerMigration] Backfilled titleLower on ${staleHabits.length} habits`);
  } catch (error) {
    console.error('[TitleLowerMigration] Failed to backfill titleLower:', error);
    // Don't throw, just log, to avoid crashing the app loop
  }
}
