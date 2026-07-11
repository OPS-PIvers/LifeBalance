import {
  collection,
  doc,
  getDocs,
  increment,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/firebase.config';
import { Habit, HabitSubmission, Household } from '@/types/schema';
import {
  calculatePointsForDate,
  calculatePointsForDateRange,
  habitSign,
} from '@/utils/habitLogic';
import { format, startOfWeek } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * One-time repair for the negative-habit submission sign bug.
 *
 * `addHabitSubmission` historically computed `pointsEarned` from raw
 * `basePoints` with no `habit.type` sign, so back-dating a negative habit
 * (via the "Log a past day" drawer or the submission log) AWARDED points
 * instead of deducting them — corrupting the stored submissions, the
 * household `points` triple, and (because the corrective sync never adjusts
 * `points.total` downward) leaving the total permanently inflated.
 *
 * The repair:
 *  1. flips `pointsEarned` positive→negative on every submission of a
 *     negative-type habit (the magnitude already carried the correct
 *     at-the-time multiplier, only the sign was wrong);
 *  2. applies exactly the summed correction delta to `points.total` — an
 *     increment, not a recompute, so redemptions/to-do credits/manual edits
 *     baked into the total are untouched;
 *  3. recomputes `points.daily`/`points.weekly` outright from completions
 *     using the (now sign-correct) recompute helpers;
 *  4. stamps `negativePointsRepairedAt` on the household doc so it never
 *     runs again (submissions have no standing listener, so the needs-check
 *     can't see them).
 *
 * Points for an assigned (kid-chore) habit are corrected on that member's own
 * doc, mirroring habitPointsTargetRef in useHabitActions.
 */

/** Marker-based needs check: run once per household that could be affected. */
export function needsNegativePointsRepair(
  household: Pick<Household, 'negativePointsRepairedAt'>,
  habits: Habit[],
): boolean {
  if (household.negativePointsRepairedAt) return false;
  return habits.some(h => h.type === 'negative' && h.hasSubmissionTracking);
}

/** Max writes per Firestore batch (limit is 500; leave headroom for points docs). */
const CHUNK_SIZE = 400;

export async function repairNegativePointsCorruption(
  householdId: string,
  habits: Habit[],
): Promise<void> {
  try {
    // 1. Find every wrongly-signed submission on negative-type habits.
    const negativeHabits = habits.filter(
      h => h.type === 'negative' && h.hasSubmissionTracking
    );

    // Correction delta per points target: '' = shared household pool,
    // otherwise the assignee member uid (kid chores credit the kid's doc).
    const deltaByTarget = new Map<string, number>();
    const fixes: { habitId: string; submissionId: string; newPoints: number }[] = [];

    for (const habit of negativeHabits) {
      const snap = await getDocs(
        collection(db, `households/${householdId}/habits/${habit.id}/submissions`)
      );
      snap.docs.forEach(d => {
        const submission = d.data() as HabitSubmission;
        // A negative habit's submission can only legitimately hold ≤ 0 points
        // (habitSign is -1). Positive pointsEarned is the bug signature; the
        // magnitude was computed with the correct at-the-time multiplier.
        if (habitSign(habit) === -1 && submission.pointsEarned > 0) {
          const newPoints = -submission.pointsEarned;
          fixes.push({ habitId: habit.id, submissionId: d.id, newPoints });
          const target = habit.assignedTo ?? '';
          deltaByTarget.set(
            target,
            (deltaByTarget.get(target) ?? 0) + (newPoints - submission.pointsEarned)
          );
        }
      });
    }

    // 2. Flip the wrong submissions in chunked batches.
    for (let i = 0; i < fixes.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      fixes.slice(i, i + CHUNK_SIZE).forEach(fix => {
        batch.update(
          doc(db, `households/${householdId}/habits/${fix.habitId}/submissions`, fix.submissionId),
          { pointsEarned: fix.newPoints }
        );
      });
      await batch.commit();
    }

    // 3. Correct the points and stamp the marker in one final batch.
    const today = getLocalDateString();
    const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
    const finalBatch = writeBatch(db);

    // Shared household pool: daily/weekly recomputed outright (sign-correct
    // now), total nudged by exactly the correction delta.
    const householdDelta = deltaByTarget.get('') ?? 0;
    finalBatch.update(doc(db, `households/${householdId}`), {
      'points.daily': calculatePointsForDate(habits, today),
      'points.weekly': calculatePointsForDateRange(habits, weekStart, today),
      ...(householdDelta !== 0 ? { 'points.total': increment(householdDelta) } : {}),
      negativePointsRepairedAt: new Date().toISOString(),
    });

    // Assigned (kid-chore) targets, if any were affected.
    for (const [memberUid, delta] of deltaByTarget) {
      if (memberUid === '') continue;
      finalBatch.update(doc(db, `households/${householdId}/members`, memberUid), {
        'points.daily': calculatePointsForDate(habits, today, memberUid),
        'points.weekly': calculatePointsForDateRange(habits, weekStart, today, memberUid),
        ...(delta !== 0 ? { 'points.total': increment(delta) } : {}),
      });
    }

    await finalBatch.commit();

    if (fixes.length > 0) {
      console.log(`[NegativePointsRepair] Fixed ${fixes.length} wrongly-signed submission(s)`);
    }
  } catch (error) {
    console.error('[NegativePointsRepair] Failed:', error);
    // Don't throw — the marker was not written, so a failed repair retries on
    // the next session instead of crashing the app.
  }
}
