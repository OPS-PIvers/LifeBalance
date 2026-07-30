/**
 * Home-feed points scoreboard (per-member points, PR 4/6) — pure selectors kept
 * free of React/Firestore so they're cheaply unit-tested and reusable.
 *
 * Household-first (locked decision, see .claude/PER_MEMBER_POINTS_HANDOFF.md
 * §1): the widget's headline is the household's own `weeklyPoints`/`dailyPoints`
 * figures READ AS STORED — this file never re-derives a household total from
 * per-member figures. Today those are computed independently of per-member
 * attribution (stage 1.5 of the plan is what makes household weekly/daily an
 * actual Σ of member figures); until then, summing members here would silently
 * diverge from the number the rest of the app shows for the same household
 * total (TopToolbar, the Points Breakdown drawer). Standings rows are adults
 * only per the locked UI decision — Kid Mode is dormant and kids don't get a
 * competitive standings row.
 */
import type { HouseholdMember, WeeklyRecap } from '@/types/schema';

export interface ScoreboardStanding {
  memberId: string;
  name: string;
  avatarColor?: string;
  avatarEmoji?: string;
  /** This member's `points.daily`. */
  today: number;
  /** This member's `points.weekly`. */
  weekly: number;
  /** 0-100, this member's weekly points relative to the leader's (0 when the leader has 0). */
  barPct: number;
  /** True only for a single, strict leader — never on a tie, never with one adult. */
  isLeader: boolean;
}

/**
 * Adult (non-managed) members, sorted by weekly points descending (ties broken
 * alphabetically by display name for a stable order), with a bar percentage
 * relative to the leader and a leader flag. Returns `[]` when there are no
 * adult members (never happens in practice — the signed-in admin is always
 * one — but keeps the selector total rather than throwing).
 */
export function selectAdultStandings(members: readonly HouseholdMember[]): ScoreboardStanding[] {
  const adults = members.filter(m => !m.isManaged);
  if (adults.length === 0) return [];

  const sorted = [...adults].sort((a, b) => {
    const diff = b.points.weekly - a.points.weekly;
    if (diff !== 0) return diff;
    return a.displayName.localeCompare(b.displayName);
  });

  const leader = sorted[0];
  const runnerUp = sorted[1];
  const leaderWeekly = leader?.points.weekly ?? 0;
  // A crown means an actual competition was won: at least two adults, a
  // nonzero score, and no tie for first.
  const hasLeader = sorted.length > 1 && leaderWeekly > 0 && leaderWeekly > (runnerUp?.points.weekly ?? 0);

  return sorted.map((m, i) => ({
    memberId: m.uid,
    name: m.displayName,
    avatarColor: m.avatarColor,
    avatarEmoji: m.avatarEmoji,
    today: m.points.daily,
    weekly: m.points.weekly,
    barPct: leaderWeekly > 0 ? Math.round((m.points.weekly / leaderWeekly) * 100) : 0,
    isLeader: hasLeader && i === 0,
  }));
}

export interface ScoreboardTrend {
  /**
   * Percent change of the in-progress week's total vs the most recently
   * completed week (the newest recap), rounded to the nearest integer. `null`
   * when there's no completed week to compare against, or that week's total
   * was 0 (division by zero has no meaningful percent).
   */
  trendPct: number | null;
  /**
   * True when the in-progress week's total is at or above every completed
   * week's total in the (bounded, ~monthly) recap window on file. `false`
   * when there is no recap history yet or the current total is 0 — a
   * brand-new household hasn't earned a "best week" claim.
   */
  isBestWeek: boolean;
}

/** Sum a completed week's per-member points into one household figure — the
 *  same scope (all members) as the live `weeklyPoints` this is compared against. */
const recapWeekTotal = (recap: WeeklyRecap): number =>
  recap.pointsByMember.reduce((sum, p) => sum + p.points, 0);

/**
 * Derive the scoreboard's trend chip + "best week" sub-label from the recaps
 * slice (newest-first) and the current in-progress week's live total.
 * Omits gracefully (both fields at their "nothing to say" value) when there's
 * no recap history yet.
 */
export function deriveScoreboardTrend(
  recaps: readonly WeeklyRecap[],
  currentWeekTotal: number
): ScoreboardTrend {
  if (recaps.length === 0) return { trendPct: null, isBestWeek: false };

  const lastCompleted = recaps[0];
  const lastTotal = lastCompleted ? recapWeekTotal(lastCompleted) : 0;
  const trendPct = lastTotal > 0 ? Math.round(((currentWeekTotal - lastTotal) / lastTotal) * 100) : null;

  const maxCompletedTotal = Math.max(...recaps.map(recapWeekTotal));
  const isBestWeek = currentWeekTotal > 0 && currentWeekTotal >= maxCompletedTotal;

  return { trendPct, isBestWeek };
}
