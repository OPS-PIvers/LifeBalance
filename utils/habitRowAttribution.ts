/**
 * The habit row's "who did this" view model (per-member points, stage 2).
 *
 * Pure: it turns `Habit.completedBy` + the household roster into the ordered
 * segments the pie counter fills and the badge-row avatars render, so the row
 * component holds no derivation logic of its own.
 *
 * The member context is built ONCE per roster change on the Habits page and
 * passed down, because a habit list renders many rows and every one of them
 * would otherwise re-derive the colors and re-filter the roster.
 */
import type { Habit, HouseholdMember } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  memberUnitsForPeriod,
  streakForMember,
} from '@/utils/habitAttribution';
import {
  buildMemberColorMap,
  isAdultMember,
  memberColorFor,
  type ColorableMember,
} from '@/utils/memberColors';

/** One member as a habit row needs them. */
export interface RowMember {
  uid: string;
  displayName: string;
  /** Hex, from the shared member-color map. */
  color: string;
}

/** Everything a habit row needs to render + edit attribution. */
export interface HabitRowMemberContext {
  /** The signed-in member ("Me" in the picker); '' when unknown. */
  currentUserId: string;
  /**
   * Adults (non-managed members) in roster order — the picker's member set.
   * Managed kid profiles are deliberately excluded: the attribution UI is
   * adults-only until Kid Mode activates, though the underlying mutations are
   * member-set based and already handle any member.
   */
  adults: readonly RowMember[];
  /** EVERY member (adults + managed) by uid, for naming/coloring credited avatars. */
  byUid: Readonly<Record<string, RowMember>>;
}

/** One member's share of a habit row's period, ready to draw. */
export interface RowCompletionSegment {
  memberId: string;
  displayName: string;
  color: string;
  /** Attributed completions in the row's current period. */
  units: number;
  /** That member's OWN streak, in the habit's cadence (days / ISO weeks). */
  streak: number;
}

type RosterMember = Pick<HouseholdMember, 'uid' | 'displayName' | 'avatarColor' | 'isManaged'>;

/** Build the per-row member context from the household roster. Memoize the result. */
export const buildHabitRowMemberContext = (
  members: readonly RosterMember[],
  currentUserId: string | null | undefined,
): HabitRowMemberContext => {
  const colors = buildMemberColorMap(members as readonly ColorableMember[]);
  const byUid: Record<string, RowMember> = {};
  const adults: RowMember[] = [];
  for (const member of members) {
    const row: RowMember = {
      uid: member.uid,
      displayName: member.displayName,
      color: memberColorFor(colors, member.uid),
    };
    byUid[member.uid] = row;
    if (isAdultMember(member)) adults.push(row);
  }
  return { currentUserId: currentUserId ?? '', adults, byUid };
};

/**
 * The row's attribution segments for the period containing `date`, ordered:
 * roster adults first (so the first adult always owns 12 o'clock), then any
 * other credited uid — a managed kid on an assigned chore, or a member who has
 * since left the household — in uid order so the arrangement is deterministic.
 *
 * Empty when the habit carries no attribution for the period, which is exactly
 * the pre-feature ("grandfathered") state: those rows keep their original
 * un-attributed look.
 */
export const rowCompletionSegments = (
  habit: Habit,
  context: HabitRowMemberContext,
  date: string = getLocalDateString(),
): RowCompletionSegment[] => {
  const units = memberUnitsForPeriod(habit, date);
  const uids = Object.keys(units);
  if (uids.length === 0) return [];

  const ordered = [
    ...context.adults.map(a => a.uid).filter(uid => (units[uid] ?? 0) > 0),
    ...uids.filter(uid => !context.adults.some(a => a.uid === uid)).sort(),
  ];

  return ordered.map(uid => {
    const member = context.byUid[uid];
    return {
      memberId: uid,
      // A uid with no member doc left (removed member) still gets a readable
      // label rather than an empty avatar.
      displayName: member?.displayName ?? 'Former member',
      color: member?.color ?? memberColorFor({}, uid),
      units: units[uid] ?? 0,
      streak: streakForMember(habit, uid, date),
    };
  });
};
