import { Habit } from '@/types/schema';
import { format, subDays, parseISO } from 'date-fns';
import { calculateStreak, isHabitPaused } from '@/utils/habitLogic';
import { getMissedHabitDates } from '@/utils/freezeBankValidator';
import {
  memberCompletionDates,
  memberFrozenDates,
  streakForMemberDates,
} from '@/utils/habitAttribution';

/**
 * Plan 25 — auto-applied freeze protection.
 *
 * The freeze bank refills to this fixed stock on the 1st of each month
 * (replacing the old 2-new + 1-carryover rollover math); there is no
 * carryover, expiry, or manual patching. Freezes are consumed automatically
 * at midnight/login when a daily streak would otherwise break.
 */
export const FREEZE_MAX_TOKENS = 2;

export interface AutoFreezeCandidate {
  habit: Habit;
  /** The streak (completed days only) that freezing yesterday preserves. */
  protectedStreak: number;
}

/**
 * Pure candidate selection for the midnight/first-login auto-apply pass.
 *
 * A habit is a candidate iff ALL of:
 *  - positive DAILY habit (weekly cadences and negative habits are never frozen)
 *  - yesterday was actually missed (`getMissedHabitDates` — which also floors
 *    at the habit's first completion, so a brand-new habit is never "missed")
 *  - yesterday is not already frozen (the idempotency guard: a second run on
 *    this or another device is a no-op)
 *  - freezing yesterday preserves a streak of >= 3 completed days — the
 *    PROSPECTIVE streak `calculateStreak(completedDates, today,
 *    [...frozenDates, yesterday])`, NOT the stored `streakDays` field, because
 *    the midnight habit-reset may already have recomputed `streakDays` to 0
 *    before this pass runs, and because bridging night 2 of consecutive misses
 *    requires seeing night 1's frozen day.
 *
 * Candidates are returned in a DETERMINISTIC order (highest protected streak
 * first, then habit id) so two devices racing at midnight pick the same
 * habits for the same tokens.
 *
 * @param habits - All household habits
 * @param today - "Today" (yyyy-MM-dd, caller's local timezone — use
 *                getLocalDateString()); injectable for deterministic tests
 */
export function selectAutoFreezeCandidates(
  habits: Habit[],
  today: string,
): AutoFreezeCandidate[] {
  const yesterday = format(subDays(parseISO(today), 1), 'yyyy-MM-dd');
  const candidates: AutoFreezeCandidate[] = [];

  for (const habit of habits) {
    if (habit.type !== 'positive' || habit.period !== 'daily') continue;

    // F-HABITS-01: a habit on a planned break never burns a freeze token — the
    // pause bridges its streak for free.
    if (isHabitPaused(habit, today)) continue;

    const frozen = habit.frozenDates ?? [];
    if (frozen.includes(yesterday)) continue; // idempotency guard

    if (!getMissedHabitDates(habit, 1, undefined, today).includes(yesterday)) continue;

    const protectedStreak = calculateStreak(habit.completedDates, today, [...frozen, yesterday]);
    if (protectedStreak < 3) continue;

    candidates.push({ habit, protectedStreak });
  }

  candidates.sort(
    (a, b) => b.protectedStreak - a.protectedStreak || a.habit.id.localeCompare(b.habit.id)
  );
  return candidates;
}

/** One (member, habit) pair a per-member freeze token would protect. */
export interface MemberAutoFreezeCandidate extends AutoFreezeCandidate {
  /** Whose bank pays, and whose chain the freeze bridges. */
  memberId: string;
}

/**
 * Per-member candidate selection — the `freezeMode: 'per_member'` twin of
 * `selectAutoFreezeCandidates`.
 *
 * The habit-level gates are identical (positive, daily, not paused). Everything
 * else is asked of the MEMBER's own chain, read from `Habit.completedBy`:
 *
 *  - the member missed yesterday (their attributed count for it is zero),
 *  - the member has a chain to protect at all — at least one attributed
 *    completion strictly before yesterday. This is the per-member analogue of
 *    `getMissedHabitDates`' floor at the habit's first completion: a member who
 *    has never completed this habit has no streak, so their "miss" is not one,
 *  - neither bridge already covers yesterday — not the household-wide
 *    `frozenDates` (which would bridge them for free, so spending a personal
 *    token would be waste) and not their own `frozenDatesBy` entry (the
 *    idempotency guard, exactly like the shared path's),
 *  - freezing yesterday preserves >= 3 completed days of THEIR chain.
 *
 * Ordering is deterministic across devices: highest protected streak, then habit
 * id, then member uid.
 */
export function selectMemberAutoFreezeCandidates(
  habits: Habit[],
  memberIds: string[],
  today: string,
): MemberAutoFreezeCandidate[] {
  const yesterday = format(subDays(parseISO(today), 1), 'yyyy-MM-dd');
  const candidates: MemberAutoFreezeCandidate[] = [];

  for (const habit of habits) {
    if (habit.type !== 'positive' || habit.period !== 'daily') continue;
    if (isHabitPaused(habit, today)) continue;

    // A household-wide freeze on yesterday already bridges every member.
    const householdFrozen = habit.frozenDates ?? [];
    if (householdFrozen.includes(yesterday)) continue;

    for (const memberId of memberIds) {
      const memberFrozen = memberFrozenDates(habit, memberId);
      if (memberFrozen.includes(yesterday)) continue; // idempotency guard

      const dates = memberCompletionDates(habit, memberId);
      if (dates.includes(yesterday)) continue; // they did it — nothing missed
      if (!dates.some(d => d < yesterday)) continue; // no chain to protect yet

      const protectedStreak = streakForMemberDates(habit, dates, today, [
        ...memberFrozen,
        yesterday,
      ]);
      if (protectedStreak < 3) continue;

      candidates.push({ habit, memberId, protectedStreak });
    }
  }

  candidates.sort(
    (a, b) =>
      b.protectedStreak - a.protectedStreak ||
      a.habit.id.localeCompare(b.habit.id) ||
      a.memberId.localeCompare(b.memberId)
  );
  return candidates;
}
