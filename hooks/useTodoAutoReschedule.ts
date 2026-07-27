import { useCallback, useEffect, useRef } from 'react';
import type { ToDo } from '@/types/schema';
import { computeExpiredTodoRoll } from '@/utils/todoRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { useMidnightScheduler } from '@/hooks/useMidnightScheduler';

interface UseTodoAutoRescheduleParams {
  householdId: string | null | undefined;
  todos: ToDo[];
  /** The household context's general-purpose to-do field patch. */
  updateToDo: (id: string, updates: Partial<ToDo>) => Promise<void>;
  /** Injectable "today" (yyyy-MM-dd) — kept for deterministic tests. */
  today?: () => string;
}

/**
 * Drives "auto-reschedule" (`ToDo.resetWhenExpired`): a repeating chore whose
 * due date has passed unfinished rolls forward to the next occurrence of its
 * cadence instead of piling up in the overdue bucket, with any checked steps
 * reset so a fresh period starts clean.
 *
 * Structured like `usePointsSync`: the eligibility decision is the pure,
 * unit-tested `computeExpiredTodoRoll`, and this hook only controls *when* it
 * runs. `useMidnightScheduler` fires it on load, on the 5-minute tick, at local
 * midnight, and on a hidden→visible day change (an installed PWA can sit
 * backgrounded with timers suspended for days).
 *
 * The latest `todos`/`updateToDo` are read through refs so the scheduled
 * callback's identity stays stable — the very write this hook produces arrives
 * back on the live listener as a new `todos` array, and must not re-arm the
 * scheduler.
 *
 * The write itself is the ordinary `updateToDo` mutation, which already re-arms
 * `reminderSentAt` when `completeByDate` changes — exactly what a rolled-forward
 * timed chore needs.
 */
export const useTodoAutoReschedule = ({
  householdId,
  todos,
  updateToDo,
  today = getLocalDateString,
}: UseTodoAutoRescheduleParams): void => {
  const todosRef = useRef(todos);
  const updateToDoRef = useRef(updateToDo);
  const todayRef = useRef(today);
  useEffect(() => {
    todosRef.current = todos;
    updateToDoRef.current = updateToDo;
    todayRef.current = today;
  }, [todos, updateToDo, today]);

  // `${id}:${newDate}` pairs already written this session. A tick that lands
  // before the Firestore snapshot round-trips still sees the OLD due date, so
  // without this the same roll would be issued twice.
  const writtenRef = useRef<Set<string>>(new Set());
  // Reset the guard when the household changes — ids are per-household.
  useEffect(() => {
    writtenRef.current = new Set();
  }, [householdId]);

  const reschedule = useCallback(async () => {
    if (!householdId) return;
    const now = todayRef.current();
    for (const todo of todosRef.current) {
      const roll = computeExpiredTodoRoll(todo, now);
      if (!roll) continue;
      const key = `${todo.id}:${roll.completeByDate}`;
      if (writtenRef.current.has(key)) continue;
      writtenRef.current.add(key);
      try {
        // Sequential on purpose: a household's expired chores are few, and one
        // failure must not abort the rest of the list.
        await updateToDoRef.current(todo.id, roll);
      } catch (error) {
        // Let the next tick retry this one.
        writtenRef.current.delete(key);
        console.error('[useTodoAutoReschedule] Failed to roll to-do forward:', todo.id, error);
      }
    }
  }, [householdId]);

  // (a) Once per household load, as soon as the to-dos have actually arrived —
  //     the scheduler's own first tick fires at mount, when the Firestore
  //     snapshot is usually still in flight and `todos` is still empty.
  const ranForHouseholdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!householdId || todos.length === 0) return;
    if (ranForHouseholdRef.current === householdId) return;
    ranForHouseholdRef.current = householdId;
    void reschedule();
  }, [householdId, todos.length, reschedule]);

  // (b) Periodic / midnight / resume. The small initial delay staggers it
  //     behind the other schedulers that start at mount.
  useMidnightScheduler(reschedule, !!householdId, { initialDelayMs: 200 });
};
