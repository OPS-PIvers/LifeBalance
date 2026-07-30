/**
 * Home-feed points scoreboard (per-member points, PR 4/6) — pure selectors kept
 * free of React/Firestore so they're cheaply unit-tested and reusable.
 *
 * Household-first (locked decision, see .claude/PER_MEMBER_POINTS_HANDOFF.md
 * §1): the widget's headline is the household's own `weeklyPoints`/`dailyPoints`
 * figures READ AS STORED — this file never re-derives a household total from
 * per-member figures. Since stage 1.5 landed, the household `weeklyPoints`/
 * `dailyPoints` figures ARE the Σ of the ADULT members' scores (managed kids'
 * chore points route to the kid's own member doc, never the household pool) —
 * so any comparison against a household total must filter to the same
 * adults-only population or it mixes scopes. Standings rows are adults only
 * per the locked UI decision — Kid Mode is dormant and kids don't get a
 * competitive standings row.
 */
import { format, parseISO, subWeeks } from 'date-fns';
import type { Habit, HouseholdMember, WeeklyRecap } from '@/types/schema';
import { findLeaderId } from '@/utils/pointsLeader';
import { getWeekRange } from '@/utils/listenerWindows';

export interface ScoreboardStanding {
  memberId: string;
  name: string;
  avatarColor?: string;
  avatarEmoji?: string;
  /** Google/Firebase profile photo, when the member has one. */
  photoURL?: string;
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

  const leaderWeekly = sorted[0]?.points.weekly ?? 0;
  // A crown means an actual competition was won: at least two adults, a
  // nonzero score for the leader, and no tie for first. A strict leader still
  // wins even in a net-negative week (someone lost the least) — the gate is
  // "not a zero-zero non-competition," not "must be positive." This is the
  // shared crown rule — see `utils/pointsLeader.ts` — that the Points
  // Breakdown drawer and the ceremony deck's head-to-head also route through.
  const leaderId = findLeaderId(sorted.map(m => ({ memberId: m.uid, points: m.points.weekly })));

  return sorted.map((m) => ({
    memberId: m.uid,
    name: m.displayName,
    avatarColor: m.avatarColor,
    avatarEmoji: m.avatarEmoji,
    photoURL: m.photoURL,
    today: m.points.daily,
    weekly: m.points.weekly,
    // Clamped to >= 0: a negative weekly (relative to a positive leader, or a
    // negative leader itself) must never produce a negative CSS width — that's
    // an invalid length browsers drop, rendering a FULL bar instead of empty.
    barPct: leaderWeekly > 0 ? Math.max(0, Math.round((m.points.weekly / leaderWeekly) * 100)) : 0,
    isLeader: m.uid === leaderId,
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

/** Member shape `deriveScoreboardTrend` needs to identify adults — narrower than a full `HouseholdMember`. */
type TrendMember = Pick<HouseholdMember, 'uid' | 'isManaged'>;

/**
 * Sum a completed week's per-member points into one household figure, scoped
 * to `adultUids` — the same adults-only population the live `weeklyPoints`
 * this is compared against is built from (managed kids' points route to the
 * kid's own member doc, never the household pool; see `getAdultStandings` in
 * `utils/pointsDrawer.ts` for the identical fix applied to the Points
 * Breakdown drawer's trend). Summing every recap entry unfiltered mixes
 * scopes and produces a bogus percentage/best-week verdict.
 */
const recapWeekTotal = (recap: WeeklyRecap, adultUids: ReadonlySet<string>): number =>
  recap.pointsByMember
    .filter((p) => adultUids.has(p.memberId))
    .reduce((sum, p) => sum + p.points, 0);

/**
 * Derive the scoreboard's trend chip + "best week" sub-label from the recaps
 * slice (newest-first) and the current in-progress week's live total.
 * Omits gracefully (both fields at their "nothing to say" value) when there's
 * no recap history yet.
 */
export function deriveScoreboardTrend(
  recaps: readonly WeeklyRecap[],
  currentWeekTotal: number,
  members: readonly TrendMember[]
): ScoreboardTrend {
  if (recaps.length === 0) return { trendPct: null, isBestWeek: false };

  const adultUids = new Set(members.filter((m) => m.isManaged !== true).map((m) => m.uid));

  const lastCompleted = recaps[0];
  const lastTotal = lastCompleted ? recapWeekTotal(lastCompleted, adultUids) : 0;
  const trendPct = lastTotal > 0 ? Math.round(((currentWeekTotal - lastTotal) / lastTotal) * 100) : null;

  const maxCompletedTotal = Math.max(...recaps.map((r) => recapWeekTotal(r, adultUids)));
  const isBestWeek = currentWeekTotal > 0 && currentWeekTotal >= maxCompletedTotal;

  return { trendPct, isBestWeek };
}

// ---------------------------------------------------------------------------
// Week selector (Cut #3): "This week" becomes a tappable button offering a
// popover of recent weeks. Picking one re-derives that week's figures from
// habit history rather than any stored field — see the doc comments below on
// why that's the only option.
// ---------------------------------------------------------------------------

export interface ScoreboardWeekOption {
  /** Monday, yyyy-MM-dd (inclusive). */
  weekStart: string;
  /** Sunday, yyyy-MM-dd (inclusive). */
  weekEnd: string;
  /** "Jun 29 – Jul 5". */
  label: string;
  isCurrent: boolean;
}

const weekRangeLabel = (start: string, end: string): string =>
  `${format(parseISO(start), 'MMM d')} – ${format(parseISO(end), 'MMM d')}`;

/**
 * Weeks to offer in the Scoreboard's week-selector popover: the live current
 * week (always first, always offered even with zero completions — mirrors
 * the widget's own "quiet zero state, never hides" rule for a brand-new
 * household) plus up to `maxPastWeeks` PRIOR weeks that actually contain at
 * least one habit completion.
 *
 * This is a pure client-side walk over the already-loaded `habits` — the
 * habits listener is unwindowed (see contexts/household/listeners/
 * gamificationListeners.ts), so widening `maxPastWeeks` costs zero extra
 * Firestore reads. The DATA gate, not the week-count gate, is what actually
 * bounds the list in practice: a past week with no completions — because it
 * predates the household's history, or predates the 2026-07-15
 * completedDates-wipe incident (see utils/migrations/habitHistoryRepair.ts)
 * — is simply never offered, rather than resolving to a wall of zeroes.
 */
export function listScoreboardWeekOptions(
  habits: readonly Pick<Habit, 'completedDates'>[],
  today: Date,
  maxPastWeeks: number = 12,
): ScoreboardWeekOption[] {
  const options: ScoreboardWeekOption[] = [];
  for (let i = 0; i <= maxPastWeeks; i++) {
    const { start, end } = getWeekRange(subWeeks(today, i));
    const isCurrent = i === 0;
    if (!isCurrent && !habits.some(h => h.completedDates.some(d => d >= start && d <= end))) {
      continue;
    }
    options.push({ weekStart: start, weekEnd: end, label: weekRangeLabel(start, end), isCurrent });
  }
  return options;
}

/**
 * Does any habit carry per-member attribution (`completedBy`) inside
 * `[start, end]`? False for a "grandfathered" week — completions recorded
 * before per-member points shipped have `completedDates` entries with no
 * `completedBy` counterpart (see the field's doc comment on `Habit.completedBy`
 * in types/schema.ts). The Scoreboard must not render a row of confident
 * member zeroes for such a week; callers fall back to a household-total-only
 * view, mirroring how `hasCeremonyData` (utils/recapDeck.ts) degrades the
 * recap deck when a week has no member facts.
 *
 * Assigned (chore) habits are excluded, same as `habitFeedsMemberAttribution`
 * in utils/habitAttribution.ts — their attribution routes straight to the
 * assignee and was never meant to gate the shared standings.
 */
export function weekHasMemberAttribution(
  habits: readonly Pick<Habit, 'completedBy' | 'assignedTo'>[],
  start: string,
  end: string,
): boolean {
  return habits.some(h => {
    if (h.assignedTo || !h.completedBy) return false;
    return Object.entries(h.completedBy).some(
      ([date, byMember]) => date >= start && date <= end && Object.values(byMember).some(count => count > 0)
    );
  });
}

export interface ScoreboardWeekStanding {
  memberId: string;
  name: string;
  avatarColor?: string;
  avatarEmoji?: string;
  photoURL?: string;
  /** This member's derived points for the selected week. */
  points: number;
  /** 0-100, relative to the leader's points (0 when the leader has 0). */
  barPct: number;
  isLeader: boolean;
}

type StandingMember = Pick<HouseholdMember, 'uid' | 'displayName' | 'avatarColor' | 'avatarEmoji' | 'photoURL'>;

/**
 * The past-week twin of `selectAdultStandings`: identical sort/crown/bar
 * rules, but sourced from a `memberId -> points` map the caller derives via
 * `calculateMemberPointsForDateRange` (utils/habitAttribution.ts) instead of
 * a member's live `points.weekly` — the only figure that exists once a week
 * has rolled over (see the module doc comment above on why `points.weekly`
 * can't serve history). Callers must pre-filter `adults` to non-managed
 * members and should only call this once `weekHasMemberAttribution` is true
 * for the same range — this function has no way to distinguish "nobody
 * scored" from "nobody attributed" and will happily return an all-zero,
 * uncrowned list for either.
 */
export function buildWeekStandings(
  adults: readonly StandingMember[],
  pointsByMemberId: ReadonlyMap<string, number>,
): ScoreboardWeekStanding[] {
  const pointsOf = (uid: string): number => pointsByMemberId.get(uid) ?? 0;

  const sorted = [...adults].sort((a, b) => {
    const diff = pointsOf(b.uid) - pointsOf(a.uid);
    if (diff !== 0) return diff;
    return a.displayName.localeCompare(b.displayName);
  });

  const leaderPoints = sorted[0] ? pointsOf(sorted[0].uid) : 0;
  const leaderId = findLeaderId(sorted.map(m => ({ memberId: m.uid, points: pointsOf(m.uid) })));

  return sorted.map(m => {
    const points = pointsOf(m.uid);
    return {
      memberId: m.uid,
      name: m.displayName,
      avatarColor: m.avatarColor,
      avatarEmoji: m.avatarEmoji,
      photoURL: m.photoURL,
      points,
      barPct: leaderPoints > 0 ? Math.max(0, Math.round((points / leaderPoints) * 100)) : 0,
      isLeader: m.uid === leaderId,
    };
  });
}
