import React, { useMemo, memo, useRef, useState } from 'react';
import {
  CalendarClock, Receipt, Check, Trash2, Clock, ListTodo, AlertCircle, Pencil, Tag
} from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
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
import { haptic } from '@/utils/haptics';
import { Button } from '@/components/ui/Button';
import { Drawer } from '@/components/ui/Drawer';
import { SwipeActionRow } from '@/components/ui/SwipeActionRow';
import TransactionReviewForm from '@/components/transactions/TransactionReviewForm';

/** Hold duration (ms) before a press on a row enters multi-select mode. */
const LONG_PRESS_MS = 500;

interface ActionQueueItemProps {
  item: ActionQueueItem;
  isExpanded: boolean;
  setExpandedId: (id: string | null) => void;
  /** Open the pay confirmation sheet with the (possibly edited) amount. */
  openPaySheet: (id: string, amount: number) => void;

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
  /** Backs the inline swipe-reveal Delete (transactions only reach delete
      through the review drawer otherwise). */
  deleteTransaction: (id: string) => Promise<void>;
}

const areActionQueueItemPropsEqual = (
  prev: ActionQueueItemProps,
  next: ActionQueueItemProps
): boolean => {
  // Check if expanded state or handlers changed
  if (prev.isExpanded !== next.isExpanded ||
      prev.setExpandedId !== next.setExpandedId ||
      prev.openPaySheet !== next.openPaySheet) {
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
      prev.deleteCalendarItem !== next.deleteCalendarItem ||
      prev.deleteTransaction !== next.deleteTransaction) {
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
  item, isExpanded, setExpandedId, openPaySheet,
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
  deleteTransaction,
}) => {

  const fmt = useFormatCurrency();

  // --- Swipe-to-triage gesture (right = approve/complete, left = defer) ---
  // Swipe is a shortcut, never the only path: the Review button and expanded
  // actions remain, so disabling it (reduced motion — handled inside
  // SwipeActionRow — / expanded / select mode) loses no capability.
  const swipeDisabled = isExpanded || selectionMode;

  const approveAction = () => {
    // Transactions that can't be instant-approved fall back to the review
    // panel via handleExpand (which surfaces the amount field for $0 stubs).
    if (isTransactionQueueItem(item)) {
      if (item.needsAmount) {
        handleExpand();
        toast('Add the amount, then approve.', { icon: toastIcon(Pencil) });
        return;
      }
      if (!suggestCategoryForTransaction(item, buckets, transactions)) {
        handleExpand();
        toast('Pick a category to approve this one.', { icon: toastIcon(Tag) });
        return;
      }
    }
    onSwipeApprove(item);
  };

  // Inline delete revealed by a partial left swipe (Apple Mail's secondary
  // button). Confirmation-gated like every other delete path.
  const deleteAction = () => {
    showDeleteConfirmation(async () => {
      if (isCalendarQueueItem(item)) {
        await deleteCalendarItem(item.id);
      } else if (isTodoQueueItem(item)) {
        await deleteToDo(item.id);
        toast.success('Task deleted');
      } else {
        await deleteTransaction(item.id);
      }
    }, isCalendarQueueItem(item) ? 'calendar item' : isTodoQueueItem(item) ? 'task' : 'transaction');
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
      // Android-only in practice: a timer callback has no transient user
      // activation, so the iOS transport can't fire here (see utils/haptics.ts).
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

  // Editable pay amount for calendar items — lives HERE, before any decision,
  // so a variable bill can be corrected first and then approved. Kept as the
  // raw input string (partial entries like "12." shouldn't fight the user) and
  // re-seeded on each expand via render-time derived state.
  const [payAmountInput, setPayAmountInput] = useState('');
  const [wasExpanded, setWasExpanded] = useState(false);
  if (isExpanded !== wasExpanded) {
    setWasExpanded(isExpanded);
    if (isExpanded && isCalendarQueueItem(item)) setPayAmountInput(String(item.amount));
  }
  const parsedPayAmount = parseFloat(payAmountInput);
  const payAmountValid = Number.isFinite(parsedPayAmount) && parsedPayAmount > 0;

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
    <div className="relative hairline-divider group">
      {/* Gmail-style swipe (right = approve/complete, left = defer): partial
          swipes stick open to a tappable button; SwipeActionRow handles
          thresholds, reveal, and haptics. */}
      <SwipeActionRow
        disabled={swipeDisabled}
        startActions={[{
          icon: Check,
          label: approveLabel,
          tone: 'positive',
          onAction: approveAction,
        }]}
        endActions={[
          // Primary (full swipe / outer edge): defer.
          {
            icon: Clock,
            label: 'Defer',
            tone: 'warm',
            onAction: () => onSwipeDefer(item),
          },
          // Secondary (tappable from the stuck-open state): delete.
          {
            icon: Trash2,
            label: 'Delete',
            tone: 'destructive',
            hapticPattern: 'medium',
            onAction: deleteAction,
          },
        ]}
        onSwipeStart={cancelLongPress}
      >
      {/* Foreground layer — summary row */}
      <div
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
          'relative bg-white dark:bg-brand-800 transition-colors duration-(--duration-fast) ease-(--ease-standard)',
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
            <div className="text-xs text-brand-400 dark:text-brand-450 flex items-center gap-1">
               {isCalendarQueueItem(item) ? 'Due: ' : isTodoQueueItem(item) ? 'Due: ' : 'Tx: '}
               {format(parseISO(item.date), 'MMM d, yyyy')}
               {isTodoQueueItem(item) && item.assignedTo && (
                 <div className="ml-1">
                   {renderAssigneeChip(item.assignedTo)}
                 </div>
               )}
               {isTodoQueueItem(item) && isBefore(parseISO(item.date), startOfToday()) && (
                 <span className="flex items-center gap-0.5 text-money-neg dark:text-money-negDark font-bold ml-1">
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
      </div>
      </SwipeActionRow>

      {/* Review / approve flow lives in its own bottom sheet rather than
          expanding the row in place, so the list stays a static summary. */}
      <Drawer isOpen={isExpanded} onClose={handleClose} title={drawerTitle}>
        {isCalendarQueueItem(item) ? (
          /* Calendar Item Actions */
          <div className="space-y-2">
            <p className="text-xs text-brand-500 dark:text-brand-400 mb-3">
              {item.type === 'expense' ? 'Confirm this expense' : 'Confirm this income'} has hit your account:
            </p>

            {/* Editable amount — fix a variable bill's real charge BEFORE
                deciding what to do with it. */}
            <div className="mb-3">
              <label
                htmlFor={`queue-pay-amount-${item.id}`}
                className="block text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider mb-1.5"
              >
                Amount
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-brand-400 dark:text-brand-450">
                  $
                </span>
                <input
                  id={`queue-pay-amount-${item.id}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={payAmountInput}
                  onChange={e => setPayAmountInput(e.target.value)}
                  className="w-full pl-7 pr-3 py-2.5 font-mono tabular-nums text-sm font-semibold rounded-card border border-brand-200 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 focus:outline-hidden focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500"
                />
              </div>
              {!payAmountValid && (
                <p className="mt-1 text-xs text-money-neg dark:text-money-negDark">Enter an amount above $0.</p>
              )}
              {payAmountValid && parsedPayAmount !== item.amount && (
                <p className="mt-1 text-xs text-brand-400 dark:text-brand-450">
                  Scheduled for {fmt(item.amount)} — {item.type === 'expense' ? 'paying' : 'receiving'} {fmt(parsedPayAmount)}.
                </p>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="success"
                disabled={!payAmountValid}
                onClick={() => {
                  openPaySheet(item.id, parsedPayAmount);
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
                     toast.success('To-Do completed!');
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
