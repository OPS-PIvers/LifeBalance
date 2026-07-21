import React from 'react';
import { Check, Trash2, AlertCircle, Clock, User, CheckSquare, Bell } from 'lucide-react';
import { format, isToday, isTomorrow, parseISO, isBefore, startOfToday } from 'date-fns';
import { ToDo, HouseholdMember } from '@/types/schema';
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

export interface TodoRowProps {
  item: ToDo;
  color: SectionColor;
  assignee: HouseholdMember | undefined;
  isSelected: boolean;
  isSelectionMode: boolean;
  onComplete: (id: string) => void;
  onUncomplete: (id: string) => void;
  onEdit: (todo: ToDo) => void;
  onDelete: (id: string) => void;
  /** Opens the Task-options drawer (long-press / context-menu). */
  onMore: (todo: ToDo) => void;
  onToggleSelection: (id: string) => void;
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
}: TodoRowProps) {
  // Parse the due date once per row render to avoid repeated parseISO calls
  const dueDate = parseISO(item.completeByDate);
  const isOverdue = isBefore(dueDate, startOfToday());

  // F-TODO-14: optional due time-of-day, shown after the date label. The bell
  // marks a task with a reminder configured.
  const dueTimeLabel = formatDueTime(item.dueTime);
  const hasReminder = dueTimeLabel !== null && typeof item.reminderMinutesBefore === 'number';

  // Quiet "has details" indicator — the row no longer expands notes/subtasks
  // inline; a muted dot after the date signals there's more in the edit drawer.
  const hasDetails =
    Boolean(item.notes && item.notes.trim().length > 0) ||
    (item.subtasks?.length ?? 0) > 0 ||
    Boolean(item.recurrence?.frequency);

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

  // Meta line (urgency date/time, reminder bell, details dot, assignee) —
  // rendered in BOTH selection and normal modes so bulk-select doesn't hide
  // the row's status; in normal mode it doubles as the button's
  // aria-describedby target via metaId.
  const metaLine = (
    <span id={metaId} className="flex flex-wrap items-center gap-3 mt-1.5 text-xs">
      {/* Single primary status signal: urgency-colored text, not a bordered pill. */}
      {isOverdue ? (
        <span className="flex items-center gap-1 font-semibold text-money-neg dark:text-money-negDark">
          <AlertCircle size={11} />
          Overdue ({format(dueDate, 'MMM d')}{dueTimeLabel ? ` · ${dueTimeLabel}` : ''})
        </span>
      ) : (
        <span className={`flex items-center gap-1 font-semibold ${dateColorMap[color]}`}>
          <Clock size={11} />
          {isToday(dueDate) ? 'Today' :
           isTomorrow(dueDate) ? 'Tomorrow' :
           format(dueDate, 'MMM d')}
          {dueTimeLabel && ` · ${dueTimeLabel}`}
          {hasReminder && (
            <span title="Reminder set">
              <Bell size={11} aria-hidden="true" />
              <span className="sr-only">Reminder set</span>
            </span>
          )}
        </span>
      )}

      {/* Quiet "has details" indicator — notes, subtasks, or recurrence
          live in the edit drawer; the dot just signals there's more. */}
      {hasDetails && (
        <span className="text-brand-300 dark:text-brand-500" data-testid="todo-details-dot">
          <span aria-hidden="true">•</span>
          <span className="sr-only">Has details</span>
        </span>
      )}

      {assignee && (
        assignee.photoURL ? (
          <img
            src={assignee.photoURL}
            className="w-4 h-4 rounded-full"
            alt={assignee.displayName ?? 'Task assignee'}
          />
        ) : (
          /* SVG aria-label is unreliable across AT — hide the icon and carry
             the assignee name in a sibling sr-only span instead. */
          <span className="text-brand-400 dark:text-brand-500" title={assignee.displayName ?? 'Task assignee'}>
            <User size={12} aria-hidden="true" />
            <span className="sr-only">{assignee.displayName ?? 'Task assignee'}</span>
          </span>
        )
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
          className="mt-0.5 p-2.5 -m-2.5 shrink-0"
          aria-label={`Complete task: ${item.text}`}
        >
          <span className="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors border-brand-300 group-hover:border-accent-500 group-hover:bg-accent-50 group-active:bg-accent-100 dark:border-brand-600 dark:group-hover:border-accent-400 dark:group-hover:bg-accent-900/30">
            <Check size={14} className="text-transparent group-hover:text-current group-active:text-current group-has-[:focus-visible]:text-current transition-colors" />
          </span>
        </HapticCheck>
      )}

      {isSelectionMode ? (
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-snug text-inherit">
            <span className={isSelected ? 'text-accent-800 dark:text-accent-200' : 'text-brand-900 dark:text-brand-50'}>{item.text}</span>
          </p>
          {metaLine}
        </div>
      ) : (
        /* Row body — TAP = edit drawer, LONG-PRESS / context-menu = options
           drawer. A real <button> so keyboard/AT get the edit path for free;
           the context-menu key (fired on the focused element) reaches the
           options drawer. select-none + no touch-callout keep iOS from
           starting text selection / the share sheet during a long-press. */
        <button
          type="button"
          onClick={handleBodyClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onContextMenu={handleContextMenu}
          aria-label={`Edit task: ${item.text}`}
          aria-describedby={metaId}
          className="flex-1 min-w-0 text-left select-none [-webkit-touch-callout:none] focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-card"
        >
          <span className="block font-medium leading-snug text-brand-900 dark:text-brand-50">{item.text}</span>

          {/* aria-describedby (not folded into the button's aria-label above)
              so AT still announces urgency/reminder/details/assignee — an
              explicit aria-label on the button would otherwise remove this
              whole subtree from the accessibility tree. */}
          {metaLine}
        </button>
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
      startActions={[{
        icon: Check,
        label: 'Complete',
        tone: 'positive',
        hapticPattern: 'success',
        onAction: handleComplete,
      }]}
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
