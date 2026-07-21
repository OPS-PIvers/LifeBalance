import { format, startOfWeek } from 'date-fns';
import { ToDo, HouseholdMember } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';

/**
 * Plan 080c-5: Todos -> points.
 *
 * Default points credited when a managed-kid assignee completes a to-do that has
 * no explicit `points` value. Mirrors the small, fixed allowance-style reward used
 * for kid chores.
 */
export const DEFAULT_TODO_POINTS = 5;

/**
 * The DORMANCY GATE for to-do completion points.
 *
 * Given a to-do's `assignedTo` + optional `points`, decide whether completing it
 * should credit any member. Points are credited ONLY when the assignee is a
 * MANAGED KID (`isManaged === true`) — the locked Kid-Mode decision that chore
 * assignment targets managed kids exclusively. For every other assignee (a parent,
 * an unassigned todo, or an unknown uid) this returns `null`, so normal households
 * with no managed-kid members credit nothing and behaviour is unchanged.
 *
 * @returns `{ memberUid, points }` to credit, or `null` when no credit is due.
 */
/**
 * Pure helper: given the credit that must be reversed and the completion's
 * original timestamp, build the member-doc point deltas for restoring a
 * completed to-do (uncompleteToDo). Mirrors `deleteHabitSubmission` /
 * `resetHabitDay`'s period gating convention (hooks/useHabitActions.tsx):
 * `points.total` always reverses; `points.daily` only when the completion
 * happened today; `points.weekly` only when it falls inside the current week
 * (weekStartsOn: 1). Plain negative deltas with no zero-floor — matching the
 * habit reversal convention (`increment(-points)`; drift is corrected by the
 * periodic resets, and counts-vs-points clamping only applies to counts).
 *
 * @param today caller-local yyyy-MM-dd (defaults to the local date) — injectable
 *              for deterministic boundary tests, like the habit helpers.
 */
export const buildUncompleteCreditReversal = (
  points: number,
  completedAt: string | undefined,
  today: string = getLocalDateString(),
): Record<string, number> => {
  const updates: Record<string, number> = { 'points.total': -points };
  // A legacy completion with no timestamp can't be placed in time — reverse
  // only the lifetime total (never over-debit today/this week).
  if (!completedAt) return updates;
  const completedDate = getLocalDateString(new Date(completedAt));
  const weekStart = format(startOfWeek(new Date(`${today}T00:00:00`), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  if (completedDate === today) updates['points.daily'] = -points;
  if (completedDate >= weekStart && completedDate <= today) updates['points.weekly'] = -points;
  return updates;
};

export const computeTodoCompletionCredit = (
  todo: Pick<ToDo, 'assignedTo' | 'points'>,
  members: HouseholdMember[]
): { memberUid: string; points: number } | null => {
  const assignee = members.find(m => m.uid === todo.assignedTo);
  if (!assignee || assignee.isManaged !== true) return null;
  return { memberUid: assignee.uid, points: todo.points ?? DEFAULT_TODO_POINTS };
};
