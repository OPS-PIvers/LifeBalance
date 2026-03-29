import React, { useState, useMemo, memo } from 'react';
import {
  CalendarClock, Receipt, X, Check, Trash2, Clock, ListTodo, AlertCircle, Sparkles, Pencil, Save
} from 'lucide-react';
import { format, parseISO, isBefore, addDays, isAfter, startOfToday, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import { showDeleteConfirmation } from '../../utils/toastHelpers';
import {
  ActionQueueItem, isCalendarQueueItem, isTodoQueueItem, isTransactionQueueItem
} from '../../hooks/useActionQueue';
import { HouseholdMember, BudgetBucket, Habit, Transaction, ToDo } from '../../types/schema';
import { suggestHabitsForTransaction } from '../../utils/habitSuggestions';
import Input from '../ui/Input';
import { Button } from '../ui/Button';

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

  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    merchant: '',
    amount: '',
    date: ''
  });

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
        className="w-4 h-4 rounded-full border border-white object-cover flex-shrink-0"
      />
    ) : (
      <div className="w-4 h-4 rounded-full bg-brand-200 flex items-center justify-center text-[8px] font-bold text-brand-600 border border-white flex-shrink-0">
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
      // Reset edit state
      setIsEditing(false);
    } else {
      setSelectedHabitIds([]);
      setSelectedCategory('');
    }
  };

  const handleEdit = () => {
    if (isTransactionQueueItem(item)) {
        setEditForm({
            merchant: item.merchant,
            amount: item.amount.toString(),
            date: item.date
        });
        setIsEditing(true);
    }
  };

  const handleSave = async () => {
      if (!isTransactionQueueItem(item)) return;

      const amount = parseFloat(editForm.amount);
      if (isNaN(amount) || amount <= 0) {
          toast.error("Please enter a valid amount");
          return;
      }
      if (!editForm.merchant.trim()) {
          toast.error("Merchant name is required");
          return;
      }

      try {
          await updateTransaction(item.id, {
              merchant: editForm.merchant,
              amount: amount,
              date: editForm.date
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
        iconClasses: 'bg-orange-50 border-orange-100/50 text-orange-600',
      };
    }
    if (isTodoQueueItem(item)) {
      return {
        iconComponent: <ListTodo size={18} />,
        iconClasses: 'bg-rose-50 border-rose-100/50 text-rose-600',
      };
    }
    return {
      iconComponent: <Receipt size={18} />,
      iconClasses: 'bg-blue-50 border-blue-100/50 text-blue-600',
    };
  }, [item]);

  return (
    <div className="bg-white/80 backdrop-blur-xl rounded-2xl ring-1 ring-black/5 overflow-hidden transition-all hover:bg-white/90 shadow-soft group">
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={`p-3 rounded-2xl border shadow-sm ${iconClasses}`}>
             {iconComponent}
          </div>
          <div>
            <p className="font-bold text-slate-700 text-sm">
              {isCalendarQueueItem(item) ? item.title :
               isTodoQueueItem(item) ? item.text :
               isTransactionQueueItem(item) ? item.merchant : ''}
            </p>
            <div className="text-xs text-slate-400 flex items-center gap-1">
               {isCalendarQueueItem(item) ? 'Due: ' : isTodoQueueItem(item) ? 'Due: ' : 'Tx: '}
               {format(parseISO(item.date), 'MMM d, yyyy')}
               {isTodoQueueItem(item) && item.assignedTo && (
                 <div className="ml-1">
                   {renderAssigneeChip(item.assignedTo)}
                 </div>
               )}
               {isTodoQueueItem(item) && isBefore(parseISO(item.date), startOfToday()) && (
                 <span className="flex items-center gap-0.5 text-red-500 font-bold ml-1">
                   <AlertCircle size={10} />
                   Overdue
                 </span>
               )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {(isTransactionQueueItem(item) || isCalendarQueueItem(item)) && (
            <span className="font-mono font-bold text-slate-900">${item.amount.toLocaleString()}</span>
          )}
          {!isExpanded && (
            <button
              onClick={handleExpand}
              className="text-xs font-bold text-white px-3 py-1.5 rounded-lg shadow-sm active:scale-95 bg-slate-900"
              aria-label={`Review ${isTodoQueueItem(item) ? item.text : isCalendarQueueItem(item) ? item.title : isTransactionQueueItem(item) ? item.merchant || 'transaction' : 'item'}`}
            >
              Review
            </button>
          )}
        </div>
      </div>

      {/* Expanded Actions */}
      {isExpanded && (
        <div className="px-4 pb-3 sm:pb-4 pt-3 border-t border-black/5 bg-white/40">
          <div className="flex justify-between items-center mb-2 sm:mb-3">
             <p className="text-xxs font-bold text-slate-400 uppercase tracking-wider">
               {isCalendarQueueItem(item) ? 'Actions' : isEditing ? 'Edit Transaction' : 'Select Category'}
             </p>
             <button aria-label={"Close " + (isCalendarQueueItem(item) ? 'Actions' : isEditing ? 'Edit Transaction' : 'Select Category')} onClick={() => setExpandedId(null)}><X size={14} className="text-slate-400 hover:text-slate-600"/></button>
          </div>

          {isCalendarQueueItem(item) ? (
            /* Calendar Item Actions */
            <div className="space-y-2">
              <p className="text-xs text-slate-500 mb-3">
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
                  onClick={async () => {
                    if (confirm('Delete this calendar item?')) {
                      await deleteCalendarItem(item.id);
                      setExpandedId(null);
                    }
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
               <p className="text-xs text-slate-500 mb-3">
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
                  />
                  <div className="flex gap-2">
                    <Input
                        label="Amount"
                        type="number"
                        step="0.01"
                        value={editForm.amount}
                        onChange={e => setEditForm({...editForm, amount: e.target.value})}
                        icon={<span className="text-slate-400 font-bold">$</span>}
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
                    <p className="text-xxs font-bold text-slate-400 uppercase tracking-wider">Connect Habits</p>
                    {suggestedHabits.some(s => s.confidence !== 'low') && (
                      <Sparkles size={10} className="text-violet-500" />
                    )}
                  </div>
                  {habits.length === 0 && <p className="text-xs text-slate-400 italic">No habits found. Create some in Habits tab.</p>}

                  {habits.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {/* Show suggested habits first */}
                      {suggestedHabits
                        .filter(s => s.confidence === 'high' || s.confidence === 'medium')
                        .map(({ habit, confidence }) => {
                          const isSelected = selectedHabitIds.includes(habit.id);
                          return (
                            <button
                              key={habit.id}
                              onClick={() => {
                                setSelectedHabitIds(prev =>
                                  isSelected
                                    ? prev.filter(id => id !== habit.id)
                                    : [...prev, habit.id]
                                );
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 relative ${
                                isSelected
                                  ? 'bg-habit-green text-white shadow-sm'
                                  : confidence === 'high'
                                  ? 'bg-violet-50 border-2 border-violet-300 text-violet-700 hover:bg-violet-100'
                                  : 'bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100'
                              }`}
                            >
                              {isSelected && <Check size={12} strokeWidth={3} />}
                              {habit.title}
                              {!isSelected && confidence === 'high' && (
                                <span className="absolute -top-1 -right-1 w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                              )}
                            </button>
                          );
                        })}

                      {/* Show other habits (collapsed by default) */}
                      {suggestedHabits
                        .filter(s => s.confidence === 'low')
                        .map(({ habit }) => {
                          const isSelected = selectedHabitIds.includes(habit.id);
                          if (!isSelected) return null; // Only show if selected
                          return (
                            <button
                              key={habit.id}
                              onClick={() => {
                                setSelectedHabitIds(prev => prev.filter(id => id !== habit.id));
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 bg-habit-green text-white shadow-sm"
                            >
                              <Check size={12} strokeWidth={3} />
                              {habit.title}
                            </button>
                          );
                        })}

                      {/* "More" button to show all habits */}
                      {suggestedHabits.filter(s => s.confidence === 'low' && !selectedHabitIds.includes(s.habit.id)).length > 0 && (
                        <details className="inline">
                          <summary className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white/50 border border-slate-200 text-slate-500 hover:bg-white cursor-pointer inline-flex items-center gap-1">
                            + More ({suggestedHabits.filter(s => s.confidence === 'low').length})
                          </summary>
                          <div className="flex flex-wrap gap-2 mt-2">
                            {suggestedHabits
                              .filter(s => s.confidence === 'low' && !selectedHabitIds.includes(s.habit.id))
                              .map(({ habit }) => (
                                <button
                                  key={habit.id}
                                  onClick={() => {
                                    setSelectedHabitIds(prev => [...prev, habit.id]);
                                  }}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors bg-white/50 border border-slate-200 text-slate-500 hover:bg-white"
                                >
                                  {habit.title}
                                </button>
                              ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>

                {/* Categories Section */}
                <div className="space-y-2">
                  <p className="text-xxs font-bold text-slate-400 uppercase tracking-wider">Budget Category</p>
                  <div className="flex flex-wrap gap-2">
                    {buckets.map(bucket => (
                      <button
                        key={bucket.id}
                        onClick={() => setSelectedCategory(bucket.name)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          selectedCategory === bucket.name
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'bg-white/50 border border-slate-200 text-slate-600 hover:bg-white'
                        }`}
                      >
                        {selectedCategory === bucket.name && <Check size={12} strokeWidth={3} className="inline mr-1" />}
                        {bucket.name}
                      </button>
                    ))}
                    <button
                      onClick={() => setSelectedCategory('Budgeted in Calendar')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        selectedCategory === 'Budgeted in Calendar'
                          ? 'bg-indigo-700 text-white shadow-sm'
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                      }`}
                    >
                      {selectedCategory === 'Budgeted in Calendar' && <Check size={12} strokeWidth={3} className="inline mr-1" />}
                      Budgeted in Calendar
                    </button>
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
                <div className="flex gap-2 pt-1 border-t border-black/5 mt-2">
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
        </div>
      )}
    </div>
  );
}, areActionQueueItemPropsEqual);

ActionQueueItemCard.displayName = 'ActionQueueItemCard';
