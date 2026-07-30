/**
 * Per-member habit points — the ONE place "who's leading" is decided.
 *
 * Three surfaces crown a leader from the same underlying standings: the
 * Scoreboard widget (`utils/scoreboardWidget.ts`), the Points Breakdown
 * drawer (`utils/pointsDrawer.ts`), and the weekly ceremony deck's
 * head-to-head (`utils/recapDeck.ts`). Before this module existed the three
 * disagreed on a net-negative week — the crown rule was reviewed and locked
 * on the Scoreboard's semantics, so all three now route through this one
 * predicate.
 *
 * Crown rule (locked, reviewed): a strict leader still wins even in a
 * net-negative week — someone who merely lost the least still beat everyone
 * else. The gate is "not a zero-zero non-competition, and not a tie," not
 * "must be positive." Concretely: at least two candidates, a NONZERO leading
 * score (negative counts), and no tie for first.
 */

export interface LeaderCandidate {
  readonly memberId: string;
  readonly points: number;
}

/**
 * Which candidate (if any) is the sole leader.
 *
 * `candidates` must already be sorted highest-points-first, with whatever
 * stable tie-break the caller uses for display order (e.g. alphabetical by
 * name) — this function only asks whether that first entry is an actual,
 * uncontested leader. It never re-sorts, so a caller that hands in an
 * unsorted list gets a meaningless answer.
 *
 * Returns the leading `memberId`, or `null` when nobody is crowned (fewer
 * than two candidates, an all-zero field, or a tie for first).
 */
export function findLeaderId(candidates: readonly LeaderCandidate[]): string | null {
  if (candidates.length < 2) return null;
  const leader = candidates[0];
  const runnerUp = candidates[1];
  if (!leader || !runnerUp) return null;
  if (leader.points === 0) return null;
  if (leader.points <= runnerUp.points) return null;
  return leader.memberId;
}

/** Convenience: is `memberId` the sole leader among `candidates`? */
export function isLeader(candidates: readonly LeaderCandidate[], memberId: string): boolean {
  return findLeaderId(candidates) === memberId;
}
