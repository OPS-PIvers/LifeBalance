/**
 * Points Breakdown drawer — pure derivations (stage 3/6 of the per-member
 * points plan). Kept separate from `habitAttribution.ts` because these two
 * functions read already-stored, already-summed figures
 * (`HouseholdMember.points`, `WeeklyRecap.pointsByMember`) rather than
 * re-deriving anything from `Habit.completedBy` — the drawer must not
 * re-expand habits in render (see PER_MEMBER_POINTS_HANDOFF.md §4, PR3).
 */
import { HouseholdMember, WeeklyRecap } from '@/types/schema';

export type PointsDrawerPeriod = 'day' | 'week';

/** One adult member's standing for the selected period. */
export interface MemberStanding {
  memberId: string;
  name: string;
  points: number;
  /** Stored `avatarColor` (if any) — pass through to `resolveAvatarColor` for the plain avatar. */
  avatarColor: string | undefined;
  /**
   * True only when this member is the SOLE strictly-highest scorer among 2+
   * adults with a positive score — a single member (nothing to lead over) or
   * an all-zero / tied field never crowns anyone.
   */
  isLeader: boolean;
}

/** Member shape `getAdultStandings` needs — narrower than a full `HouseholdMember`. */
type StandingMember = Pick<HouseholdMember, 'uid' | 'displayName' | 'isManaged' | 'points' | 'avatarColor'>;

/**
 * Adults-only standings for the Points Breakdown drawer, sorted highest first
 * (ties broken alphabetically by name for a stable order). Managed kids
 * (`isManaged === true`) are excluded — the drawer's standings are adults-only
 * per the locked product decision; Kid Mode gets its own surfaces.
 */
export const getAdultStandings = (
  members: StandingMember[],
  period: PointsDrawerPeriod,
): MemberStanding[] => {
  const rows = members
    .filter((member) => member.isManaged !== true)
    .map((member) => ({
      memberId: member.uid,
      name: member.displayName,
      points: period === 'day' ? member.points.daily : member.points.weekly,
      avatarColor: member.avatarColor,
    }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

  const topPoints = rows[0]?.points ?? 0;
  const leaders = rows.filter((row) => row.points === topPoints);
  const hasLeader = rows.length > 1 && topPoints > 0 && leaders.length === 1;

  return rows.map((row) => ({ ...row, isLeader: hasLeader && row.points === topPoints }));
};

/** The household's week-over-week points trend, or `null` when there's nothing to compare. */
export interface PointsTrend {
  /** Signed percent change vs. last week, rounded to the nearest integer. */
  percent: number;
}

/** Recap shape `computePointsTrend` needs — narrower than a full `WeeklyRecap`. */
type TrendRecap = Pick<WeeklyRecap, 'pointsByMember'>;

/** Member shape `computePointsTrend` needs to identify adults — narrower than a full `HouseholdMember`. */
type TrendMember = Pick<HouseholdMember, 'uid' | 'isManaged'>;

/**
 * Derive the "vs last week" trend chip from the newest `WeeklyRecap` in the
 * `recaps` slice (assumed newest-first, matching the live listener's
 * `orderBy('isoWeek', 'desc')`). Returns `null` — chip omitted — when there is
 * no recap yet, or last week's household total was zero (nothing to divide
 * by, and "∞%" is not a useful chip).
 *
 * `currentWeeklyTotal` (the household `weeklyPoints` figure) structurally
 * excludes managed kids' chore points — assigned habits route to the kid's
 * own member doc, never the household pool. `WeeklyRecap.pointsByMember`
 * includes every member, kids included, so the baseline must be filtered to
 * the same adults-only population via the live `members` list (mirroring
 * `getAdultStandings`'s `isManaged` filter) or the comparison mixes
 * populations and produces a bogus percentage.
 */
export const computePointsTrend = (
  currentWeeklyTotal: number,
  recaps: TrendRecap[],
  members: TrendMember[],
): PointsTrend | null => {
  const latest = recaps[0];
  if (!latest) return null;

  const adultUids = new Set(
    members.filter((member) => member.isManaged !== true).map((member) => member.uid),
  );
  const lastWeekTotal = latest.pointsByMember
    .filter((member) => adultUids.has(member.memberId))
    .reduce((sum, member) => sum + member.points, 0);
  if (lastWeekTotal === 0) return null;

  const percent = Math.round(((currentWeeklyTotal - lastWeekTotal) / lastWeekTotal) * 100);
  return { percent };
};
