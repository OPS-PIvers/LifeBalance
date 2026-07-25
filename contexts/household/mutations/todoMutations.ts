import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  increment,
  arrayUnion,
  arrayRemove,
  deleteField,
  writeBatch,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Firestore,
  type WriteBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { todoConverter, habitConverter } from '@/utils/firestoreConverters';
import { ToDo, HouseholdMember, Subtask } from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { setSubtaskDone, subtaskProgress } from '@/utils/subtasks';
import { computeTodoCompletionCredit, buildUncompleteCreditReversal } from '@/utils/todoPoints';
import { buildNextRecurringTodo, isTodoFrequency } from '@/utils/todoRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { computeHabitTriggerFire, computeHabitTriggerReverse } from '@/utils/habitTriggerFire';
import { evaluateTodoSubtaskGate, TodoSubtasksIncompleteError, isTodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { attributionString, type TriggerSource } from '@/utils/habitTriggers';
import { appendActivityLog } from '@/utils/activityLog';
import { TODO_COMPLETED_PAGE_SIZE } from '@/utils/listenerWindows';
import { mergeById, mapTodoDoc } from '@/contexts/household/selectors';
import type { User } from 'firebase/auth';

/**
 * A by-id subtask flip, applied to each mutation's OWN freshest read of the
 * subtasks array at commit time. Replaces the old "pass the whole computed
 * array" contract, which let a stale caller-supplied snapshot silently revert a
 * concurrent add/toggle of a DIFFERENT subtask from another device (the
 * 2026-07-15 whole-array-clobber incident class). `done` is the intended target
 * state (idempotent set, not a blind toggle), so re-applying it is safe.
 */
export interface SubtaskToggleDescriptor {
  subtaskId: string;
  done: boolean;
}

/**
 * Options shared by `completeToDo` / `uncompleteToDo`: an inline subtask
 * auto-complete (and its undo) hands a by-id descriptor that each function
 * applies to its own fresh doc read, persisting the flip in the SAME batch as
 * the completion / restore.
 */
export interface TodoCompletionOptions {
  subtaskToggle?: SubtaskToggleDescriptor;
}

/**
 * Habit Automations (PRD #1065) — the doc that receives a habit's points. An
 * ASSIGNED (per-member / kid chore) habit credits the assignee's own
 * `members/{uid}.points`; an unassigned/shared habit credits the shared
 * household doc. Mirrors `habitPointsTargetRef` in hooks/useHabitActions.tsx so
 * a to-do-fired habit routes points identically to a manual tap.
 */
/**
 * In-flight guard for `completeToDo` (module-level so it survives the per-render
 * factory closure). A double-tap or a re-entrant call while a completion for the
 * same to-do id is still pending is IGNORED, cheaply closing the double-fire
 * window: `completeToDo` is a getDoc-check-then-batch, so without this two rapid
 * taps can both pass the `isCompleted` check and fire the linked habit twice.
 * (The cross-device / offline case — two devices completing the same doc while
 * both are offline — remains theoretical and is accepted.)
 */
const completeToDoInFlight = new Set<string>();

function habitPointsTargetRef(db: Firestore, householdId: string, assignedTo: string | undefined) {
  return assignedTo
    ? doc(db, `households/${householdId}/members`, assignedTo)
    : doc(db, `households/${householdId}`);
}

/**
 * Habit Automations (PRD #1065): fire (or reverse) the habit a to-do is linked
 * to, IN the caller's existing writeBatch, so the habit + points writes
 * co-commit atomically with the to-do complete/restore (project atomicity
 * rule). Reads the linked habit fresh, computes the delta with
 * `computeHabitTriggerFire` (the same scoring/streak/multiplier a manual tap
 * uses), and appends the habit doc update, the points increment, and (on fire)
 * an attributed activity-log entry to `batch`.
 *
 * Returns the fired habit's title (for the attribution toast) or `null` when
 * nothing fired — the to-do isn't linked, the habit was deleted, or the toggle
 * was a no-op. Dedup for the to-do trigger is "once per to-do", which the
 * caller's own `isCompleted`/`!isCompleted` idempotency guard already enforces,
 * so no fired-keys ledger is needed here.
 */
async function fireLinkedHabitInBatch(params: {
  db: Firestore;
  batch: WriteBatch;
  householdId: string;
  todo: ToDo;
  direction: 'up' | 'down';
  actor: User | null;
}): Promise<string | null> {
  const { db, batch, householdId, todo, direction, actor } = params;
  const habitId = todo.linkedHabitId;
  if (!habitId) return null;

  const habitSnap = await getDoc(
    doc(db, `households/${householdId}/habits`, habitId).withConverter(habitConverter),
  );
  const habit = habitSnap.data();
  if (!habit) return null; // linked habit deleted — complete the to-do normally

  // An ARCHIVED linked habit must not fire (PRD #1065): the to-do completes
  // normally, no points/streak side effect. A reverse is still allowed so a
  // fire credited before the habit was archived can be undone.
  if (direction === 'up' && habit.archivedAt) return null;

  // 'up' fires like one manual tap. 'down' REVERSES the exact date the fire
  // added — derived from the to-do's completion timestamp — so restoring a
  // to-do completed on a PRIOR day strips that day's completion and debits the
  // points credited THEN, rather than corrupting today's counter/streak.
  const delta =
    direction === 'up'
      ? computeHabitTriggerFire(habit, 'up')
      : computeHabitTriggerReverse(
          habit,
          todo.completedAt
            ? getLocalDateString(new Date(todo.completedAt))
            : getLocalDateString(),
        );
  if (!delta) return null; // no-op (e.g. reversing a habit already at 0)

  batch.update(doc(db, `households/${householdId}/habits`, habitId), {
    // Counters as Firestore increment() DELTAS so a stale-cache device can't
    // clobber a concurrent writer's counter (2026-07-15 incident precedent).
    // EXCEPTION: on a stale-habit lazy-reset (resetCount), the counter is
    // written ABSOLUTELY — the reset discards prior-period garbage outright, so
    // reset-then-increment collapses to `count = 0 + delta` and must NOT route
    // through increment() (which would add to the stale stored value).
    ...(delta.resetCount
      ? { count: delta.count }
      : delta.countDelta !== 0
        ? { count: increment(delta.countDelta) }
        : {}),
    ...(delta.totalCountDelta !== 0 ? { totalCount: increment(delta.totalCountDelta) } : {}),
    // Server-side delta, never the whole array — a stale offline cache must
    // never wholesale-overwrite completion history (2026-07-15 incident).
    ...(delta.addedDate !== undefined ? { completedDates: arrayUnion(delta.addedDate) } : {}),
    ...(delta.removedDate !== undefined ? { completedDates: arrayRemove(delta.removedDate) } : {}),
    streakDays: delta.streakDays,
    lastUpdated: serverTimestamp(),
  });

  if (delta.pointsChange !== 0) {
    batch.update(habitPointsTargetRef(db, householdId, habit.assignedTo), {
      'points.daily': increment(delta.pointsChange),
      'points.weekly': increment(delta.pointsChange),
      'points.total': increment(delta.pointsChange),
    });
  }

  // Attributed activity-log entry — only on a forward fire (a reversal is a
  // correction that shouldn't clutter the feed, matching toggleHabit's 'down'
  // exclusion). "<name> completed <habit> via to-do: <text>".
  if (direction === 'up') {
    const source: TriggerSource = { type: 'todo', todoId: todo.id, label: todo.text };
    const attribution = attributionString(source);
    appendActivityLog(batch, db, householdId, { uid: actor?.uid ?? '', name: actor?.displayName ?? '' }, {
      domain: 'habit',
      action: 'habit_completed',
      summary: `Completed ${habit.title}${attribution ? ` (${attribution})` : ''}`,
    });
  }

  return habit.title;
}

// Pure-ish factories for the to-do mutation family, moved verbatim out of
// FirebaseHouseholdContext. The factories are split by the exact set of
// REACTIVE values each function's original closure captured, so every
// provider `useCallback` constructs a deps object containing only what its
// original closure actually used — its dependency array stays byte-identical
// AND eslint's exhaustive-deps analysis sees no phantom dependencies.
// (Refs and setState setters are hook-stable and ride along where needed.)

/** addToDo — original closure captured `householdId`, `user`. */
export function makeAddToDo(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
}) {
  const { db, householdId, user } = deps;

  /**
   * Adds a new to-do item.
   *
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers (e.g., ToDosPage, Dashboard) should display appropriate success/error toasts based on their context.
   * This maintains consistency with updateToDo and deleteToDo, which also delegate toast messaging to their callers.
   *
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const addToDo = async (todo: Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>) => {
    if (!householdId || !user) {
      throw new Error('User not authenticated or household not selected');
    }
    try {
      const sanitizedToDo = sanitizeFirestoreData(todo);
      await addDoc(collection(db, `households/${householdId}/todos`), {
        ...sanitizedToDo,
        createdAt: serverTimestamp(),
        createdBy: user.uid
      });
      // Note: Toast removed to allow UI-specific messaging (consistent with updateToDo/deleteToDo)
    } catch (error) {
      console.error('[addToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  return { addToDo };
}

/** updateToDo / deleteToDo — original closures captured only `householdId`. */
export function makeTodoCrudMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  /**
   * Updates an existing to-do item.
   *
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers should display appropriate success/error toasts based on their context.
   *
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const updateToDo = async (id: string, updates: Partial<ToDo>) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      const sanitizedUpdates = sanitizeFirestoreData(updates);
      // F-TODO-14: any edit that changes WHEN the reminder should fire re-arms
      // it. reminderSentAt is the server job's sent marker; writing null makes
      // the todo eligible again (null and absent both mean "not sent yet").
      // Only added when the caller didn't set reminderSentAt itself and the
      // edit actually touches a scheduling field, so unrelated updates (star,
      // subtasks, notes...) stay byte-identical to today's writes.
      const touchesReminderSchedule =
        'completeByDate' in updates || 'dueTime' in updates || 'reminderMinutesBefore' in updates;
      if (touchesReminderSchedule && !('reminderSentAt' in updates)) {
        sanitizedUpdates.reminderSentAt = null;
      }
      await updateDoc(doc(db, `households/${householdId}/todos`, id), sanitizedUpdates);
    } catch (error) {
      console.error('[updateToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  /**
   * Deletes a to-do item.
   *
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers should display appropriate success/error toasts based on their context.
   *
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const deleteToDo = async (id: string) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      await deleteDoc(doc(db, `households/${householdId}/todos`, id));
    } catch (error) {
      console.error('[deleteToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  /**
   * Approves a held-for-review to-do capture (`needsReview: true` from the
   * quick-add API — see utils/captureReview.ts): persists any edited fields
   * AND clears the review flag, so the to-do appears in the normal list
   * immediately after. Reuses `updateToDo` above (already a general-purpose
   * field-patch mutation) — no dedicated write path needed.
   *
   * Toast Behavior: unlike `updateToDo`/`deleteToDo` (which delegate toast
   * messaging to their single existing caller, ToDosPage), this is used from
   * exactly one place (the review form) so it owns its own success toast.
   */
  const approveTodo = async (
    id: string,
    overrides?: Partial<Pick<ToDo, 'text' | 'completeByDate' | 'assignedTo' | 'isImportant'>>
  ) => {
    await updateToDo(id, { ...overrides, needsReview: false });
    toast.success('Added to list');
  };

  return { updateToDo, deleteToDo, approveTodo };
}

/**
 * completeToDo — original closure captured `householdId` plus the
 * hook-stable `membersRef`.
 */
export function makeCompleteToDo(deps: {
  db: Firestore;
  householdId: string | null;
  membersRef: { current: HouseholdMember[] };
  user?: User | null;
}) {
  const { db, householdId, membersRef, user = null } = deps;

  /**
   * Commits the completion (and optional points credit) WITHOUT the recurring
   * next-instance spawn. Used as the graceful fallback when the full batch is
   * rejected — e.g. before the Firestore rules whitelist adds the `recurrence`
   * field (see the F-TODO-01 note in the PR), a batch that `set`s a doc with
   * `recurrence` fails, but the user's completion must still succeed. The
   * linked-habit fire (PRD #1065) is re-applied here so the automation isn't
   * lost on the fallback path.
   */
  const commitCompletionOnly = async (
    hid: string,
    todoRef: ReturnType<typeof doc>,
    todo: ToDo,
    credit: ReturnType<typeof computeTodoCompletionCredit>,
    effectiveSubtasks?: Subtask[],
  ): Promise<string | null> => {
    const batch = writeBatch(db);
    batch.update(todoRef, {
      isCompleted: true,
      completedAt: serverTimestamp(),
      ...(effectiveSubtasks ? { subtasks: effectiveSubtasks } : {}),
    });
    if (credit) {
      batch.update(doc(db, `households/${hid}/members`, credit.memberUid), {
        'points.daily': increment(credit.points),
        'points.weekly': increment(credit.points),
        'points.total': increment(credit.points),
      });
    }
    const firedTitle = await fireLinkedHabitInBatch({
      db, batch, householdId: hid, todo, direction: 'up', actor: user,
    });
    await batch.commit();
    return firedTitle;
  };

  /**
   * Marks a to-do item as completed.
   *
   * Toast Behavior: Toast notifications are omitted from this function to allow UI-specific messaging.
   * Callers should display appropriate success/error toasts based on their context, maintaining
   * consistency with addToDo, updateToDo, and deleteToDo.
   *
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const completeToDo = async (
    id: string,
    options?: TodoCompletionOptions,
  ) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    // Double-fire guard: ignore re-entry while a completion for this id is
    // already pending (closes the double-tap window before the getDoc check).
    if (completeToDoInFlight.has(id)) return;
    completeToDoInFlight.add(id);
    try {
      // Plan 080c-5: completing a to-do assigned to a MANAGED KID credits that
      // kid's own member.points (allowance-style). For every other assignee the
      // dormancy gate (computeTodoCompletionCredit) returns null, so the only
      // write is the todo update — byte-for-byte the prior behaviour for normal
      // households with no managed-kid members.
      // Read through the converter so `todo` gets the same synthetic-id
      // injection and legacy-Timestamp normalization every other todo read
      // gets (see todoListeners.ts / loadOlderCompletedTodos below). The
      // batch.update below stays on the unconverted `todoRef` — updateDoc's
      // plain field map (with `serverTimestamp()`) doesn't go through
      // `toFirestore` either way, so this keeps behavior unchanged.
      const todoRef = doc(db, `households/${householdId}/todos`, id);
      const snap = await getDoc(todoRef.withConverter(todoConverter));
      const todo = snap.data();
      if (!todo) {
        throw new Error('To-Do not found');
      }
      if (todo.isCompleted) {
        return; // already completed — idempotent, no duplicate points
      }
      // Inline subtask auto-complete (owner-approved): when checking the LAST
      // subtask escalates to completion, the caller hands a by-id descriptor
      // that we apply to THIS function's OWN fresh read (`todo.subtasks`) — not
      // a stale whole array — so the gate, credit, recurring-spawn, and habit
      // fire all evaluate the FINISHED checklist while a concurrent edit of a
      // DIFFERENT subtask survives, and the merged array is persisted in-batch.
      const subtaskToggle = options?.subtaskToggle;
      const effectiveSubtasks = subtaskToggle
        ? setSubtaskDone(todo.subtasks, subtaskToggle.subtaskId, subtaskToggle.done)
        : undefined;
      const effectiveTodo: ToDo = effectiveSubtasks
        ? { ...todo, subtasks: effectiveSubtasks }
        : todo;
      // Subtask gate (PRD #1065), enforced in the MUTATION so every completion
      // path is covered — not just TodoRow's disabled checkbox. A habit-linked
      // to-do with unfinished subtasks refuses completion with a typed error;
      // call sites surface a "n steps left" message and bulk paths skip it.
      const gate = evaluateTodoSubtaskGate(effectiveTodo);
      if (gate.blocked) {
        throw new TodoSubtasksIncompleteError(effectiveTodo.id, effectiveTodo.text, gate.stepsLeft);
      }
      const credit = computeTodoCompletionCredit(effectiveTodo, membersRef.current);

      // F-TODO-01: for a recurring to-do, spawn the next instance in the SAME
      // writeBatch as the completion so the two can never diverge (matching the
      // payCalendarItem atomicity convention). buildNextRecurringTodo returns
      // null for non-recurring todos, so this is byte-for-byte the prior
      // behaviour for every existing (non-recurring) todo.
      const nextInstance = buildNextRecurringTodo(effectiveTodo, getLocalDateString());

      const batch = writeBatch(db);
      batch.update(todoRef, {
        isCompleted: true,
        completedAt: serverTimestamp(),
        ...(effectiveSubtasks ? { subtasks: effectiveSubtasks } : {}),
      });
      if (credit) {
        // Atomic points credit on the kid member doc (Firestore increment()).
        batch.update(doc(db, `households/${householdId}/members`, credit.memberUid), {
          'points.daily': increment(credit.points),
          'points.weekly': increment(credit.points),
          'points.total': increment(credit.points),
        });
      }
      if (nextInstance) {
        // Pre-generate a doc ref and set() it in-batch (atomic spawn).
        const nextRef = doc(collection(db, `households/${householdId}/todos`));
        batch.set(nextRef, {
          ...sanitizeFirestoreData(nextInstance),
          createdAt: serverTimestamp(),
          createdBy: todo.createdBy,
        });
      }

      // Habit Automations (PRD #1065): fire the linked habit IN this batch so
      // the habit + points writes co-commit atomically with the completion.
      //
      // Residual window (accepted): the completion path stays a writeBatch, not
      // a runTransaction, because the atomic habit fire must co-commit with the
      // completion and `fireLinkedHabitInBatch` reads the linked habit AFTER the
      // to-do write is staged — an ordering a Firestore transaction (all reads
      // before writes) can't express without unwinding the shared batch helper.
      // So the `effectiveSubtasks` array written here is merged from the getDoc
      // read at the TOP of this function, not re-read at commit time: a subtask
      // ADDED by another device between that read and this commit is overwritten.
      // This is far narrower than the old whole-array-override contract (a stale
      // CALLER snapshot could clobber at any age); an auto-complete also ends the
      // to-do's active life, so a lost concurrent add is a corner of a corner.
      // The plain (non-escalating) toggle path DOES use runTransaction — see
      // makeToggleTodoSubtask.
      let firedHabitTitle = await fireLinkedHabitInBatch({
        db, batch, householdId, todo: effectiveTodo, direction: 'up', actor: user,
      });

      try {
        await batch.commit();
      } catch (error) {
        // Graceful degradation: if the spawn write is rejected (e.g. the
        // Firestore rules whitelist has not yet added the `recurrence` field),
        // still complete the task so the user isn't blocked. The next instance
        // simply won't be created until the rules ship.
        if (nextInstance) {
          console.warn('[completeToDo] Recurring spawn rejected; completing without it:', error);
          firedHabitTitle = await commitCompletionOnly(householdId, todoRef, effectiveTodo, credit, effectiveSubtasks);
        } else {
          throw error;
        }
      }

      // Attribution toast: a linked to-do completing fired the habit for the
      // user (PRD #1065). The generic completion toast stays owned by the UI.
      if (firedHabitTitle) {
        toast.success(`Logged "${firedHabitTitle}" via to-do`);
      }
      // Note: Toast removed to allow UI-specific messaging (consistent with other CRUD operations)
    } catch (error) {
      // The subtask gate is an EXPECTED refusal, not a failure — rethrow it
      // quietly so call sites can surface the "n steps left" message without a
      // noisy error log.
      if (!isTodoSubtasksIncompleteError(error)) {
        console.error('[completeToDo] Failed:', error);
      }
      throw error; // Re-throw so callers can handle the error with contextual messaging
    } finally {
      completeToDoInFlight.delete(id);
    }
  };

  return { completeToDo };
}

/**
 * uncompleteToDo — restore a completed to-do to active, reversing any kid
 * points the completion credited, atomically (same deps shape as
 * makeCompleteToDo: `householdId` + the hook-stable `membersRef`).
 */
export function makeUncompleteToDo(deps: {
  db: Firestore;
  householdId: string | null;
  membersRef: { current: HouseholdMember[] };
  user?: User | null;
}) {
  const { db, householdId, membersRef, user = null } = deps;

  /**
   * Marks a completed to-do as active again ("Mark as incomplete" / undo).
   *
   * Counterpart of completeToDo: when the assignee is a MANAGED KID, the
   * completion credited that kid's member.points in the same writeBatch —
   * a plain updateToDo(isCompleted: false) would leave the kid over-credited.
   * This commits the flip AND the negative point increments in ONE writeBatch
   * so they can never diverge (Atomicity convention, CLAUDE.md).
   *
   * Guards:
   * - Reads the live doc first; if it is already active (`!isCompleted`) it
   *   returns without writing — restoring twice can never double-reverse.
   * - `computeTodoCompletionCredit` is the SAME dormancy gate the completion
   *   used: for a non-kid assignee it returns null and the only write is the
   *   todo flip (byte-for-byte the prior updateToDo behaviour).
   * - Note: if the todo's `points` or the assignee's managed status changed
   *   between completion and restore, the reversal uses the CURRENT values —
   *   the completion-time credit isn't persisted on the doc.
   *
   * Toast Behavior: omitted here; callers show contextual toasts (consistent
   * with the other to-do mutations).
   *
   * @throws Re-throws any caught errors so callers can provide contextual error messages
   */
  const uncompleteToDo = async (
    id: string,
    options?: TodoCompletionOptions,
  ) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    try {
      const todoRef = doc(db, `households/${householdId}/todos`, id);
      const snap = await getDoc(todoRef.withConverter(todoConverter));
      const todo = snap.data();
      if (!todo) {
        throw new Error('To-Do not found');
      }
      if (!todo.isCompleted) {
        return; // already active — idempotent, no double reversal
      }
      const credit = computeTodoCompletionCredit(todo, membersRef.current);

      // Inline subtask auto-complete undo (owner-approved): restoring an
      // auto-completed to-do also RE-UNCHECKS the subtask that triggered it. The
      // caller passes a by-id descriptor (`{ subtaskId, done: false }`) applied
      // to THIS function's OWN fresh read, so undo re-unchecks the one triggering
      // step without restoring a stale whole-array snapshot over a concurrent
      // edit of a different subtask.
      const subtaskToggle = options?.subtaskToggle;
      const effectiveSubtasks = subtaskToggle
        ? setSubtaskDone(todo.subtasks, subtaskToggle.subtaskId, subtaskToggle.done)
        : undefined;

      const batch = writeBatch(db);
      batch.update(todoRef, {
        isCompleted: false,
        completedAt: null,
        ...(effectiveSubtasks ? { subtasks: effectiveSubtasks } : {}),
      });
      if (credit) {
        const deltas = buildUncompleteCreditReversal(credit.points, todo.completedAt);
        const pointUpdates: Record<string, unknown> = {};
        for (const [field, delta] of Object.entries(deltas)) {
          pointUpdates[field] = increment(delta);
        }
        batch.update(doc(db, `households/${householdId}/members`, credit.memberUid), pointUpdates);
      }

      // F-TODO-01 counterpart: completing a recurring to-do spawns the next
      // instance in the same batch (see makeCompleteToDo above). Restoring
      // must reconcile that spawn in the SAME batch too, or the household
      // ends up with two active copies of the same chore. Identify the
      // spawned instance the way buildNextRecurringTodo actually links it:
      // it stamps `recurrence.parentRecurringId` with the CHAIN ROOT id (the
      // id of the very first instance, reused indefinitely down the chain —
      // not a back-reference to "the instance that spawned me"), so the
      // strongest identifier available is "same chain root + same text +
      // still active". Only delete when EXACTLY ONE such candidate exists:
      // zero means it was already completed/edited/never spawned (graceful
      // degradation in completeToDo), more than one means we can't tell
      // which is "the" spawn — in both cases, leave every candidate alone
      // rather than guessing.
      if (todo.recurrence && isTodoFrequency(todo.recurrence.frequency)) {
        const chainRootId = todo.recurrence.parentRecurringId ?? todo.id;
        const todosCol = collection(db, `households/${householdId}/todos`).withConverter(todoConverter);
        const candidatesQuery = query(
          todosCol,
          where('isCompleted', '==', false),
          where('recurrence.parentRecurringId', '==', chainRootId),
        );
        const candidatesSnap = await getDocs(candidatesQuery);
        const matches = candidatesSnap.docs.filter(d => d.data().text === todo.text);
        const [onlyMatch] = matches;
        if (matches.length === 1 && onlyMatch) {
          batch.delete(onlyMatch.ref);
        }
      }

      // Habit Automations (PRD #1065): reverse the linked habit fire (points +
      // completedDate) IN this batch, so it can never diverge from the restore
      // (pattern: PR #1060 kid-points reversal). A no-op when the habit was
      // already at 0 or the link/habit is gone.
      const reversedTitle = await fireLinkedHabitInBatch({
        db, batch, householdId, todo, direction: 'down', actor: user,
      });

      await batch.commit();

      if (reversedTitle) {
        toast(`Reversed "${reversedTitle}"`);
      }
    } catch (error) {
      console.error('[uncompleteToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  return { uncompleteToDo };
}

/**
 * Result of a `toggleTodoSubtask` call — tells the UI whether checking the
 * subtask escalated to auto-completing the parent to-do (so it can offer the
 * standard 5s undo) and carries the id of the toggled subtask so undo can
 * re-uncheck it BY ID against `uncompleteToDo`'s own fresh read (rather than
 * restoring a stale whole-array snapshot, which could clobber a concurrent edit).
 */
export interface TodoSubtaskToggleResult {
  /** True when this toggle checked the LAST subtask and auto-completed the parent. */
  autoCompleted: boolean;
  /** The subtask id that was toggled — undo re-unchecks THIS id by descriptor. */
  toggledSubtaskId: string;
}

/**
 * toggleTodoSubtask (owner-approved inline subtask access) — flips one subtask's
 * done state directly from the list row.
 *
 * - Checking a NON-final subtask (or unchecking any subtask) is a plain
 *   subtasks update committed inside a `runTransaction` (read fresh → flip the
 *   one entry by id → write) so two devices toggling DIFFERENT subtasks can't
 *   lose each other's update; it never (un)completes anything.
 * - Checking the LAST remaining subtask on a still-open to-do ESCALATES to
 *   completion: the subtasks write + parent completion + linked-habit fire +
 *   kid-points credit all co-commit in the ONE writeBatch `completeToDo` builds
 *   (via its `subtaskToggle` descriptor), so they can never diverge.
 *
 * Shares `makeCompleteToDo` so the escalation path is byte-identical to a normal
 * completion.
 */
export function makeToggleTodoSubtask(deps: {
  db: Firestore;
  householdId: string | null;
  membersRef: { current: HouseholdMember[] };
  user?: User | null;
}) {
  const { db, householdId, membersRef, user = null } = deps;
  const { completeToDo } = makeCompleteToDo({ db, householdId, membersRef, user });

  const toggleTodoSubtask = async (
    todoId: string,
    subtaskId: string,
  ): Promise<TodoSubtaskToggleResult> => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
    // Unconverted ref for writes (plain field map, no toFirestore); converted
    // ref for typed reads.
    const plainRef = doc(db, `households/${householdId}/todos`, todoId);
    const convRef = plainRef.withConverter(todoConverter);
    const snap = await getDoc(convRef);
    const todo = snap.data();
    if (!todo) {
      throw new Error('To-Do not found');
    }
    const current = (todo.subtasks ?? []).find(s => s.id === subtaskId);
    if (!current) {
      // Subtask no longer exists (removed elsewhere) — nothing to toggle.
      return { autoCompleted: false, toggledSubtaskId: subtaskId };
    }
    const targetDone = !current.isDone;
    const { allDone } = subtaskProgress(setSubtaskDone(todo.subtasks, subtaskId, targetDone));

    // Escalate only when this toggle CHECKS the last remaining step on a
    // still-open to-do. `completeToDo` applies the SAME by-id flip to its own
    // fresh read, co-committing the subtask write + completion + linked-habit
    // fire + kid points in one batch.
    if (!todo.isCompleted && targetDone && allDone) {
      await completeToDo(todoId, { subtaskToggle: { subtaskId, done: true } });
      return { autoCompleted: true, toggledSubtaskId: subtaskId };
    }

    // Plain toggle: run inside a runTransaction (read fresh → set THIS id by
    // descriptor → write) so two devices toggling DIFFERENT subtasks can't lose
    // each other's update — the transaction re-reads and merges on write
    // contention instead of overwriting with a stale array.
    await runTransaction(db, async (transaction) => {
      const freshSnap = await transaction.get(convRef);
      const fresh = freshSnap.data();
      if (!fresh) {
        throw new Error('To-Do not found');
      }
      transaction.update(plainRef, {
        subtasks: setSubtaskDone(fresh.subtasks, subtaskId, targetDone),
      });
    });
    return { autoCompleted: false, toggledSubtaskId: subtaskId };
  };

  return { toggleTodoSubtask };
}

// --- F-TODO-16: to-do categories ---------------------------------------------

/** Firestore's hard cap on operations in a single `writeBatch`. */
export const FIRESTORE_BATCH_LIMIT = 500;

/**
 * Splits a list of pending writes into batch-sized chunks so a rename/delete
 * that touches more to-dos than Firestore allows in one `writeBatch` still
 * commits (as a sequence of batches). Pure and exported so the 500-op boundary
 * is unit-testable without a Firestore.
 *
 * Note the resulting commits are NOT one atomic unit — see the ordering comment
 * on `makeTodoCategoryEditMutations` for why that is acceptable here.
 */
export function chunkForBatches<T>(
  items: readonly T[],
  size: number = FIRESTORE_BATCH_LIMIT,
): T[][] {
  if (size < 1) throw new Error('chunkForBatches: size must be at least 1');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Category comparison key: trimmed + lowercased ('' for absent/blank). */
function categoryKey(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Every to-do (active AND completed) that currently carries a category, read
 * through the converter. `orderBy('category')` is the cheap way to ask Firestore
 * for "docs where this field EXISTS" — uncategorized to-dos are excluded from
 * the result set entirely, so a rename/delete never pages through them. The
 * case-insensitive match itself is done in memory because Firestore equality is
 * case-sensitive and the stored spelling is whatever the user typed.
 */
async function fetchTodosInCategory(db: Firestore, householdId: string, key: string) {
  const todosCol = collection(db, `households/${householdId}/todos`).withConverter(todoConverter);
  const snap = await getDocs(query(todosCol, orderBy('category')));
  return snap.docs.filter(d => categoryKey(d.data().category) === key);
}

/**
 * updateTodoCategories — original closure captures only `householdId`.
 *
 * Persists the household's to-do category vocabulary to the household doc with a
 * single `updateDoc` — the chip pickers call it with
 * `[...todoCategories, newName]`.
 *
 * Toast Behavior: none here, matching `updateToDo`/`deleteToDo` above — the
 * callers (the chip picker's inline editor, the category manager drawer) own
 * both the success and the failure message, and they can only do that honestly
 * if a failed write actually REJECTS.
 *
 * @throws Re-throws any caught error so callers don't report success for a write
 *         that never landed.
 */
export function makeUpdateTodoCategories(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const updateTodoCategories = async (categories: string[]) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, `households/${householdId}`), {
        todoCategories: categories,
      });
    } catch (error) {
      console.error('[updateTodoCategories] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  return { updateTodoCategories };
}

/**
 * renameTodoCategory / deleteTodoCategory — closures capture `householdId` and
 * the household's current `todoCategories` list (the new list is derived from
 * it, exactly as the habit chip picker derives its append).
 *
 * Both rewrite EVERY matching to-do — active and completed — in chunked
 * `writeBatch`es (Firestore caps a batch at 500 ops, see `chunkForBatches`).
 *
 * Ordering matters because multiple batches are not one atomic unit: the to-do
 * rewrites commit FIRST and the household vocabulary list LAST. A failure part
 * way through therefore leaves the old name still listed rather than dropping a
 * category whose tasks still point at it — and a retry CONVERGES, because the
 * re-run re-queries by the old name and so only touches the to-dos the failed
 * run hadn't rewritten yet (covered in todoCategoryMutations.test.ts).
 *
 * Toast Behavior: none here — both functions RE-THROW so their single caller
 * (TodoCategoryManagerDrawer) owns the success/failure message and can keep its
 * rename editor open when the write didn't land.
 */
export function makeTodoCategoryEditMutations(deps: {
  db: Firestore;
  householdId: string | null;
  todoCategories: string[];
}) {
  const { db, householdId, todoCategories } = deps;

  /**
   * Renames a category across the whole household.
   *
   * - Matching is case-INSENSITIVE, so a pure typo fix ('home' → 'Home') really
   *   does rewrite the tasks instead of silently matching nothing.
   * - A no-op (resolves immediately, no writes) when the new name is blank or
   *   identical to the old one.
   * - If the new name collides case-insensitively with an ANOTHER existing
   *   category, the rename MERGES into it: tasks are rewritten to that
   *   category's stored spelling and the old entry is dropped from the list —
   *   never producing two vocabulary entries that differ only by case.
   *
   * @throws Re-throws any caught error (see the toast note above).
   */
  const renameTodoCategory = async (oldName: string, newName: string) => {
    if (!householdId) return;
    const trimmedNew = newName.trim();
    if (!trimmedNew || trimmedNew === oldName) return;

    const oldKey = categoryKey(oldName);
    if (!oldKey) return; // nothing identifiable to rename

    // Merge target: an existing entry that collides with the new name (other
    // than the entry being renamed). Its stored spelling wins.
    const mergeTarget = todoCategories.find(
      c => categoryKey(c) === categoryKey(trimmedNew) && categoryKey(c) !== oldKey,
    );
    const targetName = mergeTarget ?? trimmedNew;
    const targetKey = categoryKey(targetName);

    // Rebuild the vocabulary in place (order preserved), replacing the renamed
    // entry and de-duping case-insensitively so a merge collapses to one entry.
    const nextCategories: string[] = [];
    const seen = new Set<string>();
    for (const category of todoCategories) {
      const value = categoryKey(category) === oldKey ? targetName : category;
      const key = categoryKey(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      nextCategories.push(value);
    }
    // The old name may live only on to-dos (a legacy/imported value that was
    // never added to the list) — make sure the target still ends up listed.
    if (!seen.has(targetKey)) nextCategories.push(targetName);

    try {
      const matching = await fetchTodosInCategory(db, householdId, oldKey);
      for (const chunk of chunkForBatches(matching)) {
        const batch = writeBatch(db);
        for (const todoDoc of chunk) {
          batch.update(todoDoc.ref, { category: targetName });
        }
        await batch.commit();
      }
      await updateDoc(doc(db, `households/${householdId}`), {
        todoCategories: nextCategories,
      });
    } catch (error) {
      console.error('[renameTodoCategory] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  /**
   * Removes a category from the household vocabulary AND clears it from every
   * to-do that used it, so those tasks fall back to Uncategorized.
   *
   * The field is removed with `deleteField()` rather than set to `''`: the
   * sort/group/color helpers treat an ABSENT (or null) category as
   * Uncategorized, and leaving an empty string behind would put a blank chip in
   * the vocabulary-derived UI. Note "absent" is not an invariant the whole app
   * upholds — clearing the category from the to-do FORM passes `undefined`
   * through `updateToDo`, and `sanitizeFirestoreData` turns both `undefined` and
   * `''` into `null` — so consumers must handle absent AND null. This path just
   * picks the cleaner of the two.
   *
   * @throws Re-throws any caught error (see the toast note above).
   */
  const deleteTodoCategory = async (name: string) => {
    if (!householdId) return;
    const key = categoryKey(name);
    if (!key) return;

    const nextCategories = todoCategories.filter(c => categoryKey(c) !== key);

    try {
      const matching = await fetchTodosInCategory(db, householdId, key);
      for (const chunk of chunkForBatches(matching)) {
        const batch = writeBatch(db);
        for (const todoDoc of chunk) {
          batch.update(todoDoc.ref, { category: deleteField() });
        }
        await batch.commit();
      }
      await updateDoc(doc(db, `households/${householdId}`), {
        todoCategories: nextCategories,
      });
    } catch (error) {
      console.error('[deleteTodoCategory] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  return { renameTodoCategory, deleteTodoCategory };
}

/**
 * loadOlderCompletedTodos — original closure captured `householdId` plus the
 * hook-stable cursor/window refs and setState setters.
 */
export function makeLoadOlderCompletedTodos(deps: {
  db: Firestore;
  householdId: string | null;
  completedTodoWindowStartRef: { current: Date | null };
  completedTodoCursorRef: { current: QueryDocumentSnapshot<DocumentData> | null };
  setIsLoadingOlderTodos: (v: boolean) => void;
  setOlderCompletedTodos: (updater: (prev: ToDo[]) => ToDo[]) => void;
  setHasMoreCompletedTodos: (v: boolean) => void;
}) {
  const {
    db, householdId,
    completedTodoWindowStartRef, completedTodoCursorRef,
    setIsLoadingOlderTodos, setOlderCompletedTodos, setHasMoreCompletedTodos,
  } = deps;

  const loadOlderCompletedTodos = async () => {
    const windowStart = completedTodoWindowStartRef.current;
    if (!householdId || !windowStart) return;
    setIsLoadingOlderTodos(true);
    try {
      const todosCol = collection(db, `households/${householdId}/todos`).withConverter(todoConverter);
      const cursor = completedTodoCursorRef.current;
      const olderQuery = cursor
        ? query(todosCol, where('isCompleted', '==', true), orderBy('completedAt', 'desc'), startAfter(cursor), limit(TODO_COMPLETED_PAGE_SIZE))
        : query(todosCol, where('isCompleted', '==', true), where('completedAt', '<', Timestamp.fromDate(windowStart)), orderBy('completedAt', 'desc'), limit(TODO_COMPLETED_PAGE_SIZE));
      const snap = await getDocs(olderQuery);
      if (snap.docs.length > 0) {
        completedTodoCursorRef.current = snap.docs[snap.docs.length - 1] ?? null;
        const page = snap.docs.map(mapTodoDoc);
        setOlderCompletedTodos(prev => mergeById(prev, page));
      }
      setHasMoreCompletedTodos(snap.docs.length === TODO_COMPLETED_PAGE_SIZE);
    } catch (error) {
      console.error('[loadOlderCompletedTodos] Failed:', error);
      toast.error(describeError(error, 'load older completed tasks', 'read'));
    } finally {
      setIsLoadingOlderTodos(false);
    }
  };

  return { loadOlderCompletedTodos };
}
