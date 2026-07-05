import {
  collection,
  query,
  onSnapshot,
  where,
  orderBy,
  Timestamp,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { todoConverter } from '@/utils/firestoreConverters';
import { ToDo } from '@/types/schema';
import { getCompletedTodoWindowStart } from '@/utils/listenerWindows';
import { mapTodoDoc } from '@/contexts/household/selectors';

/**
 * Attaches the two to-do listeners (verbatim move from
 * FirebaseHouseholdContext's main listener effect):
 *  - all active (`isCompleted === false`) items, always live
 *  - completed items within the last 30 days (older completions are loaded
 *    on demand via `loadOlderCompletedTodos()`)
 *
 * `completedTodoWindowStartRef` is written into here (as it was inline
 * before) so the on-demand loader can read the same window bound.
 */
export function attachTodoListeners({
  db,
  householdId,
  completedTodoWindowStartRef,
  setActiveTodos,
  setCompletedTodos,
}: {
  db: Firestore;
  householdId: string;
  completedTodoWindowStartRef: { current: Date | null };
  setActiveTodos: (todos: ToDo[]) => void;
  setCompletedTodos: (todos: ToDo[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // To-Do listeners — all active items are live; completed items are limited to
  // the last 30 days (older completions load on demand via loadOlderCompletedTodos()).
  const activeTodosQuery = query(
    collection(db, `households/${householdId}/todos`).withConverter(todoConverter),
    where('isCompleted', '==', false)
  );
  unsubscribers.push(
    onSnapshot(activeTodosQuery, (snapshot) => {
      setActiveTodos(snapshot.docs.map(mapTodoDoc));
    }, (error) => {
      console.error('Error listening to active todos:', error);
    })
  );

  const completedWindowStart = getCompletedTodoWindowStart();
  completedTodoWindowStartRef.current = completedWindowStart;
  const completedTodosQuery = query(
    collection(db, `households/${householdId}/todos`).withConverter(todoConverter),
    where('isCompleted', '==', true),
    where('completedAt', '>=', Timestamp.fromDate(completedWindowStart)),
    orderBy('completedAt', 'desc')
  );
  unsubscribers.push(
    onSnapshot(completedTodosQuery, (snapshot) => {
      setCompletedTodos(snapshot.docs.map(mapTodoDoc));
    }, (error) => {
      console.error('Error listening to completed todos:', error);
    })
  );

  return unsubscribers;
}
