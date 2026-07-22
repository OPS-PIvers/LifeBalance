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
  writeBatch,
  serverTimestamp,
  Timestamp,
  type Firestore,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { todoConverter } from '@/utils/firestoreConverters';
import { ToDo, HouseholdMember } from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { computeTodoCompletionCredit, buildUncompleteCreditReversal } from '@/utils/todoPoints';
import { buildNextRecurringTodo, isTodoFrequency } from '@/utils/todoRecurrence';
import { getLocalDateString } from '@/utils/dateHelpers';
import { TODO_COMPLETED_PAGE_SIZE } from '@/utils/listenerWindows';
import { mergeById, mapTodoDoc } from '@/contexts/household/selectors';
import type { User } from 'firebase/auth';

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
}) {
  const { db, householdId, membersRef } = deps;

  /**
   * Commits the completion (and optional points credit) WITHOUT the recurring
   * next-instance spawn. Used as the graceful fallback when the full batch is
   * rejected — e.g. before the Firestore rules whitelist adds the `recurrence`
   * field (see the F-TODO-01 note in the PR), a batch that `set`s a doc with
   * `recurrence` fails, but the user's completion must still succeed.
   */
  const commitCompletionOnly = async (
    hid: string,
    todoRef: ReturnType<typeof doc>,
    credit: ReturnType<typeof computeTodoCompletionCredit>,
  ) => {
    const batch = writeBatch(db);
    batch.update(todoRef, { isCompleted: true, completedAt: serverTimestamp() });
    if (credit) {
      batch.update(doc(db, `households/${hid}/members`, credit.memberUid), {
        'points.daily': increment(credit.points),
        'points.weekly': increment(credit.points),
        'points.total': increment(credit.points),
      });
    }
    await batch.commit();
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
  const completeToDo = async (id: string) => {
    if (!householdId) {
      throw new Error('Household not selected');
    }
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
      const credit = computeTodoCompletionCredit(todo, membersRef.current);

      // F-TODO-01: for a recurring to-do, spawn the next instance in the SAME
      // writeBatch as the completion so the two can never diverge (matching the
      // payCalendarItem atomicity convention). buildNextRecurringTodo returns
      // null for non-recurring todos, so this is byte-for-byte the prior
      // behaviour for every existing (non-recurring) todo.
      const nextInstance = buildNextRecurringTodo(todo, getLocalDateString());

      const batch = writeBatch(db);
      batch.update(todoRef, {
        isCompleted: true,
        completedAt: serverTimestamp(),
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

      try {
        await batch.commit();
      } catch (error) {
        // Graceful degradation: if the spawn write is rejected (e.g. the
        // Firestore rules whitelist has not yet added the `recurrence` field),
        // still complete the task so the user isn't blocked. The next instance
        // simply won't be created until the rules ship.
        if (nextInstance) {
          console.warn('[completeToDo] Recurring spawn rejected; completing without it:', error);
          await commitCompletionOnly(householdId, todoRef, credit);
        } else {
          throw error;
        }
      }
      // Note: Toast removed to allow UI-specific messaging (consistent with other CRUD operations)
    } catch (error) {
      console.error('[completeToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
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
}) {
  const { db, householdId, membersRef } = deps;

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
  const uncompleteToDo = async (id: string) => {
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

      const batch = writeBatch(db);
      batch.update(todoRef, { isCompleted: false, completedAt: null });
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

      await batch.commit();
    } catch (error) {
      console.error('[uncompleteToDo] Failed:', error);
      throw error; // Re-throw so callers can handle the error with contextual messaging
    }
  };

  return { uncompleteToDo };
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
