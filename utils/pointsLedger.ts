/**
 * The itemized receipt behind a scoreboard row — which habit, on which date,
 * earned (or cost) the points a Scoreboard/Points-drawer row reports.
 *
 * 🛡️ THE INVARIANT: a ledger's entries SUM to the figure its row displays.
 * That is only true because every builder here scores through the exact same
 * primitives the row's own total came from, over the exact same scope:
 *
 *   - a member's attributed share → `memberPointsForHabitOnDate`, per
 *     `memberCompletionDates`, i.e. `calculateMemberPointsForDateRange`
 *     unrolled one (habit, date) at a time;
 *   - a member's assigned chores → `pointsForHabitOnDate`, i.e.
 *     `calculatePointsForDateRange(habits, …, memberUid)` unrolled the same way
 *     (its own doc comment states the per-date sum reproduces its collapsed
 *     arithmetic);
 *   - the "Shared habits" row → `unattributedPointsForHabitOnDate` over each
 *     date in the range, i.e. `calculateHouseholdShareForDateRange` unrolled
 *     (that util sums `decomposeDayPoints(…).unattributed`, which is this same
 *     call summed over the non-assigned habits).
 *
 * So nothing here re-derives points with a second scorer, and nothing is
 * computed by SUBTRACTING one displayed figure from another — a subtraction
 * would make the itemization silently absorb any drift the displayed totals
 * carry instead of surfacing it.
 *
 * WHY `includeChores` EXISTS: a member's stored `points.daily`/`points.weekly`
 * is `assigned-chore points + attributed share` (see `computeMemberPointsReset`
 * in utils/habitAttribution.ts), so a row reading those stored figures — the
 * Points drawer, and the Scoreboard's CURRENT week — itemizes both. The
 * Scoreboard's PAST weeks re-derive their rows from
 * `calculateMemberPointsForDateRange` alone (`buildWeekStandings`), which is
 * attribution-only, so those callers pass `includeChores: false` or the receipt
 * would list chore points the row above it never counted.
 */
import { addDays, format, parseISO } from 'date-fns';
import type { Habit } from '@/types/schema';
import {
  habitFeedsMemberAttribution,
  memberCompletionCount,
  memberCompletionDates,
  memberPointsForHabitOnDate,
  unattributedPointsForHabitOnDate,
} from '@/utils/habitAttribution';
import {
  pointsForHabitOnDate,
  type DaySubmissionTotals,
  type SubmissionTotalsByHabitDate,
} from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';

/** Where one ledger line's points came from. */
export type PointsLedgerSource =
  /** The member's attributed share of a shared habit (`completedBy`). */
  | 'attributed'
  /** A habit assigned to the member as a chore — points route to their own doc. */
  | 'chore'
  /** Nobody's: legacy pre-attribution history, or a `creditMode: 'household'` habit. */
  | 'shared';

/** One habit's contribution on one date. */
export interface PointsLedgerEntry {
  habitId: string;
  habitTitle: string;
  /** yyyy-MM-dd, local. */
  date: string;
  /** Signed points this (habit, date) contributed to the row's total. */
  points: number;
  /**
   * Attributed completions behind this line, when the source records them
   * per-member. 0 means "not recorded" (chores and shared lines keep no
   * per-member counter), and callers should render nothing rather than "×0".
   */
  units: number;
  source: PointsLedgerSource;
}

/** A date's entries plus that date's subtotal. */
export interface PointsLedgerDay {
  date: string;
  points: number;
  entries: PointsLedgerEntry[];
}

export interface MemberLedgerOptions {
  /**
   * Itemize habits assigned to this member as chores. Defaults to true — see
   * the module doc comment for the one caller that must pass false.
   */
  includeChores?: boolean;
}

/**
 * Newest date first (matching every other habit-history surface), then biggest
 * mover first within a date, then title for a stable order between two lines
 * that moved the same amount.
 */
const sortLedger = (entries: PointsLedgerEntry[]): PointsLedgerEntry[] =>
  [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    const magnitude = Math.abs(b.points) - Math.abs(a.points);
    if (magnitude !== 0) return magnitude;
    return a.habitTitle.localeCompare(b.habitTitle);
  });

/**
 * Every date in `[startDate, endDate]` on which a habit could contribute
 * outside the attribution layer: its completions, plus any date carrying a
 * stored submission (which can outlive its completion — see
 * `pointsForHabitOnDate`).
 */
const scoredChoreDates = (
  habit: Habit,
  startDate: string,
  endDate: string,
  storedByDate?: Map<string, DaySubmissionTotals>,
): string[] => {
  const dates = new Set<string>();
  for (const date of habit.completedDates) {
    if (date >= startDate && date <= endDate) dates.add(date);
  }
  if (storedByDate) {
    for (const date of storedByDate.keys()) {
      if (date >= startDate && date <= endDate) dates.add(date);
    }
  }
  return [...dates];
};

/**
 * The itemized lines behind ONE member's points across an inclusive range.
 *
 * A zero-point line is kept when the member actually logged something (a
 * threshold habit's second completion in the same period earns nothing extra,
 * but it IS part of the record and hiding it would leave the tap unaccounted
 * for). Lines that neither scored nor recorded a completion are dropped.
 */
export function buildMemberPointsLedger(
  habits: readonly Habit[],
  memberId: string,
  startDate: string,
  endDate: string,
  today: string = getLocalDateString(),
  submissionTotals?: SubmissionTotalsByHabitDate,
  options: MemberLedgerOptions = {},
): PointsLedgerEntry[] {
  const { includeChores = true } = options;
  const entries: PointsLedgerEntry[] = [];

  for (const habit of habits) {
    if (habitFeedsMemberAttribution(habit)) {
      for (const date of memberCompletionDates(habit, memberId)) {
        if (date < startDate || date > endDate) continue;
        entries.push({
          habitId: habit.id,
          habitTitle: habit.title,
          date,
          points: memberPointsForHabitOnDate(habit, memberId, date, today),
          units: memberCompletionCount(habit, memberId, date),
          source: 'attributed',
        });
      }
      continue;
    }

    if (!includeChores || habit.assignedTo !== memberId) continue;
    const storedByDate = submissionTotals?.get(habit.id);
    for (const date of scoredChoreDates(habit, startDate, endDate, storedByDate)) {
      const points = pointsForHabitOnDate(habit, date, today, storedByDate);
      if (points === 0) continue;
      entries.push({
        habitId: habit.id,
        habitTitle: habit.title,
        date,
        points,
        units: 0,
        source: 'chore',
      });
    }
  }

  return sortLedger(entries);
}

/**
 * The itemized lines behind the "Shared habits" row — the `unattributed`
 * remainder of `household = Σ members + unattributed`.
 *
 * Walked date-by-date across the range, exactly like
 * `calculateHouseholdShareForDateRange`, so the lines sum to that figure by
 * construction. Only non-zero lines are kept: an unattributed remainder has no
 * per-member counter to report, so a 0 here means "this habit contributed
 * nothing that day", not "someone logged something worth nothing".
 */
export function buildSharedPointsLedger(
  habits: readonly Habit[],
  startDate: string,
  endDate: string,
  today: string = getLocalDateString(),
  submissionTotals?: SubmissionTotalsByHabitDate,
): PointsLedgerEntry[] {
  const entries: PointsLedgerEntry[] = [];
  let cursor = parseISO(startDate);
  const end = parseISO(endDate);

  while (cursor <= end) {
    const date = format(cursor, 'yyyy-MM-dd');
    for (const habit of habits) {
      // Assigned chores never reach the household pool (`habitPointsTargets`),
      // and `decomposeDayPoints` skips them for the same reason.
      if (habit.assignedTo) continue;
      const points = unattributedPointsForHabitOnDate(
        habit,
        date,
        today,
        submissionTotals?.get(habit.id),
      );
      if (points === 0) continue;
      entries.push({
        habitId: habit.id,
        habitTitle: habit.title,
        date,
        points,
        units: 0,
        source: 'shared',
      });
    }
    cursor = addDays(cursor, 1);
  }

  return sortLedger(entries);
}

/** Σ of a ledger's signed points — what the row above it should read. */
export const sumPointsLedger = (entries: readonly PointsLedgerEntry[]): number =>
  entries.reduce((sum, entry) => sum + entry.points, 0);

/**
 * Group a (already sorted) ledger by date, preserving entry order within each
 * day. Dates come back in the order they first appear, so a ledger from
 * `buildMemberPointsLedger`/`buildSharedPointsLedger` groups newest-first.
 */
export function groupPointsLedgerByDate(
  entries: readonly PointsLedgerEntry[],
): PointsLedgerDay[] {
  const days: PointsLedgerDay[] = [];
  const byDate = new Map<string, PointsLedgerDay>();
  for (const entry of entries) {
    const existing = byDate.get(entry.date);
    if (existing) {
      existing.entries.push(entry);
      existing.points += entry.points;
      continue;
    }
    const day: PointsLedgerDay = { date: entry.date, points: entry.points, entries: [entry] };
    byDate.set(entry.date, day);
    days.push(day);
  }
  return days;
}
