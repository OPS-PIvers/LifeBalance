import React, { useMemo, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTodos } from '@/contexts/FirebaseHouseholdContext';
import { getTodoCategoryColor, UNCATEGORIZED_LABEL } from '@/utils/todoCategoryColor';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SurfaceList, Row } from '@/components/ui/Section';
import Input from '@/components/ui/Input';
import { cn } from '@/utils/cn';
import { describeError } from '@/utils/errorMessages';
import { MAX_TODO_CATEGORY_LENGTH } from '@/utils/todoCategoryLimits';

/**
 * Usage counts are a FLOOR, not a total: they are derived from the `todos`
 * context slice, whose completed-to-do listener is windowed to the recent past
 * (see contexts/household/listeners/todoListeners.ts + utils/listenerWindows.ts)
 * with older completions paged in on demand. The rename/delete mutations query
 * Firestore directly and rewrite EVERY match including those older completions,
 * so the copy here says "at least" rather than asserting a total the client
 * cannot know without an extra read.
 */
const taskCountLabel = (count: number): string =>
  count === 0 ? 'No recent tasks' : `${count}+ ${count === 1 ? 'task' : 'tasks'}`;

/** Case-insensitive key used for both usage counts and duplicate detection. */
const normalize = (value: string): string => value.trim().toLowerCase();

export interface TodoCategoryManagerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * F-TODO-16 — manage the household's to-do category vocabulary (add / rename /
 * delete), the sibling of ShoppingSettingsModal's grocery-category tab.
 *
 * The three mutations behind it differ in blast radius, and the UI reflects
 * that:
 * - ADD only rewrites the household's vocabulary array, so it is a plain
 *   optimistic-feeling inline form;
 * - RENAME rewrites `category` on every matching to-do (active AND completed) in
 *   chunked batches, so the row locks and shows a spinner while it runs;
 * - DELETE clears the field from every matching to-do, so it goes through
 *   ConfirmDialog with the concrete count of tasks that will fall back to
 *   Uncategorized.
 *
 * Counts are computed case-insensitively over the LOADED to-dos (a task stored
 * as "home" counts toward "Home"), matching how the mutations match documents —
 * but see `taskCountLabel`: they are a floor, because old completed tasks live
 * outside the listener window while the mutations still rewrite them.
 *
 * This drawer owns BOTH the success and the failure message for all three
 * mutations (they re-throw and toast nothing themselves), so a rejected write
 * never reads as a success: the rename editor stays open with the typed name and
 * the delete confirmation stays put.
 * Motion/focus/Escape are the Drawer primitive's job (it already honors
 * prefers-reduced-motion and traps focus), so nothing extra is wired here.
 */
export const TodoCategoryManagerDrawer: React.FC<TodoCategoryManagerDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const { todos, todoCategories, updateTodoCategories, renameTodoCategory, deleteTodoCategory } =
    useTodos();

  // Add form
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Inline rename
  const [editing, setEditing] = useState<{ original: string; draft: string } | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<{ name: string; count: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Reset transient UI each time the sheet reopens. Render-phase state sync
  // (the TaskTemplateDrawer pattern) rather than an effect, so there is no
  // set-state-in-effect suppression to justify.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setNewName('');
      setAddError(null);
      setEditing(null);
      setPendingDelete(null);
      // Clear the in-flight guards too. Closing the sheet mid-write (a swipe
      // down) and reopening otherwise left them set until the old promise
      // resolved, and both gate EVERY row's controls — so the whole drawer
      // read as broken rather than just the row being written. The stale
      // promise's `finally` only re-clears what is already null, and the
      // mutations converge on a retry, so a second action started in that
      // window is safe.
      setRenamingName(null);
      setIsDeleting(false);
    }
  }

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of todos) {
      const key = normalize(todo.category ?? '');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [todos]);

  const countFor = (name: string): number => usageCounts.get(normalize(name)) ?? 0;
  // A blank/absent category is the Uncategorized bucket (see ToDo.category).
  const uncategorizedCount = usageCounts.get('') ?? 0;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isAdding) return; // in-flight guard: a double-tap must not append twice

    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Give the category a name.');
      return;
    }
    if (trimmed.length > MAX_TODO_CATEGORY_LENGTH) {
      setAddError(`Keep it to ${MAX_TODO_CATEGORY_LENGTH} characters or fewer.`);
      return;
    }
    const existing = todoCategories.find(category => normalize(category) === normalize(trimmed));
    if (existing) {
      setAddError(`"${existing}" is already on the list.`);
      return;
    }

    setIsAdding(true);
    try {
      await updateTodoCategories([...todoCategories, trimmed]);
      setNewName('');
      setAddError(null);
      toast.success(`Added "${trimmed}"`);
    } catch (error) {
      console.error('[TodoCategoryManagerDrawer] Add category failed:', error);
      // The write didn't land: keep the typed name in the field and report it
      // where the user is looking (the mutation toasts nothing).
      setAddError(describeError(error, 'add the category'));
    } finally {
      setIsAdding(false);
    }
  };

  const handleRenameSave = async () => {
    if (!editing || renamingName) return;

    const { original, draft } = editing;
    const trimmed = draft.trim();
    // Blank or unchanged is a cancel, not a write.
    if (!trimmed || trimmed === original) {
      setEditing(null);
      return;
    }
    if (trimmed.length > MAX_TODO_CATEGORY_LENGTH) {
      toast.error(`Keep it to ${MAX_TODO_CATEGORY_LENGTH} characters or fewer.`);
      return;
    }

    // The mutation MERGES when the new name collides case-insensitively with a
    // different existing category (tasks adopt that category's stored spelling).
    // Resolve the same target here so the confirmation matches what happened
    // instead of claiming a rename to the typed spelling.
    const mergeTarget = todoCategories.find(
      category => normalize(category) === normalize(trimmed) && normalize(category) !== normalize(original),
    );

    setRenamingName(original);
    try {
      await renameTodoCategory(original, trimmed);
      toast.success(mergeTarget ? `Merged into "${mergeTarget}"` : `Renamed to "${trimmed}"`);
      setEditing(null);
    } catch (error) {
      console.error('[TodoCategoryManagerDrawer] Rename category failed:', error);
      // The write didn't land — report it and leave the editor open so the
      // entered name isn't lost.
      toast.error(describeError(error, 'rename the category'));
    } finally {
      setRenamingName(null);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete || isDeleting) return;
    const { name } = pendingDelete;

    setIsDeleting(true);
    try {
      await deleteTodoCategory(name);
      toast.success(`Deleted "${name}"`);
      setPendingDelete(null);
    } catch (error) {
      console.error('[TodoCategoryManagerDrawer] Delete category failed:', error);
      // The category is still there — report it and KEEP the confirmation open
      // so the user can retry without hunting for the row again.
      toast.error(describeError(error, 'delete the category'));
    } finally {
      setIsDeleting(false);
    }
  };

  // The count is a floor (see taskCountLabel), so the copy never promises an
  // exact total: every to-do using the category is cleared, including completed
  // ones older than the loaded window.
  const deleteMessage = pendingDelete
    ? `Delete "${pendingDelete.name}"? ${
        pendingDelete.count === 0
          ? `No recent tasks are using it; any older completed ones become ${UNCATEGORIZED_LABEL}.`
          : `At least ${pendingDelete.count} ${
              pendingDelete.count === 1 ? 'task' : 'tasks'
            } (plus any older completed ones) will become ${UNCATEGORIZED_LABEL}.`
      } This can't be undone.`
    : '';

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="To-do categories">
      <div className="space-y-4">
        <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
          Categories group your to-dos — &quot;Home&quot;, &quot;Work&quot;, &quot;Errands&quot;.
          Every task can have one, and renaming or deleting one updates every task using it.
        </p>

        <form onSubmit={handleAdd} className="flex items-end gap-2" aria-busy={isAdding}>
          <Input
            label="New category"
            value={newName}
            onChange={event => {
              setNewName(event.target.value);
              if (addError) setAddError(null);
            }}
            placeholder="e.g. Errands"
            maxLength={MAX_TODO_CATEGORY_LENGTH}
            error={addError ?? undefined}
            disabled={isAdding}
          />
          <Button
            type="submit"
            leftIcon={<Plus size={16} />}
            isLoading={isAdding}
            // Aligns the button with the input box itself, below Input's label
            // row; the error message renders under the field, not the button.
            className={cn('shrink-0', addError && 'self-center')}
          >
            Add
          </Button>
        </form>

        {todoCategories.length === 0 ? (
          <p className="text-sm text-brand-500 dark:text-brand-400 px-1 py-2">
            No categories yet. Add one above and it&apos;ll be there the next time you write a task.
          </p>
        ) : (
          <SurfaceList>
            {todoCategories.map(category => {
              const color = getTodoCategoryColor(category);
              const isEditing = editing?.original === category;
              const isRenaming = renamingName === category;
              const rowBusy = isRenaming || isDeleting;

              return (
                <Row key={category} aria-busy={isRenaming}>
                  {isEditing ? (
                    <>
                      <input
                        type="text"
                        value={editing.draft}
                        onChange={event => setEditing({ original: category, draft: event.target.value })}
                        onKeyDown={event => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleRenameSave();
                          } else if (event.key === 'Escape') {
                            event.preventDefault();
                            setEditing(null);
                          }
                        }}
                        // Distinct from the pencil button's "Rename X" label, so
                        // the field and the control that opened it never share an
                        // accessible name.
                        aria-label={`New name for ${category}`}
                        maxLength={MAX_TODO_CATEGORY_LENGTH}
                        autoFocus
                        disabled={rowBusy}
                        className="flex-1 min-w-0 p-2 rounded-btn bg-brand-50 dark:bg-brand-700/50 border border-brand-200 dark:border-brand-600 text-sm text-brand-900 dark:text-brand-50 focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 disabled:opacity-50"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void handleRenameSave()}
                        disabled={rowBusy}
                        aria-label={`Save name for ${category}`}
                        className="shrink-0 text-money-pos hover:bg-money-bgPos dark:text-money-posDark dark:hover:bg-money-pos/15"
                      >
                        {isRenaming ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Check size={16} />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(null)}
                        disabled={rowBusy}
                        aria-label={`Cancel renaming ${category}`}
                        className="shrink-0"
                      >
                        <X size={16} />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold truncate',
                            color.bg,
                            color.text,
                            color.border
                          )}
                        >
                          {category}
                        </span>
                        <span className="mt-1 block text-xs text-brand-500 dark:text-brand-400">
                          {taskCountLabel(countFor(category))}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing({ original: category, draft: category })}
                        disabled={rowBusy || renamingName !== null}
                        aria-label={`Rename ${category}`}
                        className="shrink-0 text-brand-400 hover:text-brand-600 dark:text-brand-450 dark:hover:text-brand-300"
                      >
                        {isRenaming ? (
                          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Pencil size={16} />
                        )}
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="icon-sm"
                        onClick={() =>
                          setPendingDelete({ name: category, count: countFor(category) })
                        }
                        disabled={rowBusy || renamingName !== null}
                        aria-label={`Delete ${category}`}
                        className="shrink-0"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </>
                  )}
                </Row>
              );
            })}

            {/* Read-only tail row: tasks with no category. Not part of the
                vocabulary, so it has no rename/delete controls — it just makes
                the "where did the rest of my tasks go" question answerable. */}
            {uncategorizedCount > 0 && (
              <Row>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                      getTodoCategoryColor(undefined).bg,
                      getTodoCategoryColor(undefined).text,
                      getTodoCategoryColor(undefined).border
                    )}
                  >
                    {UNCATEGORIZED_LABEL}
                  </span>
                  <span className="mt-1 block text-xs text-brand-500 dark:text-brand-400">
                    {taskCountLabel(uncategorizedCount)}
                  </span>
                </span>
              </Row>
            )}
          </SurfaceList>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => {
          if (!isDeleting) setPendingDelete(null);
        }}
        onConfirm={() => void handleDeleteConfirmed()}
        title="Delete category"
        message={deleteMessage}
        confirmLabel="Delete"
        confirmVariant="destructive"
        isConfirming={isDeleting}
      />
    </Drawer>
  );
};

export default TodoCategoryManagerDrawer;
