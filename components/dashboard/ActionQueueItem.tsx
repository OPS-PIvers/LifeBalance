import React, { useMemo, memo, useRef } from 'react';
import {
  CalendarClock, Receipt, Check, Trash2, Clock, ListTodo, AlertCircle
} from 'lucide-react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { format, parseISO, isBefore, addDays, isAfter, startOfToday, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import {
  ActionQueueItem, isCalendarQueueItem, isTodoQueueItem, isTransactionQueueItem
} from '@/hooks/useActionQueue';
import { HouseholdMember, BudgetBucket, Transaction, ToDo } from '@/types/schema';
import { suggestCategoryForTransaction } from '@/utils/actionQueueSmart';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { cn } from '@/utils/cn';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { haptic } from '@/utils/haptics';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import TransactionReviewForm from '@/components/transactions/TransactionReviewForm';

// Swipe affordance background colors per theme (same pattern as ShoppingItemRow).
const SWIPE_COLORS = {
  light: { defer: '#faf4ea', default: '#ffffff', approve: '#eef6f1' }, // warm-50 / white / money-bgPos
  dark: { defer: '#3a2c15', default: '#242220', approve: '#0f2e23' },   // warm tint / brand-800 / money-pos tint
};

/** Drag distance (px) past which releasing the row commits the swipe action. */
const SWIPE_THRESHOLD = 80;

/** Hold duration (ms) before a press on a row enters multi-select mode. */
const LONG_PRESS_MS = 500;

interface ActionQueueItemProps {
  item: ActionQueueItem;
  isExpanded: boolean;
  setExpandedId: (id: string | null) => void;
  setPayModalItemId: (id: string | null) => void;

  // Mobile triage: multi-select mode (bulk approve/defer/delete)
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  /** Long-press entry point — enter selection mode with this item selected. */
  onEnterSelectionMode: (id: string) => void;
  // Mobile triage: swipe gestures (right = instant approve, left = defer)
  onSwipeApprove: (item: ActionQueueItem) => void;
  onSwipeDefer: (item: ActionQueueItem) => void;

  // Data props passed down from parent to avoid consuming context. `buckets` and
  // `transactions` back the swipe pre-check (a category must be inferable before
  // an instant approve); the transaction review drawer reads its own data
  // (habits, mutations) directly from context.
  buckets: BudgetBucket[];
  transactions: Transaction[];
  members: HouseholdMember[];

  // Action props passed down from parent. The transaction verify/edit/delete
  // path now lives in TransactionReviewForm (context-driven), so only the
  // calendar + todo branch handlers are passed here.
  updateToDo: (id: string, updates: Partial<ToDo>) => Promise<void>;
  deleteToDo: (id: string) => Promise<void>;
  completeToDo: (id: string) => Promise<void>;
  deferCalendarItem: (itemId: string) => Promise<void>;
  deleteCalendarItem: (id: string) => Promise<void>;
}

const areActionQueueItemPropsEqual = (
  prev: ActionQueueItemProps,
  next: ActionQueueItemProps
): boolean => {
  // Check if expanded state or handlers changed
  if (prev.isExpanded !== next.isExpanded ||
      prev.setExpandedId !== next.setExpandedId ||
      prev.setPayModalItemId !== next.setPayModalItemId) {
    return false;
  }

  // Selection state & triage handlers
  if (prev.selectionMode !== next.selectionMode ||
      prev.isSelected !== next.isSelected ||
      prev.onToggleSelect !== next.onToggleSelect ||
      prev.onEnterSelectionMode !== next.onEnterSelectionMode ||
      prev.onSwipeApprove !== next.onSwipeApprove ||
      prev.onSwipeDefer !== next.onSwipeDefer) {
    return false;
  }

  // Check data dependencies (shallow comparison)
  // This ensures that if the parent passes the same array references, we don't re-render
  // unless the item itself changed.

  // Members are used in the summary view (assignee chip), so we must always check for updates.
  if (prev.members !== next.members) {
      return false;
  }

  // OPTIMIZATION: Buckets and Transactions back the swipe pre-check, needed when
  // the item can be swiped/reviewed. If the item is collapsed (and staying
  // collapsed) we can safely ignore changes to these large collections.
  // This prevents the entire list from re-rendering when a single transaction is updated.
  if (next.isExpanded) {
    if (prev.buckets !== next.buckets ||
        prev.transactions !== next.transactions) {
        return false;
    }
  }

  // Check action handlers (should be stable if from context)
  if (prev.updateToDo !== next.updateToDo ||
      prev.deleteToDo !== next.deleteToDo ||
      prev.completeToDo !== next.completeToDo ||
      prev.deferCalendarItem !== next.deferCalendarItem ||
      prev.deleteCalendarItem !== next.deleteCalendarItem) {
      return false;
  }

  // Check ID
  if (prev.item.id !== next.item.id) return false;

  // Check content based on type to ensure updates (like edits) trigger re-render
  if (prev.item.queueType !== next.item.queueType) return false;

  if (isTransactionQueueItem(prev.item) && isTransactionQueueItem(next.item)) {
      return prev.item.amount === next.item.amount &&
             prev.item.merchant === next.item.merchant &&
             prev.item.date === next.item.date &&
             prev.item.category === next.item.category;
  }

  if (isCalendarQueueItem(prev.item) && isCalendarQueueItem(next.item)) {
       return prev.item.amount === next.item.amount &&
             prev.item.title === next.item.title &&
             prev.item.date === next.item.date &&
             prev.item.type === next.item.type;
  }

  if (isTodoQueueItem(prev.item) && isTodoQueueItem(next.item)) {
       return prev.item.text === next.item.text &&
             prev.item.date === next.item.date &&
             prev.item.assignedTo === next.item.assignedTo;
  }

  return true;
};

// Optimization: Memoized to prevent re-renders of unexpanded items when one item is expanded/collapsed.
// We use isExpanded boolean instead of passing expandedId string to ensure stable props for unexpanded items.
// Updated 2026-02-19: Accepts context values as props to avoid re-rendering on unrelated context updates.
export const ActionQueueItemCard: React.FC<ActionQueueItemProps> = memo(({
  item, isExpanded, setExpandedId, setPayModalItemId,
  selectionMode,
  isSelected,
  onToggleSelect,
  onEnterSelectionMode,
  onSwipeApprove,
  onSwipeDefer,
  buckets,
  transactions,
  members,
  updateToDo,
  deleteToDo,
  completeToDo,
  deferCalendarItem,
  deleteCalendarItem,
}) => {

  const fmt = useFormatCurrency();

  // --- Swipe-to-triage gesture (right = approve/complete, left = defer) ---
  const x = useMotionValue(0);
  const reduceMotion = useReducedMotion();
  const isDark = useMediaQuery('(prefers-color-scheme: dark)') ||
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
  const palette = isDark ? SWIPE_COLORS.dark : SWIPE_COLORS.light;

  // Swipe is a shortcut, never the only path: the Review button and expanded
  // actions remain, so disabling it (reduced motion / expanded / select mode)
  // loses no capability.
  const swipeEnabled = !reduceMotion && !isExpanded && !selectionMode;

  const bgColor = useTransform(
    x,
    [-100, -50, 0, 50, 100],
    [palette.defer, palette.defer, palette.default, palette.approve, palette.approve]
  );
  const deferOpacity = useTransform(x, [-50, -20], [1, 0]);
  const approveOpacity = useTransform(x, [20, 50], [0, 1]);
  const deferScale = useTransform(x, [-100, -50], [1.2, 1]);
  const approveScale = useTransform(x, [50, 100], [1, 1.2]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > SWIPE_THRESHOLD) {
      haptic('light');
      // Transactions that can't be instant-approved fall back to the review
      // panel via handleExpand (which surfaces the amount field for $0 stubs).
      if (isTransactionQueueItem(item)) {
        if (item.needsAmount) {
          handleExpand();
          toast('Add the amount, then approve.', { icon: '✏️' });
          return;
        }
        if (!suggestCategoryForTransaction(item, buckets, transactions)) {
          handleExpand();
          toast('Pick a category to approve this one.', { icon: '🏷️' });
          return;
        }
      }
      onSwipeApprove(item);
    } else if (info.offset.x < -SWIPE_THRESHOLD) {
      haptic('light');
      onSwipeDefer(item);
    }
  };

  // --- Long-press → enter multi-select mode (standard mobile list pattern) ---
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (selectionMode || isExpanded) return;
    pressOrigin.current = { x: e.clientX, y: e.clientY };
    longPressFired.current = false;
    cancelLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      haptic('medium');
      onEnterSelectionMode(item.id);
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (longPressTimer.current === null || !pressOrigin.current) return;
    // A press that starts moving is a swipe/scroll, not a long-press.
    if (Math.hypot(e.clientX - pressOrigin.current.x, e.clientY - pressOrigin.current.y) > 10) {
      cancelLongPress();
    }
  };

  const handleRowClick = () => {
    // Swallow the click generated by the pointer-up that ended a long-press,
    // so entering selection mode doesn't immediately toggle the item back off.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    if (selectionMode) onToggleSelect(item.id);
  };

  // Memoize member lookup Map for O(1) access
  const memberMap = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    members.forEach(member => map.set(member.uid, member));
    return map;
  }, [members]);

  const renderAssigneeChip = (assignedTo: string) => {
    const assignee = memberMap.get(assignedTo);
    if (!assignee) return null;

    return assignee.photoURL ? (
      <img
        src={assignee.photoURL}
        alt={assignee.displayName ?? 'Assigned member'}
        className="w-4 h-4 rounded-full border border-white object-cover shrink-0"
      />
    ) : (
      <div className="w-4 h-4 rounded-full bg-brand-200 dark:bg-brand-500/30 flex items-center justify-center text-[8px] font-bold text-brand-600 dark:text-brand-200 border border-white dark:border-brand-700 shrink-0">
        {assignee.displayName?.charAt(0) || '?'}
      </div>
    );
  };

  const handleExpand = () => setExpandedId(item.id);

  const handleClose = () => setExpandedId(null);

  // Compute icon and styles only when item type changes
  const { iconComponent, iconClasses } = useMemo(() => {
    if (isCalendarQueueItem(item)) {
      return {
        iconComponent: <CalendarClock size={18} />,
        iconClasses: 'bg-warm-100 border-warm-200 text-warm-600 dark:bg-warm-900/30 dark:border-warm-800 dark:text-warm-300',
      };
    }
    if (isTodoQueueItem(item)) {
      return {
        iconComponent: <ListTodo size={18} />,
        iconClasses: 'bg-money-bgNeg border-money-neg/20 text-money-neg dark:bg-money-neg/15 dark:border-money-neg/30 dark:text-money-negDark',
      };
    }
    return {
      iconComponent: <Receipt size={18} />,
      iconClasses: 'bg-accent-50 border-accent-200 text-accent-700 dark:bg-accent-800/40 dark:border-accent-700 dark:text-accent-200',
    };
  }, [item]);

  const itemLabel = isTodoQueueItem(item) ? item.text : isCalendarQueueItem(item) ? item.title : isTransactionQueueItem(item) ? item.merchant || 'transaction' : 'item';

  const drawerTitle = isCalendarQueueItem(item) || isTodoQueueItem(item)
    ? 'Actions'
    : 'Review Transaction';

  const approveLabel = isTodoQueueItem(item) ? 'Complete'
    : isTransactionQueueItem(item) && item.needsAmount ? 'Add amount'
    : 'Approve';

  return (
    <div className="relative overflow-hidden hairline-divider group">
      {/* Background layer revealed by the swipe (right = approve, left = defer) */}
      {swipeEnabled && (
        <motion.div
          className="absolute inset-0 z-0 flex items-center justify-between px-4"
          style={{ backgroundColor: bgColor }}
          aria-hidden="true"
        >
          <motion.div
            style={{ opacity: approveOpacity, scale: approveScale }}
            className="flex items-center gap-2 font-bold text-money-pos"
          >
            <Check size={20} />
            <span>{approveLabel}</span>
          </motion.div>
          <motion.div
            style={{ opacity: deferOpacity, scale: deferScale }}
            className="flex items-center gap-2 font-bold ml-auto text-warm-600 dark:text-warm-300"
          >
            <Clock size={20} />
            <span>Defer</span>
          </motion.div>
        </motion.div>
      )}

      {/* Foreground layer — draggable summary row */}
      <motion.div
        drag={swipeEnabled ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        // With constraints pinned at 0, ALL movement is elastic overflow, so the
        // visual displacement is offset × dragElastic. 0.5 keeps the resistance
        // feel while still revealing the approve/defer affordance underneath
        // (0.1 would cap a 150px swipe at a ~15px reveal).
        dragElastic={0.5}
        onDragEnd={swipeEnabled ? handleDragEnd : undefined}
        style={{ x, touchAction: 'pan-y' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onClick={handleRowClick}
        role={selectionMode ? 'checkbox' : undefined}
        aria-checked={selectionMode ? isSelected : undefined}
        aria-label={selectionMode ? `Select ${itemLabel}` : undefined}
        tabIndex={selectionMode ? 0 : undefined}
        onKeyDown={selectionMode ? (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggleSelect(item.id);
          }
        } : undefined}
        className={cn(
          'relative z-10 bg-white dark:bg-brand-800 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
          selectionMode
            ? isSelected
              ? 'bg-accent-50 dark:bg-accent-800/20 cursor-pointer'
              : 'cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-700/30'
            : 'hover:bg-brand-50 dark:hover:bg-brand-700/30'
        )}
      >
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Selection checkbox replaces the type icon in multi-select mode */}
          {selectionMode ? (
            <span
              aria-hidden="true"
              className={cn(
                'w-9 h-9 rounded-card border-2 flex items-center justify-center transition-colors',
                isSelected
                  ? 'bg-accent-600 border-accent-600 text-white'
                  : 'border-brand-300 dark:border-brand-600 text-transparent'
              )}
            >
              <Check size={16} strokeWidth={3} />
            </span>
          ) : (
            <div className={`w-9 h-9 rounded-card border flex items-center justify-center ${iconClasses}`}>
               {iconComponent}
            </div>
          )}
          <div>
            <p className="font-semibold text-brand-800 dark:text-brand-100 text-sm">
              {isCalendarQueueItem(item) ? item.title :
               isTodoQueueItem(item) ? item.text :
               isTransactionQueueItem(item) ? item.merchant : ''}
            </p>
            <div className="text-xs text-brand-400 dark:text-brand-500 flex items-center gap-1">
               {isCalendarQueueItem(item) ? 'Due: ' : isTodoQueueItem(item) ? 'Due: ' : 'Tx: '}
               {format(parseISO(item.date), 'MMM d, yyyy')}
               {isTodoQueueItem(item) && item.assignedTo && (
                 <div className="ml-1">
                   {renderAssigneeChip(item.assignedTo)}
                 </div>
               )}
               {isTodoQueueItem(item) && isBefore(parseISO(item.date), startOfToday()) && (
                 <span className="flex items-center gap-0.5 text-money-neg font-bold ml-1">
                   <AlertCircle size={10} />
                   Overdue
                 </span>
               )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isTransactionQueueItem(item) && item.needsAmount ? (
            <span className="text-xxs font-bold text-warm-700 dark:text-warm-300 bg-warm-100 dark:bg-warm-900/30 px-2 py-0.5 rounded-full whitespace-nowrap">
              Add amount
            </span>
          ) : (isTransactionQueueItem(item) || isCalendarQueueItem(item)) ? (
            <span className="font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50">{fmt(item.amount)}</span>
          ) : null}
          {!isExpanded && !selectionMode && (
            <Button
              variant="primary"
              size="sm"
              className="px-4 min-h-11"
              onClick={handleExpand}
              aria-label={`Review ${itemLabel}`}
            >
              Review
            </Button>
          )}
        </div>
      </div>
      </motion.div>

      {/* Review / approve flow lives in its own bottom sheet rather than
          expanding the row in place, so the list stays a static summary. */}
      <Drawer isOpen={isExpanded} onClose={handleClose} title={drawerTitle}>
        {isCalendarQueueItem(item) ? (
          /* Calendar Item Actions */
          <div className="space-y-2">
            <p className="text-xs text-brand-500 dark:text-brand-400 mb-3">
              {item.type === 'expense' ? 'Confirm this expense' : 'Confirm this income'} has hit your account:
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="success"
                onClick={() => {
                  setPayModalItemId(item.id);
                  setExpandedId(null);
                }}
                className="w-full sm:flex-1"
                leftIcon={<Check size={16} />}
              >
                Approve
              </Button>
              <Button
                variant="warning"
                onClick={async () => {
                  await deferCalendarItem(item.id);
                  setExpandedId(null);
                }}
                className="w-full sm:flex-1"
                leftIcon={<Clock size={16} />}
              >
                Defer
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  showDeleteConfirmation(async () => {
                    await deleteCalendarItem(item.id);
                    setExpandedId(null);
                  }, 'calendar item');
                }}
                className="w-full sm:flex-1"
                leftIcon={<Trash2 size={16} />}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : isTodoQueueItem(item) ? (
          /* To-Do Item Actions */
          <div className="space-y-2">
             <p className="text-xs text-brand-500 dark:text-brand-400 mb-3">
               Mark this task as complete or delay it:
             </p>
             <div className="flex flex-col sm:flex-row gap-2">
               <Button
                 variant="success"
                 onClick={async () => {
                   try {
                     await completeToDo(item.id);
                     toast.success('To-Do completed! 🎉');
                     setExpandedId(null);
                   } catch (error) {
                     console.error('Failed to complete task:', error);
                     toast.error('Failed to complete to-do');
                   }
                 }}
                 className="w-full sm:flex-1"
                 leftIcon={<Check size={16} />}
               >
                 Complete
               </Button>
               <Button
                 variant="warning"
                 onClick={async () => {
                   const today = startOfToday();
                   const tomorrowDate = addDays(today, 1);
                   const originalDueDate = parseISO(item.date);

                   if (!isValid(originalDueDate)) {
                     toast.error('Invalid due date');
                     return;
                   }

                   const deferredFromOriginal = addDays(originalDueDate, 1);
                   const newDueDate = isAfter(deferredFromOriginal, tomorrowDate)
                     ? deferredFromOriginal
                     : tomorrowDate;

                   const newDueDateString = format(newDueDate, 'yyyy-MM-dd');
                   try {
                     await updateToDo(item.id, { completeByDate: newDueDateString });

                     if (isBefore(originalDueDate, today)) {
                       toast.success(
                         `Deferred overdue task (was due ${format(
                           originalDueDate,
                           'MMM d'
                         )}) to ${format(newDueDate, 'MMM d')}`
                       );
                     } else {
                       toast.success(`Deferred to ${format(newDueDate, 'MMM d')}`);
                     }
                     setExpandedId(null);
                   } catch (error) {
                     console.error('Failed to defer task:', error);
                     toast.error('Failed to defer task. Please try again.');
                   }
                 }}
                 className="w-full sm:flex-1"
                 leftIcon={<Clock size={16} />}
               >
                 Defer
               </Button>
               <Button
                 variant="destructive"
                 onClick={() => {
                   showDeleteConfirmation(async () => {
                     await deleteToDo(item.id);
                     setExpandedId(null);
                     toast.success('Task deleted');
                   });
                 }}
                 className="w-full sm:flex-1"
                 leftIcon={<Trash2 size={16} />}
               >
                 Delete
               </Button>
             </div>
          </div>
        ) : (
          /* Transaction review — shared form (verify + inline edit + habits + delete) */
          <TransactionReviewForm
            transaction={item}
            onDone={() => setExpandedId(null)}
          />
        )}
      </Drawer>
    </div>
  );
}, areActionQueueItemPropsEqual);

ActionQueueItemCard.displayName = 'ActionQueueItemCard';
