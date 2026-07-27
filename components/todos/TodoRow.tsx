import React from 'react';
import { Check, Trash2, AlertCircle, Clock, CheckSquare, Bell, Star, ListChecks } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, startOfToday } from 'date-fns';
import { ToDo, HouseholdMember } from '@/types/schema';
import type { TodoSubtaskToggleResult, TodoCompletionOptions } from '@/contexts/household/mutations/todoMutations';
import toast from 'react-hot-toast';
import { toastIcon } from '@/components/ui/toastIcon';
import { haptic } from '@/utils/haptics';
import { HapticCheck } from '@/components/ui/HapticCheck';
import { SwipeActionRow } from '@/components/ui/SwipeActionRow';
import { Row } from '@/components/ui/Section';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { UndoToast } from '@/components/ui/UndoToast';
import { cn } from '@/utils/cn';
import { type SectionColor, dateColorMap } from './todoDisplay';
import { formatDueTime } from '@/utils/todoTime';
import { subtaskProgress } from '@/utils/subtasks';

// Small per-subtask assignee chip — read-only here (assignment happens in the
// edit drawer). Mirrors ActionQueueItem's renderAssigneeChip styling at a
// slightly smaller size to fit the subtask row. `className` lets the
// household cluster below layer on stacking/ring styles.
function SubtaskAssigneeChip({ assignee, className }: { assignee: HouseholdMember | undefined; className?: string }) {
  if (!assignee) return null;
  return assignee.photoURL ? (
    <img
      src={assignee.photoURL}
      alt={assignee.displayName ?? 'Assigned member'}
      className={cn('w-4 h-4 rounded-full object-cover shrink-0', className)}
    />
  ) : (
    <span
      title={assignee.displayName ?? 'Assigned member'}
      className={cn('w-4 h-4 rounded-full bg-brand-200 dark:bg-brand-500/30 flex items-center justify-center text-[8px] font-bold text-brand-600 dark:text-brand-200 shrink-0', className)}
    >
      {assignee.displayName?.charAt(0) || '?'}
    </span>
  );
}

// Paper cut #5: no single assignee means the whole household, not
// "unassigned" — stacked ringed avatars (cap 3 + "+N"), one atomic image for
// assistive tech rather than N separately-announced avatars.
const HOUSEHOLD_CLUSTER_VISIBLE = 3;

function HouseholdAssigneeCluster({ members }: { members: HouseholdMember[] }) {
  if (members.length === 0) return null;
  const visible = members.slice(0, HOUSEHOLD_CLUSTER_VISIBLE);
  const extra = members.length - visible.length;
  return (
    <span
      role="img"
      aria-label={`Assigned to the whole household (${members.length} ${members.length === 1 ? 'member' : 'members'})`}
      className="flex items-center shrink-0"
    >
      {visible.map((member, i) => (
        <SubtaskAssigneeChip
          key={member.uid}
          assignee={member}
          className={cn('ring-2 ring-white dark:ring-brand-800', i > 0 && '-ml-1.5')}
        />
      ))}
      {extra > 0 && (
        <span className="w-4 h-4 -ml-1.5 rounded-full bg-brand-300 dark:bg-brand-600 ring-2 ring-white dark:ring-brand-800 flex items-center justify-center text-[7px] font-bold text-brand-700 dark:text-brand-100 shrink-0">
          +{extra}
        </span>
      )}
    </span>
  );
}

// Moved verbatim from pages/ToDosPage.tsx (Plan 27) — extracted because both
// the list arrangement (still in ToDosPage) and the Eisenhower matrix view
// (components/todos/EisenhowerMatrixView.tsx) render rows via `Section`,
// which renders `TodoRow`.
//
// Row-diet redesign (owner-approved): the row shows ONLY the complete circle,
// title, urgency-colored due cluster, a quiet "has details" dot, and the
// assignee avatar image. All per-row action buttons are gone — the interaction
// model is: TAP the row body = edit drawer, SWIPE = complete/delete,
// LONG-PRESS (or right-click / keyboard context-menu key) = Task-options
// drawer (star / move to tomorrow / duplicate / edit / delete, in ToDosPage).

const LONG_PRESS_MS = 500;

// Title line of the two-line row (paper cut #4): title always gets the full
// row width to itself, with the meta line stacked underneath — deterministic
// for every row regardless of due-pill text length, unlike the old
// same-line-until-it-doesn't-fit layout.
const TITLE_COLUMN = 'w-full';

export interface TodoRowProps {
  item: ToDo;
  color: SectionColor;
  assignee: HouseholdMember | undefined;
  isSelected: boolean;
  isSelectionMode: boolean;
  onComplete: (id: string) => void;
  onUncomplete: (id: string, options?: TodoCompletionOptions) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  /** Opens the Task-options drawer (long-press / context-menu). */
  onMore: (todo: ToDo) => void;
  onToggleSelection: (id: string) => void;
  /** Inline subtask access (owner-approved): flip a subtask directly from the
   *  list. Resolves with whether checking it auto-completed the parent to-do
   *  (and the pre-toggle subtasks to restore on undo). */
  onToggleSubtask: (todoId: string, subtaskId: string) => Promise<TodoSubtaskToggleResult>;
  /** Member lookup for per-subtask assignee chips in the expanded checklist
   *  (read-only here — assignment happens in the edit drawer). Optional so
   *  existing callers/tests that don't pass it still render (no chips shown). */
  memberMap?: ReadonlyMap<string, HouseholdMember>;
}

// Memoized row for a single active to-do.
// React.memo's default shallow comparator is sufficient: all callbacks are
// stable via useCallback at page level, and `item`/`assignee` are stable
// references from the context arrays.
export const TodoRow = React.memo(function TodoRow({
  item,
  color,
  assignee,
  isSelected,
  isSelectionMode,
  onComplete,
  onUncomplete,
  onEdit,
  onDelete,
  onMore,
  onToggleSelection,
  onToggleSubtask,
  memberMap,
}: TodoRowProps) {
  // Parse the due date once per row render to avoid repeated parseISO calls
  const dueDate = parseISO(item.completeByDate);
  const isOverdue = isBefore(dueDate, startOfToday());
  // Paper cut #4: only overdue/today keep a bold, colored urgency signal on
  // line 2 — a date that's merely coming up ("Tomorrow", "Jul 29") is muted
  // instead, so it reads as quiet metadata rather than shouting.
  const isDueToday = isToday(dueDate);

  // F-TODO-14: optional due time-of-day, shown after the date label. The bell
  // marks a task with a reminder configured.
  const dueTimeLabel = formatDueTime(item.dueTime);
  const hasReminder = dueTimeLabel !== null && typeof item.reminderMinutesBefore === 'number';

  // Quiet "has details" indicator — the row no longer expands notes/subtasks
  // inline; a muted dot after the date signals there's more in the edit drawer.
  // Habit Automations (PRD #1065): a habit-LINKED to-do can't be completed
  // until every subtask is done — the habit should only fire when the work is
  // truly finished. Unlinked to-dos keep the loose behavior (subtasks are
  // informational). The hint shows the remaining step count.
  const subtaskCount = item.subtasks?.length ?? 0;
  const subtasksDone = subtaskProgress(item.subtasks).done;
  const stepsLeft = subtaskCount - subtasksDone;
  const completionGated =
    !!item.linkedHabitId && subtaskCount > 0 && stepsLeft > 0;

  // Paper cut #3: a parent task with unfinished subtasks shouldn't offer
  // swipe-to-complete at all (even when there's no linked-habit gate) — the
  // "right swipe = done" gesture is only for tasks that are actually finishable
  // in one motion. Swipe-to-delete stays available either way.
  const swipeCompleteAllowed = subtaskCount === 0 || stepsLeft === 0;

  // Subtasks now surface through the checklist pill + inline expansion below, so
  // they no longer feed the generic "has details" dot — that dot is reserved for
  // notes and recurrence, which have no other row affordance.
  const hasDetails =
    Boolean(item.notes && item.notes.trim().length > 0) ||
    Boolean(item.recurrence?.frequency);

  // `assignee` is undefined both for a household-wide todo AND for a stale
  // reference to a since-removed member — key off `item.assignedTo` itself.
  const isHouseholdAssignment = !item.assignedTo;
  const householdMembers = memberMap ? Array.from(memberMap.values()) : [];

  // Inline subtask access (owner-approved): ephemeral per-row expand state.
  // Multiple rows may be open at once; collapsed by default.
  const [subtasksExpanded, setSubtasksExpanded] = React.useState(false);
  const subtaskListId = `todo-row-subtasks-${item.id}`;

  // Entering bulk-selection mode collapses any open inline checklist: in
  // selection mode the pill is an inert count indicator (a row tap toggles
  // selection), so the expansion — and its silent auto-complete path — must not
  // stay reachable.
  // Syncing ephemeral UI state (collapse an open checklist) to an external
  // mode switch; a render-phase edge-pattern isn't a good fit per-row since
  // many rows mount/unmount as the list filters, unlike the page-level
  // toggles that use that pattern.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isSelectionMode) setSubtasksExpanded(false);
  }, [isSelectionMode]);

  // id for the meta line (due/overdue, reminder, details, assignee), wired to
  // the row button via aria-describedby — see handleBodyClick's button below.
  const metaId = `todo-row-meta-${item.id}`;

  // --- Gesture model (mirrors ShoppingItemRow): TAP on the row body opens the
  // edit drawer; LONG-PRESS anywhere on the body opens the Task-options drawer
  // (as does right-click / the keyboard context-menu key, for pointers that
  // can't long-press). Timer armed on pointer-down, cancelled by >10px
  // movement (that's a swipe/scroll, not a press). ---
  const longPressTimer = React.useRef<number | null>(null);
  // When true, the next click on the row body is a gesture artifact and must
  // be swallowed: browsers synthesize a click from the pointer-up that ends a
  // fired long-press AND from the one that ends a horizontal swipe — without
  // this, finishing a swipe over the title pops the edit drawer.
  const suppressClick = React.useRef(false);
  const pressOrigin = React.useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // If the row unmounts with a long-press pending (todo deleted elsewhere,
  // filter change, navigation), the timer would still fire onMore against
  // stale state — clear it on unmount.
  React.useEffect(() => {
    return () => {
      if (longPressTimer.current !== null) {
        window.clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary button / touch contact only
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    suppressClick.current = false;
    cancelLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      suppressClick.current = true;
      // Android-only in practice: a timer callback has no transient user
      // activation, so the iOS transport can't fire here (see utils/haptics.ts).
      haptic('medium');
      onMore(item);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (longPressTimer.current === null || !pressOrigin.current) return;
    // A press that starts moving is a swipe/scroll, not a long-press.
    if (Math.hypot(e.clientX - pressOrigin.current.x, e.clientY - pressOrigin.current.y) > 10) {
      cancelLongPress();
    }
  };

  // A starting swipe both kills the pending long-press and marks the gesture's
  // terminating click as an artifact. The pointer-move cancel alone is not
  // enough: once framer-motion's drag session claims the pointer, React
  // pointermove handlers on this element stop firing.
  const handleSwipeStart = () => {
    cancelLongPress();
    suppressClick.current = true;
  };

  // Swallow the click that ends a fired long-press or a swipe (see above).
  const consumeSuppressedClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return true;
    }
    return false;
  };

  // Tap on the row body → edit drawer.
  const handleBodyClick = () => {
    if (consumeSuppressedClick()) return;
    onEdit(item);
  };

  // The body is a role="button" div (not a native <button>) so it can host the
  // nested, interactive checklist pill — that costs us the free keyboard
  // activation, so Enter/Space open the edit drawer explicitly here.
  const handleBodyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEdit(item);
    }
  };

  // Right-click / keyboard context-menu → Task-options drawer. Guarded by
  // suppressClick so a long-press that already fired (some platforms
  // synthesize contextmenu around the same ~500ms mark) doesn't open it twice.
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (suppressClick.current) return;
    if (longPressTimer.current !== null) suppressClick.current = true;
    cancelLongPress();
    onMore(item);
  };

  // Shared by the checkbox control and the right-swipe action.
  //
  // Undo toast (F-TODO-11, mirrors ShoppingListTab's DeleteUndoToast):
  // completing a to-do assigned to a MANAGED KID credits that kid's
  // member.points in the same writeBatch as the completion (see
  // `completeToDo` / `computeTodoCompletionCredit` in todoMutations.ts).
  // Undo is now offered for EVERY assignee — `onUncomplete` routes through
  // `uncompleteToDo` (ToDosPage.handleUncomplete), which reverses the kid
  // points credit atomically with the restore, so the previous kid-task
  // suppression is no longer needed.
  const handleComplete = async () => {
    // Habit Automations (PRD #1065): block completion of a linked to-do until
    // every subtask is done, so the habit only fires when the work is finished.
    if (completionGated) {
      toast(`${stepsLeft} ${stepsLeft === 1 ? 'step' : 'steps'} left before this can be completed`);
      return;
    }
    try {
      await onComplete(item.id);
      toast(
        (t) => (
          <UndoToast
            message="To-Do completed"
            onUndo={() => {
              toast.dismiss(t.id);
              onUncomplete(item.id);
            }}
          />
        ),
        { duration: 5000, icon: toastIcon(Check) }
      );
    } catch (error) {
      console.error('Failed to complete task:', error);
      toast.error('Failed to complete to-do');
    }
  };

  // The checklist pill toggles the inline subtask list. It sits INSIDE the
  // row's gesture area (SwipeActionRow + the body's tap/long-press), so it must
  // swallow both its click (else the row opens the edit drawer / toggles
  // selection) AND its pointerdown (else it arms the long-press timer or starts
  // a swipe — see the gesture-model comments above).
  const handlePillPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
  };
  const handlePillClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSubtasksExpanded(v => !v);
  };
  // Keyboard activation (Enter/Space) on the pill must NOT bubble to any
  // ancestor role="button" (the selection-mode Row): the native <button> already
  // fires its own click from these keys, so letting them propagate would also
  // toggle selection / open a drawer. (In normal mode the pill is a SIBLING of
  // the edit body, so this is belt-and-suspenders — the pill isn't a descendant
  // there.)
  const handlePillKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.stopPropagation();
    }
  };

  // Check/uncheck a subtask straight from the list. Checking the LAST step
  // auto-completes the parent to-do (owner-approved reversal of PRD #1065's
  // out-of-scope call); the mutation commits subtasks + completion + any linked
  // habit fire + kid points in ONE batch, then we offer the standard 5s undo
  // that reverses EVERYTHING atomically (restoring the to-do re-unchecks the
  // triggering subtask BY ID against uncompleteToDo's own fresh read — never a
  // stale whole-array snapshot).
  const handleSubtaskCheck = async (subtaskId: string) => {
    try {
      const result = await onToggleSubtask(item.id, subtaskId);
      if (result.autoCompleted) {
        toast(
          (t) => (
            <UndoToast
              message="All steps done — to-do completed"
              onUndo={() => {
                toast.dismiss(t.id);
                onUncomplete(item.id, {
                  subtaskToggle: { subtaskId: result.toggledSubtaskId, done: false },
                });
              }}
            />
          ),
          { duration: 5000, icon: toastIcon(Check) }
        );
      }
    } catch (error) {
      console.error('Failed to toggle subtask:', error);
      toast.error('Failed to update subtask');
    }
  };

  // Merged checklist pill (replaces the old "n steps left" hint). Amber warning
  // tone while a habit-linked to-do still has steps left (completion is gated on
  // them); quiet neutral tone otherwise.
  //
  // In NORMAL mode it's a real <button> that expands the inline list (padding
  // trick gives it a ≥44px touch target per DESIGN.md) and is rendered as a
  // SIBLING of the edit body (never an interactive descendant of a role=button).
  // In SELECTION mode it's an inert count indicator — the whole Row is a
  // role="button" toggling selection, so the pill must not be interactive
  // (ARIA forbids interactive descendants of role=button) and its silent
  // auto-complete path must be unreachable during bulk actions (finding 3).
  // Muted default tone (paper cut #4: quiet supporting text); amber gated
  // tone stays — it carries real meaning (completion is blocked).
  const pillToneClass = completionGated
    ? 'text-warm-700 dark:text-warm-300'
    : 'text-brand-400 dark:text-brand-500';
  const subtaskPill = subtaskCount > 0 && (
    isSelectionMode ? (
      <span
        data-testid="todo-subtask-pill"
        className={cn('inline-flex items-center gap-1 font-medium', pillToneClass)}
      >
        <ListChecks size={12} aria-hidden="true" />
        {subtasksDone}/{subtaskCount}
        <span className="sr-only"> steps done</span>
      </span>
    ) : (
      <button
        type="button"
        onClick={handlePillClick}
        onPointerDown={handlePillPointerDown}
        onKeyDown={handlePillKeyDown}
        aria-expanded={subtasksExpanded}
        aria-controls={subtaskListId}
        aria-label={`${subtasksDone} of ${subtaskCount} steps done — ${subtasksExpanded ? 'hide' : 'show'} steps`}
        data-testid="todo-subtask-pill"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-3 -my-2 font-medium transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40',
          completionGated
            ? 'text-warm-700 dark:text-warm-300'
            : 'text-brand-400 dark:text-brand-500 hover:text-brand-700 dark:hover:text-brand-200'
        )}
      >
        <ListChecks size={12} aria-hidden="true" />
        {subtasksDone}/{subtaskCount}
      </button>
    )
  );

  // Inline subtask checklist rendered beneath the row content when expanded.
  // Kept OUTSIDE the tap-to-edit body so checking a step never opens the drawer;
  // stops pointerdown from bubbling into SwipeActionRow so a checkbox tap can't
  // start a swipe. Styling mirrors the edit drawer's subtask list.
  const subtaskList = subtasksExpanded && subtaskCount > 0 && (
    <ul
      id={subtaskListId}
      aria-label={`Subtasks for ${item.text}`}
      className="mt-2 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-(--duration-fast)"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {(item.subtasks ?? []).map(sub => (
        <li key={sub.id}>
          {/* Lighter version of the row's own swipe-to-complete: swiping a
              subtask right toggles ITS done state (same handler as the
              checkbox). Deliberate-intent thresholds are shared with every
              swipeable row via SwipeActionRow's own commit distance. */}
          <SwipeActionRow
            startActions={[{
              icon: Check,
              label: sub.isDone ? 'Undo' : 'Done',
              tone: 'positive',
              hapticPattern: 'success',
              onAction: () => handleSubtaskCheck(sub.id),
            }]}
          >
            <label className="flex items-center gap-2.5 py-2.5 min-h-[44px] cursor-pointer">
              <input
                type="checkbox"
                checked={sub.isDone}
                onChange={() => handleSubtaskCheck(sub.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Mark "${sub.text}" ${sub.isDone ? 'not done' : 'done'}`}
                className="w-4 h-4 shrink-0 rounded-sm border-brand-300 text-accent-600 focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-brand-600 dark:bg-brand-700"
              />
              <span className={cn(
                'flex-1 min-w-0 text-sm',
                sub.isDone ? 'line-through text-brand-400 dark:text-brand-500' : 'text-brand-700 dark:text-brand-200'
              )}>
                {sub.text}
              </span>
              {sub.assigneeId && (
                <SubtaskAssigneeChip assignee={memberMap?.get(sub.assigneeId)} />
              )}
            </label>
          </SwipeActionRow>
        </li>
      ))}
    </ul>
  );

  // Meta line (urgency date/time, reminder bell, details dot, assignee) —
  // rendered in BOTH selection and normal modes; in normal mode it doubles as
  // the button's aria-describedby target via metaId. Paper cut #4: always its
  // own line BELOW the title, and NEVER wraps (`flex-nowrap` +
  // `overflow-x-auto`) so an extreme combination scrolls instead of
  // reflowing the row — row height stays deterministic. Muted/subordinate to
  // the title; the due-date color stays semantic (urgency).
  const metaLine = (
    <span
      id={metaId}
      className="flex flex-nowrap items-center gap-3 text-xs text-brand-500 dark:text-brand-400 min-w-0 overflow-x-auto"
    >
      {/* Small amber star marks an important (starred) task — the flat list
          sorts these first, so the mark explains the ordering at a glance.
          Unstarred rows render nothing here (zero space cost). */}
      {item.isImportant === true && (
        <span className="flex items-center text-warm-500" data-testid="todo-important-star">
          <Star size={12} aria-hidden="true" className="fill-warm-500" />
          <span className="sr-only">Important</span>
        </span>
      )}
      {/* Single primary status signal: urgency-colored text, not a bordered
          pill. Paper cut #4: only overdue/today shout — a date that's merely
          coming up ("Tomorrow", a plain "Jul 29") is muted instead, inheriting
          the meta line's quiet default color rather than the bold
          section-accent `dateColorMap` reserved for the two urgent cases.
          (`dateColorMap` itself is untouched — it's shared with the
          Eisenhower section accents.) */}
      {isOverdue ? (
        <span data-testid="todo-due-label" className="flex items-center gap-1 font-semibold text-warm-700 dark:text-warm-300">
          <AlertCircle size={11} />
          Overdue ({format(dueDate, 'MMM d')}{dueTimeLabel ? ` · ${dueTimeLabel}` : ''})
        </span>
      ) : isDueToday ? (
        <span data-testid="todo-due-label" className={cn('flex items-center gap-1 font-semibold', dateColorMap[color])}>
          <Clock size={11} />
          Today
          {dueTimeLabel && ` · ${dueTimeLabel}`}
          {hasReminder && (
            <span title="Reminder set">
              <Bell size={11} aria-hidden="true" />
              <span className="sr-only">Reminder set</span>
            </span>
          )}
        </span>
      ) : (
        <span data-testid="todo-due-label" className="flex items-center gap-1">
          <Clock size={11} />
          {isTomorrow(dueDate) ? 'Tomorrow' : format(dueDate, 'MMM d')}
          {dueTimeLabel && ` · ${dueTimeLabel}`}
          {hasReminder && (
            <span title="Reminder set">
              <Bell size={11} aria-hidden="true" />
              <span className="sr-only">Reminder set</span>
            </span>
          )}
        </span>
      )}

      {/* Merged checklist pill — shows done/total, opens the inline subtask
          list, and (amber) doubles as the "steps left" gate hint for a
          habit-linked to-do. Replaces the old standalone "n steps left" text. */}
      {subtaskPill}

      {/* Quiet "has details" indicator — notes or recurrence live in the edit
          drawer; the dot just signals there's more (subtasks have the pill). */}
      {hasDetails && (
        <span className="text-brand-300 dark:text-brand-500" data-testid="todo-details-dot">
          <span aria-hidden="true">•</span>
          <span className="sr-only">Has details</span>
        </span>
      )}

      {assignee ? (
        // Reuse the exact same chip as the household cluster and the subtask
        // list below (paper cut #5) — a specific assignee and "everyone"
        // render with the identical avatar look, not two different
        // photo-or-fallback implementations that could drift apart.
        <SubtaskAssigneeChip assignee={assignee} />
      ) : (
        isHouseholdAssignment && <HouseholdAssigneeCluster members={householdMembers} />
      )}
    </span>
  );

  const cardInner = (
    <Row
      onClick={() => isSelectionMode && onToggleSelection(item.id)}
      {...(isSelectionMode ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-pressed': isSelected,
        'aria-label': `${isSelected ? 'Deselect' : 'Select'} task: ${item.text}`,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleSelection(item.id);
          }
        }
      } : {})}
      className={cn(
        'items-start p-4 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
        isSelectionMode
          ? isSelected
            ? 'cursor-pointer bg-accent-50 dark:bg-accent-900/30'
            : 'cursor-pointer bg-white dark:bg-brand-800 hover:bg-brand-50 dark:hover:bg-brand-700/40'
          : 'bg-white dark:bg-brand-800'
      )}
    >
      {/* Complete Checkbox or Selection Box */}
      {isSelectionMode ? (
        <div className={`mt-0.5 w-6 h-6 flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'text-accent-600 dark:text-accent-300' : 'text-brand-300 dark:text-brand-500'}`}>
          {isSelected ? <CheckSquare aria-hidden="true" size={24} /> : <div className="w-5 h-5 border-2 border-current rounded-sm" />}
        </div>
      ) : (
        <HapticCheck
          checked={false}
          onCheckedChange={handleComplete}
          onClick={(e) => e.stopPropagation()}
          disabled={completionGated}
          className={cn('mt-0.5 p-2.5 -m-2.5 shrink-0', completionGated && 'cursor-not-allowed')}
          aria-label={
            completionGated
              ? `Complete task: ${item.text} — ${stepsLeft} ${stepsLeft === 1 ? 'step' : 'steps'} left`
              : `Complete task: ${item.text}`
          }
        >
          <span
            className={cn(
              'w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors',
              completionGated
                ? 'border-brand-200 bg-brand-100/60 dark:border-brand-700 dark:bg-brand-700/40'
                : 'border-brand-300 group-hover:border-accent-500 group-hover:bg-accent-50 group-active:bg-accent-100 dark:border-brand-600 dark:group-hover:border-accent-400 dark:group-hover:bg-accent-900/30',
            )}
          >
            <Check size={14} className={cn('transition-colors', completionGated ? 'text-transparent' : 'text-transparent group-hover:text-current group-active:text-current group-has-[:focus-visible]:text-current')} />
          </span>
        </HapticCheck>
      )}

      {isSelectionMode ? (
        <div className="flex-1 min-w-0">
          {/* Same two-line title/meta treatment as normal mode (paper cut #4),
              so bulk-select doesn't look denser/different than the regular list. */}
          <div className="flex flex-col gap-y-1">
            {/* Two reserved lines — see the normal-mode title below for why. */}
            <p className={cn(TITLE_COLUMN, 'line-clamp-2 min-h-[2.75em] font-medium leading-snug text-inherit')} title={item.text}>
              <span className={isSelected ? 'text-accent-800 dark:text-accent-200' : 'text-brand-900 dark:text-brand-50'}>{item.text}</span>
            </p>
            {metaLine}
          </div>
          {subtaskList}
        </div>
      ) : (
        /* Row body — TAP (on the title button) = edit drawer, LONG-PRESS /
           context-menu (anywhere on the body) = options drawer. The long-press
           and context-menu handlers live on this outer container so they cover
           the whole body, while the click/keyboard EDIT affordance is a
           role="button" wrapping ONLY the title (below). */
        <div
          className="flex-1 min-w-0"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onContextMenu={handleContextMenu}
        >
          {/* Title on its own line, meta line stacked beneath it (paper cut
              #4) — deterministic two-line row regardless of due-pill text
              length. The edit affordance is a role="button" wrapping ONLY the
              title, so it has NO interactive descendant — ARIA forbids
              interactive descendants of role=button, which would swallow the
              checklist pill for VoiceOver/TalkBack. The meta line (which HOSTS
              the interactive pill) is a SIBLING here, never a descendant,
              still wired to the title via aria-describedby. */}
          <div className="flex flex-col gap-y-1">
            {/* Keyboard activation (Enter/Space → edit) is handled explicitly
                since a role=button div gets no free activation. */}
            <div
              role="button"
              tabIndex={0}
              onClick={handleBodyClick}
              onKeyDown={handleBodyKeyDown}
              aria-label={`Edit task: ${item.text}`}
              aria-describedby={metaId}
              title={item.text}
              className={cn(TITLE_COLUMN, 'text-left select-none [-webkit-touch-callout:none] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-card')}
            >
              {/* Two lines, RESERVED — not truncated to one, and not merely
                  capped at two. The clamp bounds how far a long title can
                  grow; `min-h-[2.75em]` reserves that same space when the
                  title only needs one line, so EVERY row is the same height
                  whatever its title. Capping alone would have left one-line
                  and two-line rows different heights — the same jitter the
                  "Tomorrow" tag caused, just from a different source.

                  2.75em = 2 x `leading-snug` (1.375). In `em`, so it tracks
                  this element's own font-size rather than pinning a px height
                  that breaks if the row's type scale ever moves.

                  A to-do list whose titles are cut off mid-word ("Connect with
                  mom about worksho…") has traded away the one thing the row
                  exists to show, so two lines it is; the rare title that
                  overruns even that keeps its full text in this button's
                  aria-label, the native `title` tooltip above, and the edit
                  drawer a tap opens.

                  No `block`: `line-clamp-2` supplies `display:-webkit-box`,
                  and a competing `display:block` in the same layer can win by
                  stylesheet order and silently render the clamp inert. */}
              <span className="line-clamp-2 min-h-[2.75em] font-medium leading-snug text-brand-900 dark:text-brand-50">{item.text}</span>
            </div>

            {metaLine}
          </div>

          {/* Inline subtask checklist — outside the tap-to-edit body so checking
              a step never opens the drawer. */}
          {subtaskList}
        </div>
      )}
    </Row>
  );

  // In selection mode we keep tap-to-select intact and skip the swipe gesture.
  if (isSelectionMode) {
    return <>{cardInner}</>;
  }

  // Gmail-style swipe: right = complete, left = delete (with confirmation).
  // Partial swipes stick open to a tappable button; SwipeActionRow handles
  // thresholds, reveal, haptics, and the reduced-motion fallback (the row's
  // own checkbox and the options drawer remain the accessible path).
  return (
    <SwipeActionRow
      startActions={swipeCompleteAllowed ? [{
        icon: Check,
        label: 'Complete',
        tone: 'positive',
        hapticPattern: 'success',
        onAction: handleComplete,
      }] : undefined}
      endActions={[{
        icon: Trash2,
        label: 'Delete',
        tone: 'destructive',
        hapticPattern: 'medium',
        onAction: () => {
          showDeleteConfirmation(async () => {
            await onDelete(item.id);
            toast.success('Task deleted');
          });
        },
      }]}
      onSwipeStart={handleSwipeStart}
    >
      {cardInner}
    </SwipeActionRow>
  );
});
