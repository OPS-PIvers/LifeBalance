import React, { useCallback, useEffect, useRef, useState } from 'react';
import { addDays, format, isSaturday, isSunday, nextSaturday, parseISO } from 'date-fns';
import { ChevronLeft, Star, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTodos } from '@/contexts/FirebaseHouseholdContext';
import type { ToDo } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CategoryChipPicker } from '@/components/ui/CategoryChipPicker';
import Input from '@/components/ui/Input';
import { getLocalDateString } from '@/utils/dateHelpers';
import { cn } from '@/utils/cn';
import { haptic } from '@/utils/haptics';

/**
 * F-TODO-16 — one-task-at-a-time triage for the uncategorized backlog.
 *
 * TWO deliberate decisions shape this component; both exist to make the
 * auto-advance safe.
 *
 * 1. THE QUEUE IS A SNAPSHOT, NOT A DERIVED LIST. It is taken on the open edge
 *    and held in state. A live `todos.filter(uncategorized)` would reshuffle
 *    under the user: saving a category is exactly the thing that removes the
 *    current card from the filter, so the list would shift by one on every save
 *    and cards would be silently skipped. Re-opening the drawer takes a fresh
 *    snapshot.
 *
 * 2. EVERY CONTROL COMMITS ITS OWN WRITE THE MOMENT IT IS TAPPED — the due-date
 *    quick picks, the date field, and the star all persist immediately rather
 *    than staging changes until "save". The category chip is the primary action
 *    and AUTO-ADVANCES on tap; if the other controls were staged, tapping a
 *    category before adjusting the date would silently throw the date away, and
 *    the user would have to learn a required order (date first, category last).
 *    With write-on-tap there is no order to learn and no edit can be lost by
 *    advancing. The cost is one small write per tap instead of one batched
 *    write per card, which is the right trade for a triage flow where most
 *    cards get exactly one tap.
 *
 * Skip advances without writing anything; delete removes the card (after a
 * confirm) and advances. Back re-visits the previous card — it may already be
 * categorized, and it shows its current values, which is the point.
 */

interface TodoTriageDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/** A to-do counts as uncategorized when the field is absent, blank, or whitespace. */
const isUncategorized = (todo: ToDo): boolean => !(todo.category ?? '').trim();

/**
 * The triage queue: active, uncategorized to-dos in list order. `todos` from the
 * context already excludes held-for-review (`needsReview`) captures — they live
 * in `todosAwaitingReview` and are hidden from the to-do list — so nothing extra
 * is filtered here.
 */
const buildQueue = (todos: ToDo[]): ToDo[] =>
  todos.filter(todo => !todo.isCompleted && isUncategorized(todo));

interface QuickPick {
  key: string;
  label: string;
  date: string;
}

/**
 * Due-date shortcuts, all derived from `getLocalDateString()` (never the UTC
 * day — see CLAUDE.md). "This weekend" is the coming Saturday, or today when it
 * already is the weekend.
 */
const buildQuickPicks = (): QuickPick[] => {
  const today = parseISO(getLocalDateString());
  const weekend = isSaturday(today) || isSunday(today) ? today : nextSaturday(today);
  return [
    { key: 'today', label: 'Today', date: format(today, 'yyyy-MM-dd') },
    { key: 'tomorrow', label: 'Tomorrow', date: format(addDays(today, 1), 'yyyy-MM-dd') },
    { key: 'weekend', label: 'This weekend', date: format(weekend, 'yyyy-MM-dd') },
    { key: 'next-week', label: 'Next week', date: format(addDays(today, 7), 'yyyy-MM-dd') },
  ];
};

type BusyAction = 'category' | 'date' | 'star' | 'delete';

export const TodoTriageDrawer: React.FC<TodoTriageDrawerProps> = ({ isOpen, onClose }) => {
  const { todos, todoCategories, updateTodoCategories, updateToDo, deleteToDo } = useTodos();

  const [queue, setQueue] = useState<ToDo[]>(() => (isOpen ? buildQueue(todos) : []));
  const [index, setIndex] = useState(0);
  // One in-flight write at a time — every control checks this, so a double-tap
  // (or a tap on a second control mid-write) can't issue a duplicate write.
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  // Refreshed per open so a session left running past midnight doesn't hand out
  // yesterday's "Today".
  const [quickPicks, setQuickPicks] = useState<QuickPick[]>(buildQuickPicks);

  // Re-snapshot on the open edge (render-time, on the change edge — the same
  // reset pattern TaskTemplateDrawer/BatchRescheduleModal use, no effect).
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setQueue(buildQueue(todos));
      setQuickPicks(buildQuickPicks());
      setIndex(0);
      setBusy(null);
      setIsConfirmingDelete(false);
    }
  }

  const current = queue[index];
  const total = queue.length;

  // Move focus onto the card whenever a DIFFERENT task is shown (advance, Back,
  // or the delete that pulls a card out from under the cursor). Keyed on the id
  // rather than the index so an in-place edit (date/star) never steals focus
  // from the control the user is using.
  const cardRef = useRef<HTMLDivElement>(null);
  const focusedIdRef = useRef<string | undefined>(current?.id);
  useEffect(() => {
    if (!isOpen) return;
    if (focusedIdRef.current === current?.id) return;
    focusedIdRef.current = current?.id;
    cardRef.current?.focus();
  }, [current?.id, isOpen]);

  /** Optimistic local patch so Back shows the values the user just wrote. */
  const patchCurrent = useCallback((id: string, updates: Partial<ToDo>) => {
    setQueue(prev => prev.map(todo => (todo.id === id ? { ...todo, ...updates } : todo)));
  }, []);

  const advance = useCallback(() => {
    setIndex(prev => prev + 1);
  }, []);

  const handleBack = useCallback(() => {
    setIndex(prev => Math.max(0, prev - 1));
  }, []);

  const handleAddCategory = useCallback(
    async (name: string) => {
      await updateTodoCategories([...todoCategories, name]);
    },
    [todoCategories, updateTodoCategories]
  );

  // PRIMARY ACTION: save the category, then move to the next card.
  const handlePickCategory = useCallback(
    async (category: string | undefined) => {
      if (!current || busy !== null) return;
      // `allowClear` is off, so the picker only ever emits a real category here;
      // guard anyway rather than writing an empty string (absent = Uncategorized).
      if (!category || !category.trim()) return;
      const id = current.id;
      setBusy('category');
      haptic('light');
      try {
        await updateToDo(id, { category: category.trim() });
        patchCurrent(id, { category: category.trim() });
        advance();
      } catch (error) {
        console.error('[TodoTriageDrawer] Failed to set category:', error);
        toast.error('Failed to save the category');
      } finally {
        setBusy(null);
      }
    },
    [advance, busy, current, patchCurrent, updateToDo]
  );

  // Write-on-tap (see the header comment): the date is persisted immediately so
  // a later category tap can advance without discarding it.
  const handlePickDate = useCallback(
    async (date: string) => {
      if (!current || busy !== null) return;
      if (!date || date === current.completeByDate) return;
      const id = current.id;
      setBusy('date');
      haptic('light');
      try {
        await updateToDo(id, { completeByDate: date });
        patchCurrent(id, { completeByDate: date });
      } catch (error) {
        console.error('[TodoTriageDrawer] Failed to reschedule:', error);
        toast.error('Failed to update the due date');
      } finally {
        setBusy(null);
      }
    },
    [busy, current, patchCurrent, updateToDo]
  );

  // Write-on-tap, same reasoning as the due date.
  const handleToggleImportant = useCallback(async () => {
    if (!current || busy !== null) return;
    const id = current.id;
    const next = current.isImportant !== true;
    setBusy('star');
    haptic('light');
    try {
      await updateToDo(id, { isImportant: next });
      patchCurrent(id, { isImportant: next });
    } catch (error) {
      console.error('[TodoTriageDrawer] Failed to update importance:', error);
      toast.error('Failed to update importance');
    } finally {
      setBusy(null);
    }
  }, [busy, current, patchCurrent, updateToDo]);

  const handleConfirmDelete = useCallback(async () => {
    if (!current || busy !== null) return;
    const id = current.id;
    setBusy('delete');
    try {
      await deleteToDo(id);
      // Drop the card from the snapshot and leave `index` where it is, so it now
      // points at the following task (the progress total shrinks honestly).
      setQueue(prev => prev.filter(todo => todo.id !== id));
      setIsConfirmingDelete(false);
      toast.success('Task deleted');
    } catch (error) {
      console.error('[TodoTriageDrawer] Failed to delete task:', error);
      toast.error('Failed to delete the task');
    } finally {
      setBusy(null);
    }
  }, [busy, current, deleteToDo]);

  const isBusy = busy !== null;

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title="Sort tasks into categories"
        height={current ? 'tall' : 'auto'}
        footer={
          current ? (
            <div className="p-4 border-t border-brand-200 dark:border-brand-700 flex items-center gap-3">
              <Button
                variant="secondary"
                onClick={handleBack}
                disabled={index === 0 || isBusy}
                leftIcon={<ChevronLeft size={16} aria-hidden="true" />}
                aria-label="Back to the previous task"
                className="min-h-11"
              >
                Back
              </Button>
              <Button
                variant="ghost"
                onClick={advance}
                disabled={isBusy}
                aria-label="Skip this task without changing it"
                className="flex-1 min-h-11"
              >
                Skip
              </Button>
            </div>
          ) : undefined
        }
      >
        {current ? (
          <div className="space-y-4">
            <p
              className="text-xs font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-450"
              aria-live="polite"
            >
              {index + 1} of {total}
            </p>

            <div
              ref={cardRef}
              tabIndex={-1}
              className="surface-section p-4 space-y-4 outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
            >
              <div className="space-y-1">
                <h4 className="font-display text-lg font-semibold tracking-tight text-brand-900 dark:text-brand-50">
                  {current.text}
                </h4>
                {current.notes && (
                  <p className="text-sm text-brand-500 dark:text-brand-400 whitespace-pre-line">
                    {current.notes}
                  </p>
                )}
                <p className="text-xs text-brand-400 dark:text-brand-450">
                  Due {format(parseISO(current.completeByDate), 'EEE, MMM d')}
                </p>
              </div>

              <div>
                <CategoryChipPicker
                  label="Category"
                  categories={todoCategories}
                  value={current.category}
                  onChange={(category) => void handlePickCategory(category)}
                  onAddCategory={handleAddCategory}
                  disabled={isBusy}
                />
                <p className="mt-2 text-xs text-brand-400 dark:text-brand-450">
                  Picking a category saves it and moves on to the next task.
                </p>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
                  Due date
                </span>
                <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label="Due date shortcuts">
                  {quickPicks.map(pick => {
                    const selected = pick.date === current.completeByDate;
                    return (
                      <button
                        key={pick.key}
                        type="button"
                        onClick={() => void handlePickDate(pick.date)}
                        disabled={isBusy}
                        aria-pressed={selected}
                        aria-label={`Due ${pick.label.toLowerCase()}`}
                        className={cn(
                          'min-h-11 px-3 py-2 rounded-btn border text-sm font-medium',
                          'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                          'disabled:opacity-50',
                          selected
                            ? 'bg-accent-50 border-accent-200 text-accent-700 dark:bg-accent-800/50 dark:border-accent-700 dark:text-accent-100'
                            : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700'
                        )}
                      >
                        {pick.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2">
                  <Input
                    label="Or pick a date"
                    type="date"
                    value={current.completeByDate}
                    onChange={(e) => void handlePickDate(e.target.value)}
                    disabled={isBusy}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleToggleImportant()}
                  disabled={isBusy}
                  aria-pressed={current.isImportant === true}
                  aria-label={current.isImportant === true ? 'Unmark as important' : 'Mark as important'}
                  className={cn(
                    'inline-flex items-center gap-2 min-h-11 px-3 py-2 rounded-btn border text-sm font-medium',
                    'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                    'disabled:opacity-50',
                    current.isImportant === true
                      ? 'bg-warm-100 border-warm-500/40 text-warm-700 dark:bg-warm-500/15 dark:border-warm-500/40 dark:text-warm-300'
                      : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-200 dark:hover:bg-brand-700'
                  )}
                >
                  <Star
                    size={18}
                    aria-hidden="true"
                    className={
                      current.isImportant === true
                        ? 'text-warm-500 fill-warm-500'
                        : 'text-brand-300 dark:text-brand-500'
                    }
                  />
                  Important
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmingDelete(true)}
                  disabled={isBusy}
                  aria-label={`Delete task: ${current.text}`}
                  className={cn(
                    'ml-auto inline-flex items-center justify-center min-w-11 min-h-11 rounded-btn',
                    'text-brand-400 hover:text-money-neg hover:bg-money-bgNeg',
                    'dark:text-brand-450 dark:hover:text-money-negDark dark:hover:bg-money-neg/15',
                    'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                    'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
                    'disabled:opacity-50'
                  )}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center space-y-3" aria-live="polite">
            <h4 className="font-display text-lg font-semibold tracking-tight text-brand-900 dark:text-brand-50">
              All caught up
            </h4>
            <p className="text-sm text-brand-500 dark:text-brand-400">
              Nothing left to sort — every active task has a category.
            </p>
            <Button onClick={onClose} className="w-full min-h-11">
              Close
            </Button>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={isConfirmingDelete}
        onClose={() => setIsConfirmingDelete(false)}
        onConfirm={() => void handleConfirmDelete()}
        title="Delete task?"
        message={
          current
            ? `"${current.text}" will be removed for everyone in the household.`
            : 'This task will be removed for everyone in the household.'
        }
        confirmLabel="Delete"
        isConfirming={busy === 'delete'}
      />
    </>
  );
};

export default TodoTriageDrawer;
