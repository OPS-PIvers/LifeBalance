import { useEffect, useMemo, useRef } from 'react';
import type { ShoppingItem, Subtask, ToDo } from '@/types/schema';
import { withoutId } from '@/utils/wall/wallLists';
import { setSubtaskDone, subtaskProgress } from '@/utils/subtasks';
import { evaluateTodoSubtaskGate } from '@/utils/todoSubtaskGate';
import { useWallData } from '@/components/wall/data/wallData';
import { useWallToaster, type WallToaster } from '@/components/wall/wallToast';

type NewTodo = Omit<ToDo, 'id' | 'createdAt' | 'createdBy'>;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * Every list write on the wall, each with its toast and Undo (plan §3: "Undo
 * for every write"). All of them go through WallData.actions, i.e. the
 * app's own mutation factories, so kid points are credited and reversed
 * exactly as on the phone.
 *
 * Adds can't learn their new doc id (an offline write resolves only when it
 * reaches the server), so Undo removes the items that appeared after the add
 * with the added names. The listeners show a pending local write at once,
 * offline included, so they're already in the list by the time Undo is tapped.
 */
export function useWallListActions(ownToaster?: WallToaster) {
  const { shoppingList, todos, actions } = useWallData();
  // WallApp owns the toast slot and sits above its own provider, so it passes it in.
  const contextToaster = useWallToaster();
  const toaster = ownToaster ?? contextToaster;
  const latest = useRef({ shoppingList, todos });
  useEffect(() => {
    latest.current = { shoppingList, todos };
  }, [shoppingList, todos]);

  return useMemo(() => {
    const removeNewShopping = (before: Set<string>, names: string[]) => async () => {
      const added = latest.current.shoppingList.filter(i => !before.has(i.id) && names.includes(i.name));
      await Promise.all(added.map(i => actions.deleteShoppingItem(i.id)));
    };
    const removeNewTodos = (before: Set<string>, text: string) => async () => {
      const added = latest.current.todos.filter(t => !before.has(t.id) && t.text === text);
      await Promise.all(added.map(t => actions.deleteToDo(t.id)));
    };

    return {
      toggleShopping: (item: ShoppingItem) =>
        toaster.run(
          actions.toggleShoppingItemPurchased(item.id),
          item.isPurchased ? `Unchecked ${item.name}` : `Checked off ${item.name}`,
          () => actions.toggleShoppingItemPurchased(item.id)
        ),
      deleteShopping: (item: ShoppingItem) =>
        toaster.run(actions.deleteShoppingItem(item.id), `Deleted “${item.name}”`, () => actions.addShoppingItem(withoutId(item))),
      clearCart: () => {
        const removed = latest.current.shoppingList.filter(i => i.isPurchased);
        if (removed.length === 0) return;
        toaster.run(actions.clearPurchasedShoppingItems(), `Cleared ${plural(removed.length, 'checked item')}`, async () => {
          await Promise.all(removed.map(i => actions.addShoppingItem(withoutId(i))));
        });
      },
      addShopping: (items: Omit<ShoppingItem, 'id'>[], text?: string) => {
        if (items.length === 0) return;
        const before = new Set(latest.current.shoppingList.map(i => i.id));
        toaster.run(
          Promise.all(items.map(i => actions.addShoppingItem(i))),
          text ?? `Added ${items.map(i => i.name).join(', ')}`,
          removeNewShopping(before, items.map(i => i.name))
        );
      },
      toggleTodo: (todo: ToDo) => {
        if (todo.isCompleted) {
          toaster.run(actions.uncompleteToDo(todo.id), `Unchecked ${todo.text}`, () => actions.completeToDo(todo.id));
          return;
        }
        // A habit-linked to-do refuses completion until every step is done;
        // say so instead of letting the write fail as "Couldn't save".
        const gate = evaluateTodoSubtaskGate(todo);
        if (gate.blocked) {
          toaster.show(`Check off ${plural(gate.stepsLeft, 'step')} first`);
          return;
        }
        toaster.run(actions.completeToDo(todo.id), `Completed ${todo.text}`, () => actions.uncompleteToDo(todo.id));
      },
      /**
       * Checks or unchecks one step. Checking the last open step completes the
       * to-do (the mutation does both in one batch), so Undo reads the
       * write's own result to know which of the two to reverse.
       */
      toggleSubtask: (todo: ToDo, subtask: Subtask) => {
        const checking = !subtask.isDone;
        const finishes = checking && !todo.isCompleted && subtaskProgress(setSubtaskDone(todo.subtasks, subtask.id, true)).allDone;
        const write = actions.toggleTodoSubtask(todo.id, subtask.id);
        toaster.run(
          write,
          finishes ? `Completed ${todo.text}` : checking ? `Checked off ${subtask.text}` : `Unchecked ${subtask.text}`,
          async () => {
            const result = await write;
            if (result.autoCompleted) {
              await actions.uncompleteToDo(todo.id, { subtaskToggle: { subtaskId: subtask.id, done: false } });
            } else {
              await actions.toggleTodoSubtask(todo.id, subtask.id);
            }
          }
        );
      },
      deleteTodo: (todo: ToDo) => {
        const { createdAt: _createdAt, createdBy: _createdBy, ...rest } = withoutId(todo);
        toaster.run(actions.deleteToDo(todo.id), `Deleted “${todo.text}”`, () => actions.addToDo(rest));
      },
      addTodo: (todo: NewTodo) => {
        const before = new Set(latest.current.todos.map(t => t.id));
        toaster.run(actions.addToDo(todo), `Added ${todo.text}`, removeNewTodos(before, todo.text));
      },
    };
  }, [actions, toaster]);
}
