
import React, { useState, useMemo } from 'react';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { Sparkles, RefreshCw, BarChart2, CalendarClock, Receipt, X, Pencil, Check, Trash2, Clock, Plus, ListTodo, AlertCircle } from 'lucide-react';
import AnalyticsModal from '../components/modals/AnalyticsModal';
import ChallengeHubModal from '../components/modals/ChallengeHubModal';
import { endOfDay, isBefore, parseISO, isSameDay, format, subMonths, addMonths, addDays, startOfToday, isToday, isTomorrow } from 'date-fns';
import toast from 'react-hot-toast';
import { expandCalendarItems } from '../utils/calendarRecurrence';
import { calculateChallengeProgress } from '../utils/challengeCalculator';
import { getEffectiveTargetValue } from '../utils/migrations/challengeMigration';
import { Transaction, CalendarItem, ToDo, HouseholdMember } from '../types/schema';
import { showDeleteConfirmation } from '../utils/toastHelpers';

// TodoActionQueueItem normalizes the ToDo interface for the action queue
// by replacing 'completeByDate' with 'date' to match Transaction and CalendarItem.
// The 'amount' field below is a structural placeholder required to fit the
// ActionQueueItem union shape used throughout the action queue rendering logic.
// For todos it is always 0 and does NOT represent a monetary value.
type TodoActionQueueItem = Omit<ToDo, 'completeByDate'> & {
  queueType: 'todo';
  amount: number; // Placeholder numeric field; always 0 for todos and not a monetary amount, kept for ActionQueueItem union compatibility
  date: string; // Maps to completeByDate from ToDo
};

type ActionQueueItem =
  | (Transaction & { queueType: 'transaction' })
  | (CalendarItem & { queueType: 'calendar' })
  | TodoActionQueueItem;

const Dashboard: React.FC = () => {
  const {
    transactions,
    buckets,
    updateTransactionCategory,
    activeChallenge,
    habits,
    insight,
    refreshInsight,
    currentUser,
    calendarItems,
    payCalendarItem,
    deferCalendarItem,
    deleteCalendarItem,
    accounts,
    primaryYearlyGoal,
    todos,
    completeToDo,
    deleteToDo,
    updateToDo,
    members
  } = useHousehold();
  
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);

  // Memoize member lookup Map for O(1) access instead of O(n) for each todo
  const memberMap = useMemo(() => {
    const map = new Map<string, HouseholdMember>();
    members.forEach(member => map.set(member.uid, member));
    return map;
  }, [members]);

  // Helper function to render assignee avatar
  const renderAssigneeAvatar = (assignedTo: string) => {
    const assignee = memberMap.get(assignedTo);
    if (!assignee) return null;
    
    return assignee.photoURL ? (
      <img src={assignee.photoURL} alt={assignee.displayName ?? 'Assigned member'} className="w-6 h-6 rounded-full border border-white" />
    ) : (
      <div className="w-6 h-6 rounded-full bg-brand-200 flex items-center justify-center text-[10px] font-bold text-brand-600 border border-white">
        {assignee.displayName?.charAt(0) || '?'}
      </div>
    );
  };

  // --- ACTION QUEUE LOGIC ---
  const today = new Date();
  const endToday = endOfDay(today);

  // Expand recurring calendar items for a reasonable range (1 month past to 3 months future)
  // This ensures we catch any due recurring items
  const expandedCalendarItems = useMemo(
    () => expandCalendarItems(calendarItems, subMonths(today, 1), addMonths(today, 3)),
    [calendarItems, today]
  );

  // 1. Due Calendar Items (Past or Today, Unpaid)
  const dueCalendarItems: ActionQueueItem[] = expandedCalendarItems.filter(item =>
    !item.isPaid && (isBefore(parseISO(item.date), endToday) || isSameDay(parseISO(item.date), today))
  ).map(i => ({ ...i, queueType: 'calendar' as const }));

  // 2. Pending Transactions
  const pendingTx: ActionQueueItem[] = transactions.filter(t =>
    t.status === 'pending_review'
  ).map(t => ({ ...t, queueType: 'transaction' as const }));

  // 3. Immediate To-Dos (Overdue, Today or Tomorrow)
  const immediateToDos: ActionQueueItem[] = todos.filter(t => {
    if (t.isCompleted) return false;
    const date = parseISO(t.completeByDate);
    // Use consistent date-only comparisons: Overdue (before today), Today, or Tomorrow
    return isBefore(date, startOfToday()) || isToday(date) || isTomorrow(date);
  }).map(t => ({ ...t, queueType: 'todo' as const, date: t.completeByDate, amount: 0 }));

  // 4. Combined & Sorted (Chronological: Oldest First)
  const actionQueue = [...dueCalendarItems, ...pendingTx, ...immediateToDos].sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);
  const [selectedHabitIds, setSelectedHabitIds] = useState<string[]>([]);

  // Widget B Data - Enhanced Challenge Progress
  const linkedHabits = activeChallenge ? habits.filter(h => activeChallenge.relatedHabitIds.includes(h.id)) : [];
  const challengeProgressData = activeChallenge
    ? calculateChallengeProgress(activeChallenge, linkedHabits)
    : { currentValue: 0, progress: 0 };
  const challengeTarget = activeChallenge ? getEffectiveTargetValue(activeChallenge) : 1;
  const challengeProgress = challengeProgressData.progress;

  return (
    <div className="min-h-screen bg-brand-50 pb-28">
      
      {/* Dashboard Header */}
      <div className="px-4 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">Hi, {currentUser?.displayName || 'there'}</h1>
          <p className="text-sm text-brand-400">Let's make today count.</p>
        </div>
        <button 
          onClick={() => setIsAnalyticsOpen(true)}
          className="p-3 bg-white border border-brand-100 rounded-xl shadow-sm text-brand-600 hover:bg-brand-50 active:scale-95 transition-all"
        >
          <BarChart2 size={20} />
        </button>
      </div>

      <div className="px-4 space-y-6">

        {/* Widget A: Action Queue */}
        {actionQueue.length > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-brand-100 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-brand-800 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-money-neg animate-pulse"></span>
                Action Queue ({actionQueue.length})
              </h2>
            </div>
            
            <div className="space-y-3">
              {actionQueue.map(item => {
                const isExpanded = expandedId === item.id;
                
                return (
                  <div key={item.id} className="bg-brand-50 rounded-xl border border-brand-100 overflow-hidden transition-all">
                    <div className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Icon */}
                        <div className={`p-2 rounded-lg ${
                            item.queueType === 'calendar' ? 'bg-orange-100 text-orange-600' :
                            item.queueType === 'todo' ? 'bg-rose-100 text-rose-600' :
                            'bg-blue-100 text-blue-600'
                          }`}>
                           {item.queueType === 'calendar' ? <CalendarClock size={16} /> :
                            item.queueType === 'todo' ? <ListTodo size={16} /> :
                            <Receipt size={16} />}
                        </div>
                        <div>
                          <p className="font-bold text-brand-700 text-sm">
                            {item.queueType === 'calendar' ? item.title :
                             item.queueType === 'todo' ? item.text :
                             item.merchant}
                          </p>
                          <p className="text-xs text-brand-400 flex items-center gap-1">
                             {item.queueType === 'calendar' ? 'Due: ' : item.queueType === 'todo' ? 'Due: ' : 'Tx: '}
                             {format(parseISO(item.date), 'MMM d, yyyy')}
                             {item.queueType === 'todo' && isBefore(parseISO(item.date), startOfToday()) && (
                               <span className="flex items-center gap-0.5 text-red-500 font-bold ml-1">
                                 <AlertCircle size={10} />
                                 Overdue
                               </span>
                             )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {item.queueType !== 'todo' && <span className="font-mono font-bold text-brand-800">${item.amount.toLocaleString()}</span>}
                        {item.queueType === 'todo' && item.assignedTo && (
                          <div className="flex items-center">
                            {renderAssigneeAvatar(item.assignedTo)}
                          </div>
                        )}
                        {!isExpanded && (
                          <button
                            onClick={() => {
                              setExpandedId(item.id);
                              // Initialize selected habits from transaction if any, or empty
                              if (item.queueType === 'transaction' && item.relatedHabitIds) {
                                setSelectedHabitIds(item.relatedHabitIds);
                              } else {
                                setSelectedHabitIds([]);
                              }
                            }}
                            className="text-xs font-bold text-white px-3 py-1.5 rounded-lg shadow-sm active:scale-95 bg-brand-600"
                            aria-label={`Review ${item.queueType === 'todo' ? item.text : item.queueType === 'calendar' ? item.title : item.merchant}`}
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
                           <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">
                             {item.queueType === 'calendar' ? 'Actions' : 'Select Category'}
                           </p>
                           <button onClick={() => setExpandedId(null)}><X size={14} className="text-brand-300"/></button>
                        </div>

                        {item.queueType === 'calendar' ? (
                          /* Calendar Item Actions */
                          <div className="space-y-2">
                            <p className="text-xs text-brand-500 mb-3">
                              {item.type === 'expense' ? 'Confirm this expense' : 'Confirm this income'} has hit your account:
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setPayModalItemId(item.id);
                                  setExpandedId(null);
                                }}
                                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                              >
                                <Check size={16} />
                                Approve
                              </button>
                              <button
                                onClick={async () => {
                                  await deferCalendarItem(item.id);
                                  setExpandedId(null);
                                }}
                                className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
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
                                className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                              >
                                <Trash2 size={16} />
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : item.queueType === 'todo' ? (
                          /* To-Do Item Actions */
                          <div className="space-y-2">
                             <p className="text-xs text-brand-500 mb-3">
                               Mark this task as complete or delay it:
                             </p>
                             <div className="flex gap-2">
                               <button
                                 onClick={async () => {
                                   await completeToDo(item.id);
                                   setExpandedId(null);
                                 }}
                                 className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                               >
                                 <Check size={16} />
                                 Complete
                               </button>
                               <button
                                 onClick={async () => {
                                   // Defer using the later of (current due date + 1 day) or tomorrow (relative to today)
                                   const today = startOfToday();
                                   const tomorrowDate = addDays(today, 1);
                                   const originalDueDate = parseISO(item.date);
                                   let newDueDate = tomorrowDate;

                                   if (originalDueDate) {
                                     const oneDayAfterOriginal = addDays(originalDueDate, 1);
                                     newDueDate = isBefore(oneDayAfterOriginal, tomorrowDate)
                                       ? tomorrowDate
                                       : oneDayAfterOriginal;
                                   }

                                   const newDueDateString = format(newDueDate, 'yyyy-MM-dd');
                                   await updateToDo(item.id, { completeByDate: newDueDateString });

                                   if (originalDueDate && isBefore(originalDueDate, today)) {
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
                                 }}
                                 className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
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
                                 className="flex-1 py-2 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
                               >
                                 <Trash2 size={16} />
                                 Delete
                               </button>
                             </div>
                          </div>
                        ) : (
                          /* Transaction Category Selector */
                          <div className="space-y-3">
                            {/* Habits Section */}
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Connect Habits</p>
                              {habits.length === 0 && <p className="text-xs text-brand-400 italic">No habits found. Create some in Habits tab.</p>}
                              <div className="flex flex-wrap gap-2">
                                {habits.map(habit => {
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
                                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 ${
                                        isSelected
                                          ? 'bg-habit-green text-white shadow-sm'
                                          : 'bg-brand-50 border border-brand-200 text-brand-500 hover:bg-brand-100'
                                      }`}
                                    >
                                      {isSelected && <Check size={12} strokeWidth={3} />}
                                      {habit.title}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Categories Section */}
                            <div className="space-y-2">
                              <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Select Category to Confirm</p>
                              <div className="flex flex-wrap gap-2">
                                {buckets.map(bucket => (
                                  <button
                                    key={bucket.id}
                                    onClick={() => {
                                      updateTransactionCategory(item.id, bucket.name, selectedHabitIds);
                                      setExpandedId(null);
                                      setSelectedHabitIds([]); // Reset
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 border border-brand-200 hover:bg-brand-100 active:bg-brand-200 transition-colors"
                                  >
                                    {bucket.name}
                                  </button>
                                ))}
                                <button
                                    onClick={() => {
                                      updateTransactionCategory(item.id, 'Budgeted in Calendar', selectedHabitIds);
                                      setExpandedId(null);
                                      setSelectedHabitIds([]); // Reset
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 active:bg-indigo-200 transition-colors"
                                  >
                                    Budgeted in Calendar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Widget B: Monthly Challenge (Enhanced) */}
        {activeChallenge ? (
          <div
            onClick={() => setIsChallengeModalOpen(true)}
            className="bg-gradient-to-br from-brand-800 to-indigo-900 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden cursor-pointer active:scale-[0.98] transition-transform"
          >
            {/* Background decoration */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10"></div>

            <div className="relative z-10">
              {/* Header with Day Indicator */}
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-bold text-lg">{activeChallenge.title}</h2>
                <div className="flex items-center gap-2">
                  <span className="text-xs bg-white/10 px-2 py-1 rounded-lg font-medium">
                    Day {new Date().getDate()} of 30
                  </span>
                  <Pencil size={14} className="text-brand-300 opacity-70" />
                </div>
              </div>

              {/* Description (if exists) */}
              {activeChallenge.description && (
                <p className="text-xs text-brand-200 mb-2">{activeChallenge.description}</p>
              )}

              {/* Reward Label */}
              <p className="text-xs text-brand-300 mb-3">
                Complete to unlock {activeChallenge.yearlyRewardLabel}
              </p>

              {/* Progress Bar */}
              <div className="h-2 w-full bg-brand-900 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-gradient-to-r from-habit-gold to-orange-400 rounded-full transition-all duration-1000"
                  style={{ width: `${challengeProgress}%` }}
                />
              </div>

              {/* Progress Stats */}
              <div className="flex justify-between text-[10px] font-medium text-brand-300 mb-3">
                <span>
                  {challengeProgressData.currentValue} / {challengeTarget}{' '}
                  {activeChallenge.targetType === 'percentage' ? '%' : ''}
                </span>
                <span>{challengeProgress.toFixed(0)}% Complete</span>
              </div>

              {/* Yearly Goal Status (if exists) */}
              {primaryYearlyGoal && (
                <div className="pt-3 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-brand-300">Yearly Goal:</span>
                      <span className="text-xs font-bold">{primaryYearlyGoal.title}</span>
                    </div>
                    <div
                      className={`text-xs font-bold px-2 py-1 rounded-lg ${
                        primaryYearlyGoal.successfulMonths.length >=
                        primaryYearlyGoal.requiredMonths - 2
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-orange-500/20 text-orange-300'
                      }`}
                    >
                      {primaryYearlyGoal.successfulMonths.length >=
                      primaryYearlyGoal.requiredMonths - 2
                        ? 'On Track'
                        : 'Needs Attention'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Placeholder Widget */
          <div
            onClick={() => setIsChallengeModalOpen(true)}
            className="bg-white rounded-2xl p-5 shadow-sm border border-brand-100 cursor-pointer active:scale-[0.98] transition-transform hover:border-brand-200 group"
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-lg text-brand-800">Set Monthly Challenge</h2>
              <div className="flex items-center gap-2">
                 <div className="p-1.5 bg-brand-50 rounded-lg text-brand-400 group-hover:bg-brand-100 group-hover:text-brand-600 transition-colors">
                    <Plus size={16} />
                 </div>
              </div>
            </div>

            <p className="text-sm text-brand-500 mb-4">
              Challenge yourself to build better habits this month.
            </p>

            {/* Yearly Goal Status (if exists) */}
            {primaryYearlyGoal ? (
              <div className="pt-3 border-t border-brand-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-brand-400">Yearly Goal:</span>
                    <span className="text-xs font-bold text-brand-700">{primaryYearlyGoal.title}</span>
                  </div>
                  <div
                    className={`text-xs font-bold px-2 py-1 rounded-lg ${
                      primaryYearlyGoal.successfulMonths.length >=
                      primaryYearlyGoal.requiredMonths - 2
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-orange-50 text-orange-600'
                    }`}
                  >
                    {primaryYearlyGoal.successfulMonths.length >=
                    primaryYearlyGoal.requiredMonths - 2
                      ? 'On Track'
                      : 'Needs Attention'}
                  </div>
                </div>
              </div>
            ) : (
               <div className="flex items-center gap-2 text-xs text-brand-400 pt-3 border-t border-brand-100">
                 <Sparkles size={12} />
                 <span>Consistent habits lead to big results!</span>
               </div>
            )}
          </div>
        )}

        {/* Widget C: Gemini Insight */}
        <div className="bg-indigo-50 rounded-2xl p-5 border border-indigo-100 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-white rounded-xl shadow-sm text-indigo-500">
              <Sparkles size={20} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs font-bold text-indigo-400 uppercase tracking-wider">AI Insight</h3>
                <button onClick={refreshInsight} className="text-indigo-300 hover:text-indigo-500 transition-colors">
                  <RefreshCw size={14} />
                </button>
              </div>
              <p className="text-indigo-900 font-medium leading-relaxed">
                "{insight}"
              </p>
            </div>
          </div>
        </div>

      </div>

      <AnalyticsModal isOpen={isAnalyticsOpen} onClose={() => setIsAnalyticsOpen(false)} />
      <ChallengeHubModal isOpen={isChallengeModalOpen} onClose={() => setIsChallengeModalOpen(false)} />
      
      {/* Pay Modal for Calendar Items */}
      {payModalItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
           <div className="bg-white w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
             <h3 className="font-bold text-lg text-brand-800 mb-2">Confirm Payment</h3>
             <p className="text-sm text-brand-500 mb-4">
               Select which account to deduct this payment from.
             </p>
             
             <div className="space-y-2 mb-4">
               {accounts.filter(a => a.type !== 'credit').map(acc => (
                 <button
                   key={acc.id}
                   onClick={() => {
                     payCalendarItem(payModalItemId, acc.id);
                     setPayModalItemId(null);
                   }}
                   className="w-full p-3 flex justify-between items-center bg-brand-50 hover:bg-brand-100 rounded-xl border border-brand-200 text-left"
                 >
                   <span className="font-bold text-brand-700 text-sm">{acc.name}</span>
                   <span className="font-mono text-xs text-brand-500">${acc.balance.toLocaleString()}</span>
                 </button>
               ))}
             </div>
             
             <button 
               onClick={() => setPayModalItemId(null)}
               className="w-full py-3 text-brand-400 font-bold"
             >
               Cancel
             </button>
           </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
