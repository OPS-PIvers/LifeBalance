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
  memberCompletionCount,
  memberUnitsForPeriod,
  streakForMember,
} from '@/utils/habitAttribution';
import {
  buildMemberColorMap,
  isAdultMember,
  memberColorFor,
  type ColorableMember,
} from '@/utils/memberColors';

/**
 * How long a row must be held before the "who did this?" picker opens.
 * Shared by every surface that carries the gesture (the Track tab's HabitCard,
 * the day editor's history rows) so one hold feels the same everywhere.
 */
export const LONG_PRESS_MS = 500;
/**
 * Movement (px) that turns a press into a scroll and cancels the long-press.
 * 16px, not 10: a finger wanders during a deliberate half-second hold, and a
 * hold that silently fails is worse than a scroll that also opened the picker
 * (a real scroll leaves this far behind within the same 500ms).
 */
export const LONG_PRESS_SLOP = 16;

/** One member as a habit row needs them. */
export interface RowMember {
  uid: string;
  displayName: string;
  /** Hex, from the shared member-color map — the fallback when there's no photo. */
  color: string;
  /** Google/Firebase profile photo, when the member has one. */
  photoURL?: string;
}

/**
 * One row of the "who did this?" picker. A view model, so it lives here with
 * the other row derivations rather than in the presentational component that
 * renders it (which re-exports the type for its existing importers).
 */
export interface AttributionPickerMember extends RowMember {
  /**
   * Credited on the date this picker is editing — which is TODAY (period-scoped,
   * see `memberUnitsForPeriod`) for the habit row, and the selected day
   * (day-scoped, see `dayPickerMembers`) for the history day editor. Drives the
   * checkmark and the undo path.
   */
  credited: boolean;
  /** The signed-in member, labelled "Me". */
  isSelf: boolean;
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
  /** Google/Firebase profile photo, when the member has one. */
  photoURL?: string;
  /** Attributed completions in the row's current period. */
  units: number;
  /** That member's OWN streak, in the habit's cadence (days / ISO weeks). */
  streak: number;
}

type RosterMember = Pick<HouseholdMember, 'uid' | 'displayName' | 'avatarColor' | 'isManaged' | 'photoURL'>;

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
      photoURL: member.photoURL,
    };
    byUid[member.uid] = row;
    if (isAdultMember(member)) adults.push(row);
  }
  return { currentUserId: currentUserId ?? '', adults, byUid };
};

/**
 * Do two contexts describe the same roster? The habit row's `React.memo`
 * comparator asks this instead of comparing identity.
 *
 * 🛡️ Identity is NOT enough, and the difference is a real regression: the page
 * memoizes this context on `members`, but EVERY habit toggle writes
 * `members/{uid}.points`, which re-fires the members listener and hands the page
 * a brand-new array — so an identity check would re-render every card in the
 * list on every toggle. None of the fields a row actually reads (uid, name,
 * color, photo) move when points do, so compare those.
 */
export const sameHabitRowMemberContext = (
  a: HabitRowMemberContext | undefined,
  b: HabitRowMemberContext | undefined,
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.currentUserId !== b.currentUserId) return false;
  if (a.adults.length !== b.adults.length) return false;
  for (let i = 0; i < a.adults.length; i += 1) {
    const left = a.adults[i];
    const right = b.adults[i];
    if (
      left?.uid !== right?.uid ||
      left?.displayName !== right?.displayName ||
      left?.color !== right?.color ||
      left?.photoURL !== right?.photoURL
    ) {
      return false;
    }
  }
  const uids = Object.keys(a.byUid);
  if (uids.length !== Object.keys(b.byUid).length) return false;
  for (const uid of uids) {
    const left = a.byUid[uid];
    const right = b.byUid[uid];
    if (
      !right ||
      left?.displayName !== right.displayName ||
      left?.color !== right.color ||
      left?.photoURL !== right.photoURL
    ) {
      return false;
    }
  }
  return true;
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
      photoURL: member?.photoURL,
      units: units[uid] ?? 0,
      streak: streakForMember(habit, uid, date),
    };
  });
};

/**
 * The picker's member rows for ONE DATE (the day editor's scope).
 *
 * DAY-scoped, not period-scoped — deliberately unlike HabitCard, which uses
 * `memberUnitsForPeriod(habit, today)`. The day editor's own badge is
 * `countForHabitOnDate(habit, selectedDate)`, and its undo target is
 * `selectedDate`; deriving `credited` from anything wider would let the sheet
 * show a checkmark for a unit that lives on a different day, and
 * `uncreditHabitCompletion` NO-OPS when the member holds nothing on the date it
 * is given — that dead tap is impossible when the checkmark and the undo target
 * are the same date by construction.
 *
 * DOCUMENTED DEVIATION: on a WEEKLY habit a member already holding Monday can
 * be credited again on Wednesday from the day editor, where the Habits page
 * would show them checked and refuse. That is safe — a threshold period awards
 * a member only on their FIRST attributed day, so the second unit earns zero
 * extra points, and on an incremental habit a second unit on a different day is
 * a genuine second action.
 */
export const dayPickerMembers = (
  habit: Habit,
  context: HabitRowMemberContext,
  date: string,
): AttributionPickerMember[] =>
  context.adults.map(member => ({
    ...member,
    credited: memberCompletionCount(habit, member.uid, date) > 0,
    isSelf: member.uid === context.currentUserId,
  }));
