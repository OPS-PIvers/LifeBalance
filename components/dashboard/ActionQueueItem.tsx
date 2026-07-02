import React, { useState, useMemo, memo } from 'react';
import {
  CalendarClock, Receipt, Check, Trash2, Clock, ListTodo, AlertCircle, Sparkles, Pencil, Save, ChevronDown
} from 'lucide-react';
import { format, parseISO, isBefore, addDays, isAfter, startOfToday, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import {
  ActionQueueItem, isCalendarQueueItem, isTodoQueueItem, isTransactionQueueItem
} from '@/hooks/useActionQueue';
import { HouseholdMember, BudgetBucket, Habit, Transaction, ToDo } from '@/types/schema';
import { suggestHabitsForTransaction } from '@/utils/habitSuggestions';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { cn } from '@/utils/cn';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';
import { Drawer } from '@/components/ui/Drawer';

interface ActionQueueItemProps {
  item: ActionQueueItem;
  isExpanded: boolean;
  setExpandedId: (id: string | null) => void;
  setPayModalItemId: (id: string | null) => void;

  // Data props passed down from parent to avoid consuming context
  buckets: BudgetBucket[];
  habits: Habit[];
  transactions: Transaction[];
  members: HouseholdMember[];

  // Action props passed down from parent
  updateTransactionCategory: (id: string, category: string, relatedHabitIds?: string[]) => Promise<void>;
  updateTransaction: (id: string, updates: Partial<Transaction>) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
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

  // Check data dependencies (shallow comparison)
  // This ensures that if the parent passes the same array references, we don't re-render
  // unless the item itself changed.

  // Members are used in the summary view (assignee chip), so we must always check for updates.
  if (prev.members !== next.members) {
      return false;
  }

  // OPTIMIZATION: Buckets, Habits, and Transactions are ONLY used in the expanded view.
  // If the item is collapsed (and staying collapsed), we can safely ignore changes to these large collections.
  // This prevents the entire list from re-rendering when a single transaction is updated.
  if (next.isExpanded) {
    if (prev.buckets !== next.buckets ||
        prev.habits !== next.habits ||
        prev.transactions !== next.transactions) {
        return false;
    }
  }

  // Check action handlers (should be stable if from context)
  if (prev.updateTransactionCategory !== next.updateTransactionCategory ||
      prev.updateTransaction !== next.updateTransaction ||
      prev.deleteTransaction !== next.deleteTransaction ||
      prev.updateToDo !== next.updateToDo ||
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

interface SelectableChipProps {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** Small pulsing dot hinting a high-confidence suggestion (unselected state only). */
  showSuggestionDot?: boolean;
}

/**
 * A single unified selection-chip treatment, shared by the habit-suggestion
 * chips and the budget-category chips below. Replaces the two competing
 * "selected" color/border languages that used to live in this file.
 */
const SelectableChip: React.FC<SelectableChipProps> = ({ selected, onClick, children, showSuggestionDot }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'relative px-3 py-1.5 rounded-btn text-xs font-semibold transition-colors duration-(--duration-fast) ease-(--ease-standard) inline-flex items-center gap-1',
      selected
        ? 'bg-accent-600 text-white'
        : 'bg-white border border-brand-200 text-brand-600 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-300 dark:hover:bg-brand-700'
    )}
  >
    {selected && <Check size={12} strokeWidth={3} />}
    {children}
    {!selected && showSuggestionDot && (
      <span className="absolute -top-1 -right-1 w-2 h-2 bg-warm-500 rounded-full motion-safe:animate-pulse" aria-hidden="true" />
    )}
  </button>
);

// Optimization: Memoized to prevent re-renders of unexpanded items when one item is expanded/collapsed.
// We use isExpanded boolean instead of passing expandedId string to ensure stable props for unexpanded items.
// Updated 2026-02-19: Accepts context values as props to avoid re-rendering on unrelated context updates.
export const ActionQueueItemCard: React.FC<ActionQueueItemProps> = memo(({
  item, isExpanded, setExpandedId, setPayModalItemId,
  buckets,
  habits,
  transactions,
  members,
  updateTransactionCategory,
  updateTransaction,
  deleteTransaction,
  updateToDo,
  deleteToDo,
  completeToDo,
  deferCalendarItem,
  deleteCalendarItem,
}) => {

  const fmt = useFormatCurrency();
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [showAllHabits, setShowAllHabits] = useState(false);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    merchant: '',
    amount: '',
    date: ''
  });
  const [editErrors, setEditErrors] = useState<{ amount?: string; merchant?: string }>({});

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

  const handleExpand = () => {
    setExpandedId(item.id);
    if (isTransactionQueueItem(item)) {
      // Initialize with existing habit associations
      setSelectedHabitIds(item.relatedHabitIds || []);
      // Initialize with current category
      setSelectedCategory(item.category || '');
      setShowAllHabits(false);
      if (item.needsAmount) {
        // Apple Pay $0 "awaiting amount" stub: open the edit form first (blank
        // amount) so the user must enter the real amount before approving — the
        // edit form's amount>0 validation prevents verifying a $0.
        setEditForm({ merchant: item.merchant, amount: '', date: item.date });
        setEditErrors({});
        setIsEditing(true);
      } else {
        // Reset edit state
        setIsEditing(false);
      }
    } else {
      setSelectedHabitIds([]);
      setSelectedCategory('');
    }
  };

  const handleClose = () => setExpandedId(null);

  const handleEdit = () => {
    if (isTransactionQueueItem(item)) {
        setEditForm({
            merchant: item.merchant,
            amount: item.amount.toString(),
            date: item.date
        });
        setEditErrors({});
        setIsEditing(true);
    }
  };

  const handleSave = async () => {
      if (!isTransactionQueueItem(item)) return;

      const amount = parseFloat(editForm.amount);
      const errors: { amount?: string; merchant?: string } = {};

      if (isNaN(amount) || amount <= 0) {
          errors.amount = "Please enter a valid amount";
      }
      if (!editForm.merchant.trim()) {
          errors.merchant = "Merchant name is required";
      }

      if (Object.keys(errors).length > 0) {
          setEditErrors(errors);
          // Also surface via toast for sighted users
          const firstError = errors.amount ?? errors.merchant ?? '';
          toast.error(firstError);
          return;
      }

      setEditErrors({});
      try {
          await updateTransaction(item.id, {
              merchant: editForm.merchant,
              amount: amount,
              date: editForm.date,
              // Entering a real amount resolves an Apple Pay "awaiting amount" stub.
              ...(item.needsAmount ? { needsAmount: false } : {})
          });
          setIsEditing(false);
          // Toast is handled by updateTransaction or we can add one here if needed,
          // but updateTransaction already has a success toast.
      } catch (error) {
          console.error("Failed to update transaction", error);
      }
  };

  const handleDelete = () => {
      if (!isTransactionQueueItem(item)) return;

      showDeleteConfirmation(async () => {
          await deleteTransaction(item.id);
          setExpandedId(null);
      });
  };

  // Smart habit suggestions for transactions
  const suggestedHabits = useMemo(() => {
    if (!isTransactionQueueItem(item)) return [];
    return suggestHabitsForTransaction(
      item.merchant,
      habits,
      transactions,
      5 // Show top 5 suggestions
    );
  }, [item, habits, transactions]);

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
    : isEditing
    ? 'Edit Transaction'
    : 'Select Category';

  const lowConfidenceHabits = suggestedHabits.filter(s => s.confidence === 'low');
  const remainingLowConfidenceHabits = lowConfidenceHabits.filter(s => !selectedHabitIds.includes(s.habit.id));

  return (
    <div className="relative hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/30 group">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={`w-9 h-9 rounded-card border flex items-center justify-center ${iconClasses}`}>
             {iconComponent}
          </div>
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
          {!isExpanded && (
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
          /* Transaction Queue Item */
          isEditing ? (
            <div className="space-y-3">
                <Input
                  label="Merchant"
                  value={editForm.merchant}
                  onChange={e => setEditForm({...editForm, merchant: e.target.value})}
                  error={editErrors.merchant}
                />
                <div className="flex gap-2">
                  <Input
                      label="Amount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={editForm.amount}
                      onChange={e => setEditForm({...editForm, amount: e.target.value})}
                      icon={<span className="text-brand-400 dark:text-brand-500 font-bold">$</span>}
                      error={editErrors.amount}
                  />
                  <Input
                      label="Date"
                      type="date"
                      value={editForm.date}
                      onChange={e => setEditForm({...editForm, date: e.target.value})}
                  />
                </div>
                <div className="flex gap-2 pt-2">
                    <Button variant="ghost" className="flex-1" onClick={() => setIsEditing(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" className="flex-1" onClick={handleSave} leftIcon={<Save size={16}/>}>
                        Save Changes
                    </Button>
                </div>
            </div>
          ) : (
            /* Transaction Category & Habit Selector */
            <div className="space-y-3">
              {/* Habits Section - Smart Suggestions */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Eyebrow as="p" className="text-xxs">Connect Habits</Eyebrow>
                  {suggestedHabits.some(s => s.confidence !== 'low') && (
                    <Sparkles size={10} className="text-warm-500" />
                  )}
                </div>
                {habits.length === 0 && <p className="text-xs text-brand-400 dark:text-brand-500 italic">No habits found. Create some in Habits tab.</p>}

                {habits.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {/* Show suggested habits first */}
                    {suggestedHabits
                      .filter(s => s.confidence === 'high' || s.confidence === 'medium')
                      .map(({ habit, confidence }) => {
                        const isSelected = selectedHabitIds.includes(habit.id);
                        return (
                          <SelectableChip
                            key={habit.id}
                            selected={isSelected}
                            showSuggestionDot={confidence === 'high'}
                            onClick={() => {
                              setSelectedHabitIds(prev =>
                                isSelected
                                  ? prev.filter(id => id !== habit.id)
                                  : [...prev, habit.id]
                              );
                            }}
                          >
                            {habit.title}
                          </SelectableChip>
                        );
                      })}

                    {/* Low-confidence habits already selected stay visible even
                        when "Show more" is collapsed. */}
                    {lowConfidenceHabits
                      .filter(s => selectedHabitIds.includes(s.habit.id))
                      .map(({ habit }) => (
                        <SelectableChip
                          key={habit.id}
                          selected
                          onClick={() => setSelectedHabitIds(prev => prev.filter(id => id !== habit.id))}
                        >
                          {habit.title}
                        </SelectableChip>
                      ))}

                    {/* Remaining low-confidence habits, revealed via a plain
                        toggle button (matches the app's chevron-expand
                        language elsewhere instead of a native <details>). */}
                    {showAllHabits && remainingLowConfidenceHabits.map(({ habit }) => (
                      <SelectableChip
                        key={habit.id}
                        selected={false}
                        onClick={() => setSelectedHabitIds(prev => [...prev, habit.id])}
                      >
                        {habit.title}
                      </SelectableChip>
                    ))}

                    {remainingLowConfidenceHabits.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllHabits(prev => !prev)}
                        aria-expanded={showAllHabits}
                        className="px-3 py-1.5 rounded-btn text-xs font-semibold bg-white border border-brand-200 text-brand-500 hover:bg-brand-50 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-400 dark:hover:bg-brand-700 inline-flex items-center gap-1"
                      >
                        {showAllHabits ? 'Show less' : `+ More (${remainingLowConfidenceHabits.length})`}
                        <ChevronDown
                          size={12}
                          className={cn('transition-transform duration-(--duration-fast) ease-(--ease-standard)', showAllHabits && 'rotate-180')}
                        />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Categories Section */}
              <div className="space-y-2">
                <Eyebrow as="p" className="text-xxs">Budget Category</Eyebrow>
                <div className="flex flex-wrap gap-2">
                  {buckets.map(bucket => (
                    <SelectableChip
                      key={bucket.id}
                      selected={selectedCategory === bucket.name}
                      onClick={() => setSelectedCategory(bucket.name)}
                    >
                      {bucket.name}
                    </SelectableChip>
                  ))}
                  <SelectableChip
                    selected={selectedCategory === 'Budgeted in Calendar'}
                    onClick={() => setSelectedCategory('Budgeted in Calendar')}
                  >
                    Budgeted in Calendar
                  </SelectableChip>
                </div>
              </div>

              {/* Approve Button */}
              <Button
                variant="success"
                size="lg"
                onClick={async () => {
                  if (!selectedCategory) {
                    toast.error('Please select a category');
                    return;
                  }
                  try {
                    await updateTransactionCategory(item.id, selectedCategory, selectedHabitIds);
                    toast.success('Transaction approved!');
                    setExpandedId(null);
                    setSelectedHabitIds([]);
                    setSelectedCategory('');
                  } catch (error) {
                    console.error('Failed to approve transaction:', error);
                    toast.error('Failed to approve transaction');
                  }
                }}
                disabled={!selectedCategory}
                className="w-full py-3"
                leftIcon={<Check size={18} strokeWidth={3} />}
              >
                Approve Transaction
              </Button>

              {/* Edit/Delete Actions */}
              <div className="flex gap-2 pt-1 border-t border-brand-200 dark:border-brand-700 mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-xs"
                    leftIcon={<Pencil size={14}/>}
                    onClick={handleEdit}
                  >
                      Edit Details
                  </Button>
                  <Button
                    variant="ghost-danger"
                    size="sm"
                    className="flex-1 text-xs"
                    leftIcon={<Trash2 size={14}/>}
                    onClick={handleDelete}
                  >
                      Delete
                  </Button>
              </div>
            </div>
          )
        )}
      </Drawer>
    </div>
  );
}, areActionQueueItemPropsEqual);

ActionQueueItemCard.displayName = 'ActionQueueItemCard';
