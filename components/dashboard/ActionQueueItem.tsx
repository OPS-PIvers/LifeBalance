/* eslint-disable react/prop-types */
import React, { useState, useMemo, memo } from 'react';
import {
  CalendarClock, Receipt, X, Check, Trash2, Clock, ListTodo, AlertCircle, Sparkles
} from 'lucide-react';
import { format, parseISO, isBefore, addDays, isAfter, startOfToday, isValid } from 'date-fns';
import toast from 'react-hot-toast';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { showDeleteConfirmation } from '../../utils/toastHelpers';
import {
  ActionQueueItem, isCalendarQueueItem, isTodoQueueItem, isTransactionQueueItem
} from '../../hooks/useActionQueue';
import { HouseholdMember } from '../../types/schema';
import { suggestHabitsForTransaction } from '../../utils/habitSuggestions';

interface ActionQueueItemProps {
  item: ActionQueueItem;
  isExpanded: boolean;
  setExpandedId: (id: string | null) => void;
  setPayModalItemId: (id: string | null) => void;
}

const areActionQueueItemPropsEqual = (
  prev: ActionQueueItemProps,
  next: ActionQueueItemProps
): boolean => (
  prev.item.id === next.item.id
  && prev.isExpanded === next.isExpanded
  && prev.setExpandedId === next.setExpandedId
  && prev.setPayModalItemId === next.setPayModalItemId
);

// Optimization: Memoized to prevent re-renders of unexpanded items when one item is expanded/collapsed.
// We use isExpanded boolean instead of passing expandedId string to ensure stable props for unexpanded items.
export const ActionQueueItemCard: React.FC<ActionQueueItemProps> = memo(({
  item, isExpanded, setExpandedId, setPayModalItemId
}) => {
  const {
    buckets,
    habits,
    transactions,
    updateTransactionCategory,
    updateToDo,
    deleteToDo,
    completeToDo,
    deferCalendarItem,
    deleteCalendarItem,
    members
  } = useHousehold();

  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

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
    } else {
      setSelectedHabitIds([]);
      setSelectedCategory('');
    }
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

  return (
    <div className="bg-brand-50 rounded-xl border border-brand-100 overflow-hidden transition-all">
      <div className="p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={`p-2 rounded-lg ${
              isCalendarQueueItem(item) ? 'bg-orange-100 text-orange-600' :
              isTodoQueueItem(item) ? 'bg-rose-100 text-rose-600' :
              'bg-blue-100 text-blue-600'
            }`}>
             {isCalendarQueueItem(item) ? <CalendarClock size={16} /> :
              isTodoQueueItem(item) ? <ListTodo size={16} /> :
              <Receipt size={16} />}
          </div>
          <div>
            <p className="font-bold text-brand-700 text-sm">
              {isCalendarQueueItem(item) ? item.title :
               isTodoQueueItem(item) ? item.text :
               isTransactionQueueItem(item) ? item.merchant : ''}
            </p>
            <div className="text-xs text-brand-400 flex items-center gap-1">
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
            <span className="font-mono font-bold text-brand-800">${item.amount.toLocaleString()}</span>
          )}
          {!isExpanded && (
            <button
              onClick={handleExpand}
              className="text-xs font-bold text-white px-3 py-1.5 rounded-lg shadow-sm active:scale-95 bg-brand-600"
              aria-label={`Review ${isTodoQueueItem(item) ? item.text : isCalendarQueueItem(item) ? item.title : isTransactionQueueItem(item) ? item.merchant || 'transaction' : 'item'}`}
            >
              Review
            </button>
          )}
        </div>
      </div>

      {/* Expanded Actions */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-brand-100 bg-white">
          <div className="flex justify-between items-center mb-2">
             <p className="text-xxs font-bold text-brand-400 uppercase tracking-wider">
               {isCalendarQueueItem(item) ? 'Actions' : 'Select Category'}
             </p>
             <button onClick={() => setExpandedId(null)}><X size={14} className="text-brand-300"/></button>
          </div>

          {isCalendarQueueItem(item) ? (
            /* Calendar Item Actions */
            <div className="space-y-2">
              <p className="text-xs text-brand-500 mb-3">
                {item.type === 'expense' ? 'Confirm this expense' : 'Confirm this income'} has hit your account:
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  onClick={() => {
                    setPayModalItemId(item.id);
                    setExpandedId(null);
                  }}
                  className="w-full sm:flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Check size={16} />
                  Approve
                </button>
                <button
                  onClick={async () => {
                    await deferCalendarItem(item.id);
                    setExpandedId(null);
                  }}
                  className="w-full sm:flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Clock size={16} />
                  Defer
                </button>
                <button
                  onClick={async () => {
                    if (confirm('Delete this calendar item?')) {
                      await deleteCalendarItem(item.id);
                      setExpandedId(null);
                    }
                  }}
                  className="w-full sm:flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
          ) : isTodoQueueItem(item) ? (
            /* To-Do Item Actions */
            <div className="space-y-2">
               <p className="text-xs text-brand-500 mb-3">
                 Mark this task as complete or delay it:
               </p>
               <div className="flex flex-col sm:flex-row gap-2">
                 <button
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
                   className="w-full sm:flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                 >
                   <Check size={16} />
                   Complete
                 </button>
                 <button
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
                   className="w-full sm:flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                 >
                   <Clock size={16} />
                   Defer
                 </button>
                 <button
                   onClick={() => {
                     showDeleteConfirmation(async () => {
                       await deleteToDo(item.id);
                       setExpandedId(null);
                       toast.success('Task deleted');
                     });
                   }}
                   className="w-full sm:flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                 >
                   <Trash2 size={16} />
                   Delete
                 </button>
               </div>
            </div>
          ) : (
            /* Transaction Category & Habit Selector */
            <div className="space-y-3">
              {/* Habits Section - Smart Suggestions */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <p className="text-xxs font-bold text-brand-400 uppercase tracking-wider">Connect Habits</p>
                  {suggestedHabits.some(s => s.confidence !== 'low') && (
                    <Sparkles size={10} className="text-violet-500" />
                  )}
                </div>
                {habits.length === 0 && <p className="text-xs text-brand-400 italic">No habits found. Create some in Habits tab.</p>}

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
                        <summary className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 border border-brand-200 text-brand-500 hover:bg-brand-100 cursor-pointer inline-flex items-center gap-1">
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
                                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors bg-brand-50 border border-brand-200 text-brand-500 hover:bg-brand-100"
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
                <p className="text-xxs font-bold text-brand-400 uppercase tracking-wider">Budget Category</p>
                <div className="flex flex-wrap gap-2">
                  {buckets.map(bucket => (
                    <button
                      key={bucket.id}
                      onClick={() => setSelectedCategory(bucket.name)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        selectedCategory === bucket.name
                          ? 'bg-brand-800 text-white shadow-sm'
                          : 'bg-brand-50 border border-brand-200 text-brand-600 hover:bg-brand-100'
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
              <button
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
                className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-brand-200 disabled:cursor-not-allowed text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                <Check size={18} strokeWidth={3} />
                Approve Transaction
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}, areActionQueueItemPropsEqual);

ActionQueueItemCard.displayName = 'ActionQueueItemCard';
