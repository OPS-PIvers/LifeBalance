import { ToDo, HouseholdMember } from '@/types/schema';

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
export const computeTodoCompletionCredit = (
  todo: Pick<ToDo, 'assignedTo' | 'points'>,
  members: HouseholdMember[]
): { memberUid: string; points: number } | null => {
  const assignee = members.find(m => m.uid === todo.assignedTo);
  if (!assignee || assignee.isManaged !== true) return null;
  return { memberUid: assignee.uid, points: todo.points ?? DEFAULT_TODO_POINTS };
};
