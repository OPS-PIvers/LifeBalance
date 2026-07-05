/**
 * Pure cap logic for proactive (server-triggered) insight writes.
 *
 * Proactive insights piggyback on existing scheduled/trigger functions
 * (streak-rescue in `sendstreakwarnings`, budget-anomaly in `sendbudgetalerts`)
 * rather than a new cron. Notification/card fatigue is the main failure mode
 * of this feature class, so writes are capped at 2 per household per ISO week.
 *
 * The cap is tracked on the household doc via two fields:
 *  - `proactiveInsightWeek`: the ISO week (e.g. "2026-W27") the count applies to.
 *  - `proactiveInsightCount`: how many proactive insights have been written
 *    for that week so far.
 *
 * When the current ISO week differs from the stored week, the count resets
 * to 0 before the cap check — callers pass in the household's current stored
 * state and the ISO week being evaluated, and get back both a decision and
 * the patch to apply (check-and-increment), so the actual Firestore write can
 * happen inside the same transaction/batch as the insight doc write.
 */

export const MAX_PROACTIVE_INSIGHTS_PER_WEEK = 2;

export interface ProactiveCapState {
  /** ISO week the count applies to, e.g. "2026-W27". Absent = never tracked. */
  proactiveInsightWeek?: string;
  /** Count of proactive insights written so far for `proactiveInsightWeek`. */
  proactiveInsightCount?: number;
}

export interface ProactiveCapResult {
  /** Whether the caller is allowed to write a proactive insight now. */
  allowed: boolean;
  /**
   * The household-doc patch to apply IF `allowed` is true — always resets the
   * week marker and increments the count by 1 relative to a same-week base of
   * 0 (rollover) or the existing count. `undefined` when not allowed (no
   * write should happen).
   */
  patch?: ProactiveCapState;
}

/**
 * Decides whether a new proactive insight may be written for `isoWeek`, given
 * the household's current cap-tracking state. Resets the count when the week
 * has rolled over, then enforces `MAX_PROACTIVE_INSIGHTS_PER_WEEK`.
 */
export function checkAndIncrementProactiveCap(
  state: ProactiveCapState,
  isoWeek: string
): ProactiveCapResult {
  const sameWeek = state.proactiveInsightWeek === isoWeek;
  const currentCount = sameWeek ? (state.proactiveInsightCount ?? 0) : 0;

  if (currentCount >= MAX_PROACTIVE_INSIGHTS_PER_WEEK) {
    return { allowed: false };
  }

  return {
    allowed: true,
    patch: {
      proactiveInsightWeek: isoWeek,
      proactiveInsightCount: currentCount + 1,
    },
  };
}
