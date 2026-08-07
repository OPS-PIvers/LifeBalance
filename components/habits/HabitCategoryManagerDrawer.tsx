import React, { useMemo, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import {
  habitCategoryKey,
  habitCategoryVocabulary,
  UNCATEGORIZED_HABIT_CATEGORY,
} from '@/utils/habitCategories';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SurfaceList, Row } from '@/components/ui/Section';
import Input from '@/components/ui/Input';
import { cn } from '@/utils/cn';
import { describeError } from '@/utils/errorMessages';

/**
 * Usage counts here are EXACT, unlike TodoCategoryManagerDrawer's "at least N"
 * floor: the habits listener is unwindowed (the whole subcollection, archived
 * habits and kid chores included — see gamificationListeners.ts), so the
 * `habits` slice is everything the rename/delete mutations will rewrite.
 */
const habitCountLabel = (count: number): string =>
  count === 0 ? 'No habits' : `${count} ${count === 1 ? 'habit' : 'habits'}`;

export interface HabitCategoryManagerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Manage the household's habit category vocabulary (add / rename / delete) —
 * the habits-side sibling of TodoCategoryManagerDrawer, and the reason habit
 * categories stopped being an append-only pile with no way out.
 *
 * The rows are the DERIVED vocabulary (`habitCategoryVocabulary`), not the raw
 * `habitCategories` array: several categories real habits use were never
 * recorded in the stored list, and a manager that couldn't see them would leave
 * exactly the categories the user wants to fix unreachable. Renaming one of
 * those adds the new name to the stored list, so it heals on the way past.
 *
 * The three mutations differ in blast radius, and the UI reflects that:
 * - ADD only rewrites the household's vocabulary array, so it is a plain
 *   inline form;
 * - RENAME rewrites `category` on every matching habit in chunked batches, so
 *   the row locks and shows a spinner while it runs;
 * - DELETE REASSIGNS every matching habit to "Uncategorized" — `Habit.category`
 *   is required, so unlike a to-do's the field can't simply be cleared (see
 *   utils/habitCategories.ts) — so it goes through ConfirmDialog with the
 *   concrete count of habits that will move.
 *
 * The "Uncategorized" row itself can be renamed but not deleted: it is where
 * deletion sends habits, so deleting it could only drop a list entry that the
 * in-use derivation would immediately put back.
 *
 * Counts are computed case-insensitively over the loaded habits (a habit stored
 * as "health" counts toward "Health"), matching how the mutations match
 * documents.
 *
 * This drawer owns BOTH the success and the failure message for all three
 * mutations (they re-throw and toast nothing themselves), so a rejected write
 * never reads as a success: the rename editor stays open with the typed name and
 * the delete confirmation stays put.
 * Motion/focus/Escape are the Drawer primitive's job (it already honors
 * prefers-reduced-motion and traps focus), so nothing extra is wired here.
 */
export const HabitCategoryManagerDrawer: React.FC<HabitCategoryManagerDrawerProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    habits,
    habitCategories,
    updateHabitCategories,
    renameHabitCategory,
    deleteHabitCategory,
  } = useGamification();

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

  // The rows: stored vocabulary + every category actually in use. Nothing is
  // hidden for being empty — removing a category is a deliberate act performed
  // right here, not a side effect of its last habit leaving.
  const categories = useMemo(
    () => habitCategoryVocabulary(habitCategories, habits),
    [habitCategories, habits],
  );

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const habit of habits) {
      const key = habitCategoryKey(habit.category);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [habits]);

  const countFor = (name: string): number => usageCounts.get(habitCategoryKey(name)) ?? 0;
  const isFallbackCategory = (name: string): boolean =>
    habitCategoryKey(name) === habitCategoryKey(UNCATEGORIZED_HABIT_CATEGORY);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isAdding) return; // in-flight guard: a double-tap must not append twice

    const trimmed = newName.trim();
    if (!trimmed) {
      setAddError('Give the category a name.');
      return;
    }
    // Checked against the DISPLAYED vocabulary, not the stored array, so a name
    // that already exists only on habits is caught too.
    const existing = categories.find(category => habitCategoryKey(category) === habitCategoryKey(trimmed));
    if (existing) {
      setAddError(`"${existing}" is already on the list.`);
      return;
    }

    setIsAdding(true);
    try {
      await updateHabitCategories([...habitCategories, trimmed]);
      setNewName('');
      setAddError(null);
      toast.success(`Added "${trimmed}"`);
    } catch (error) {
      console.error('[HabitCategoryManagerDrawer] Add category failed:', error);
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

    // The mutation MERGES when the new name collides case-insensitively with a
    // different existing category (habits adopt that category's stored
    // spelling). Resolve the same target here so the confirmation matches what
    // happened instead of claiming a rename to the typed spelling.
    const mergeTarget = habitCategories.find(
      category =>
        habitCategoryKey(category) === habitCategoryKey(trimmed) &&
        habitCategoryKey(category) !== habitCategoryKey(original),
    );

    setRenamingName(original);
    try {
      await renameHabitCategory(original, trimmed);
      toast.success(mergeTarget ? `Merged into "${mergeTarget}"` : `Renamed to "${trimmed}"`);
      setEditing(null);
    } catch (error) {
      console.error('[HabitCategoryManagerDrawer] Rename category failed:', error);
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
      await deleteHabitCategory(name);
      toast.success(`Deleted "${name}"`);
      setPendingDelete(null);
    } catch (error) {
      console.error('[HabitCategoryManagerDrawer] Delete category failed:', error);
      // The category is still there — report it and KEEP the confirmation open
      // so the user can retry without hunting for the row again.
      toast.error(describeError(error, 'delete the category'));
    } finally {
      setIsDeleting(false);
    }
  };

  // Exact counts (see habitCountLabel), so the copy names the real number — and
  // it says where the habits GO, because they can't be left without a category.
  const deleteMessage = pendingDelete
    ? `Delete "${pendingDelete.name}"? ${
        pendingDelete.count === 0
          ? 'No habits are using it.'
          : `${pendingDelete.count} ${
              pendingDelete.count === 1 ? 'habit moves' : 'habits move'
            } to ${UNCATEGORIZED_HABIT_CATEGORY}.`
      } This can't be undone.`
    : '';

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Habit categories">
      <div className="space-y-4">
        <p className="text-xs text-brand-500 dark:text-brand-400 px-1">
          Categories group your habits on the Track tab. Every habit has one, and renaming or
          deleting one updates every habit using it.
        </p>

        <form onSubmit={handleAdd} className="flex items-end gap-2" aria-busy={isAdding}>
          <Input
            label="New category"
            value={newName}
            onChange={event => {
              setNewName(event.target.value);
              if (addError) setAddError(null);
            }}
            placeholder="e.g. Wellbeing"
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

        {categories.length === 0 ? (
          <p className="text-sm text-brand-500 dark:text-brand-400 px-1 py-2">
            No categories yet. Add one above and it&apos;ll be there the next time you create a
            habit.
          </p>
        ) : (
          <SurfaceList>
            {categories.map(category => {
              const isEditing = editing?.original === category;
              const isRenaming = renamingName === category;
              const rowBusy = isRenaming || isDeleting;
              const isFallback = isFallbackCategory(category);

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
                        <span className="inline-flex max-w-full items-center rounded-full border border-brand-300 bg-brand-200 px-2.5 py-0.5 text-xs font-semibold text-brand-800 truncate dark:border-brand-600 dark:bg-brand-700 dark:text-brand-100">
                          {category}
                        </span>
                        <span className="mt-1 block text-xs text-brand-500 dark:text-brand-400">
                          {habitCountLabel(countFor(category))}
                          {isFallback && ' · where deleted categories send habits'}
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
                      {/* No delete for the fallback: it is where deletion sends
                          habits, so removing it could only drop a list entry the
                          in-use derivation would immediately put back. */}
                      {!isFallback && (
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
                      )}
                    </>
                  )}
                </Row>
              );
            })}
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

export default HabitCategoryManagerDrawer;
