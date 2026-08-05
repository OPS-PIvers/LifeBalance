import React, { useCallback, useState } from 'react';
import { Calendar, Star, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import type { ToDo } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { CategoryChipPicker } from '@/components/ui/CategoryChipPicker';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { WHOLE_HOUSEHOLD_ASSIGNEE, resolveAssignedTo } from '@/utils/todoAssignee';
import { buildQuickPicks, type QuickPick } from '@/utils/todoQuickPicks';
import { cn } from '@/utils/cn';
import { haptic } from '@/utils/haptics';

/**
 * "Saved for later" — the single-item triage sheet that PROMOTES a parked to-do
 * onto the active list.
 *
 * Three decisions shape it, all of them the opposite of `TodoTriageDrawer`'s:
 *
 * 1. **ONE WRITE ON CONFIRM, never write-on-tap.** `TodoTriageDrawer` persists
 *    every control the moment it is tapped because its primary action
 *    auto-advances to the next card, so staged edits would be lost. Here there
 *    is no queue and no advance — and the item being triaged is PARKED, so a
 *    partial write is exactly the failure mode the feature exists to avoid: a
 *    to-do that reaches the active list still wearing its inert placeholder date
 *    renders a fabricated red "Overdue" label. Everything is staged locally and
 *    committed through `promoteTodo`, which clears `savedForLater` AND applies
 *    the classification in a single write. Backing out calls nothing at all,
 *    leaving the item parked and untouched.
 *
 * 2. **THE DUE DATE STARTS EMPTY AND IS REQUIRED.** A parked to-do's stored
 *    `completeByDate` is an inert placeholder that is never rendered anywhere
 *    (see `ToDo.completeByDate` in types/schema.ts) — pre-filling the field from
 *    it would put a fabricated date in front of the user and let them confirm it
 *    by accident. Replacing it is the entire point of the triage step, so Confirm
 *    stays disabled until a real date is picked. Every OTHER field pre-fills from
 *    whatever the item already carries, and all of them are optional.
 *
 * 3. **THE SHEET STAYS OPEN ON A FAILED WRITE.** `promoteTodo` rejects rather
 *    than toasting, so a rules rejection or a dropped connection leaves the
 *    staged classification on screen to retry instead of silently discarding it.
 *
 * PR-4 (the Eisenhower quadrants) reuses this component as-is: it reads its own
 * household/category/mutation slices, so the only props are the item and the
 * close callback.
 */

export interface PromoteToDoSheetProps {
  /**
   * The parked to-do being triaged. `null` renders the sheet closed — pass the
   * item to open it (the drawer's exit animation plays against the last
   * rendered snapshot, held internally).
   */
  todo: ToDo | null;
  /** Closes the sheet. Called on cancel, backdrop/Escape, and after a success. */
  onClose: () => void;
  /** Fired with the promoted id after the write lands (e.g. to clear a selection). */
  onPromoted?: (id: string) => void;
}

export const PromoteToDoSheet: React.FC<PromoteToDoSheetProps> = ({
  todo,
  onClose,
  onPromoted,
}) => {
  const { todoCategories, updateTodoCategories, promoteTodo } = useTodos();
  const { members } = useHouseholdCore();

  const isOpen = todo !== null;

  // Staged classification (see decision 1 above) — nothing is written until
  // Confirm. `completeByDate` starts EMPTY on purpose (decision 2).
  const [completeByDate, setCompleteByDate] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>(WHOLE_HOUSEHOLD_ASSIGNEE);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [isImportant, setIsImportant] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Refreshed per open so a session left running past midnight doesn't hand out
  // yesterday's "Today" (same rule as TodoTriageDrawer).
  const [quickPicks, setQuickPicks] = useState<QuickPick[]>(buildQuickPicks);

  // Last non-null item, so the drawer's exit animation renders against a
  // snapshot instead of an empty body once `todo` flips to null on close.
  const [staged, setStaged] = useState<ToDo | null>(null);
  // Re-seed on the open edge and whenever a DIFFERENT item is handed in —
  // render-time on the change edge, the reset pattern this repo uses instead of
  // an effect (see TodoTriageDrawer / BatchRescheduleModal). Tracked separately
  // from `staged` (which deliberately survives the close) so reopening the SAME
  // row still re-seeds rather than showing the previous session's staged values.
  // Starts at `null` even when the component mounts already-open, so the FIRST
  // render seeds too (an initializer of `todo?.id` would skip it and leave the
  // item's own assignee/category/star unseen behind the state defaults).
  const [seededId, setSeededId] = useState<string | null>(null);
  const currentId = todo?.id ?? null;
  if (currentId !== seededId) {
    setSeededId(currentId);
    if (todo !== null) {
      setStaged(todo);
      setCompleteByDate('');
      setAssignedTo(todo.assignedTo ?? WHOLE_HOUSEHOLD_ASSIGNEE);
      setCategory(todo.category?.trim() || undefined);
      setIsImportant(todo.isImportant === true);
      setQuickPicks(buildQuickPicks());
      setIsSaving(false);
    }
  }

  const handleAddCategory = useCallback(
    async (name: string) => {
      await updateTodoCategories([...todoCategories, name]);
    },
    [todoCategories, updateTodoCategories],
  );

  const handleConfirm = useCallback(async () => {
    if (!todo || isSaving) return;
    if (!completeByDate) {
      toast.error('Pick a due date to add this to the list');
      return;
    }
    setIsSaving(true);
    haptic('success'); // at gesture time — dead after the await on iOS
    try {
      // ONE write: `promoteTodo` clears `savedForLater` and applies every field
      // below together, so nothing half-classified can reach the active list.
      // "Whole household" stores an ABSENT assignedTo — the sentinel never
      // reaches Firestore (resolveAssignedTo), matching the full edit form.
      await promoteTodo(todo.id, {
        completeByDate,
        assignedTo: resolveAssignedTo(assignedTo),
        category: category?.trim() || undefined,
        isImportant,
      });
      toast.success('Added to your list');
      onPromoted?.(todo.id);
      onClose();
    } catch (error) {
      // Deliberately leaves the sheet OPEN with the staged values (decision 3).
      console.error('[PromoteToDoSheet] Failed to promote to-do:', error);
      toast.error('Could not add this task. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }, [assignedTo, category, completeByDate, isImportant, isSaving, onClose, onPromoted, promoteTodo, todo]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      disableClose={isSaving}
      title="Add to your list"
      footer={
        <div className="bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 p-4 flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isSaving}
            className="min-h-11"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            isLoading={isSaving}
            // Required, and the reason the sheet exists — see decision 2.
            disabled={!completeByDate}
            className="flex-1 min-h-11"
          >
            Add to list
          </Button>
        </div>
      }
    >
      {staged && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h3 className="font-display text-lg font-semibold tracking-tight text-brand-900 dark:text-brand-50">
              {staged.text}
            </h3>
            {staged.notes && (
              <p className="text-sm text-brand-500 dark:text-brand-400 whitespace-pre-line">
                {staged.notes}
              </p>
            )}
            {/* NO due date is shown here — a parked to-do's stored date is an
                inert placeholder (decision 2). */}
          </div>

          <div>
            <span
              id="promote-due-date-label"
              className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400"
            >
              Due date
            </span>
            <div
              className="mt-2 grid grid-cols-2 gap-2"
              role="group"
              aria-labelledby="promote-due-date-label"
            >
              {quickPicks.map((pick, index) => {
                const selected = pick.date === completeByDate;
                return (
                  <button
                    key={pick.key}
                    type="button"
                    // useFocusTrap prefers [data-autofocus]; a plain autoFocus
                    // gets clobbered inside a Drawer. The first quick pick is the
                    // most likely answer, so focus lands on the primary decision.
                    {...(index === 0 ? { 'data-autofocus': '' } : {})}
                    onClick={() => setCompleteByDate(pick.date)}
                    disabled={isSaving}
                    aria-pressed={selected}
                    aria-label={`Due ${pick.label.toLowerCase()}`}
                    className={cn(
                      'min-h-11 px-3 py-2 rounded-btn border text-sm font-medium',
                      'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                      'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                      'disabled:opacity-50',
                      selected
                        ? 'bg-accent-50 border-accent-200 text-accent-700 dark:bg-accent-800/50 dark:border-accent-700 dark:text-accent-100'
                        : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700',
                    )}
                  >
                    {pick.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2">
              <Input
                id="promote-due-date-input"
                label="Or pick a date"
                type="date"
                value={completeByDate}
                onChange={(e) => setCompleteByDate(e.target.value)}
                icon={<Calendar size={18} />}
                disabled={isSaving}
                className="appearance-none"
              />
            </div>
          </div>

          {members.length > 0 && (
            <Select
              id="promote-assignee-select"
              label="Assign to"
              icon={<User size={18} />}
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              disabled={isSaving}
            >
              {/* Same honesty sentinel as the full edit form: an assignedTo
                  pointing at a since-removed member must not visually snap to
                  the first member while state still holds the old value. */}
              {assignedTo !== WHOLE_HOUSEHOLD_ASSIGNEE &&
                !members.some((m) => m.uid === assignedTo) && (
                  <option value={assignedTo} disabled>
                    Former member
                  </option>
                )}
              <option value={WHOLE_HOUSEHOLD_ASSIGNEE}>Whole household</option>
              {members.map((member) => (
                <option key={member.uid} value={member.uid}>
                  {member.displayName ?? 'User'}
                </option>
              ))}
            </Select>
          )}

          <CategoryChipPicker
            label="Category"
            categories={todoCategories}
            value={category}
            onChange={setCategory}
            onAddCategory={handleAddCategory}
            allowClear
            disabled={isSaving}
          />

          <div>
            <button
              type="button"
              onClick={() => setIsImportant((v) => !v)}
              disabled={isSaving}
              aria-pressed={isImportant}
              aria-label={isImportant ? 'Unmark as important' : 'Mark as important'}
              className={cn(
                'inline-flex items-center gap-2 min-h-11 px-3 py-2 rounded-btn border text-sm font-medium',
                'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                'disabled:opacity-50',
                isImportant
                  ? 'bg-warm-100 border-warm-500/40 text-warm-700 dark:bg-warm-500/15 dark:border-warm-500/40 dark:text-warm-300'
                  : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700',
              )}
            >
              <Star
                size={18}
                aria-hidden="true"
                className={isImportant ? 'text-warm-500 fill-warm-500' : 'text-brand-300 dark:text-brand-500'}
              />
              Important
            </button>
            <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
              Matters to the family — big consequences if skipped.
            </p>
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default PromoteToDoSheet;
