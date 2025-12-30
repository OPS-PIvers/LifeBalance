
import React, { useState } from 'react';
import { useHousehold } from '../contexts/HouseholdContext';
import { Sparkles, RefreshCw, BarChart2, CalendarClock, Receipt, X, Pencil } from 'lucide-react';
import AnalyticsModal from '../components/modals/AnalyticsModal';
import ChallengeFormModal from '../components/modals/ChallengeFormModal';
import { endOfDay, isBefore, parseISO, isSameDay, format } from 'date-fns';

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
    accounts
  } = useHousehold();
  
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);

  // --- ACTION QUEUE LOGIC ---
  const today = new Date();
  const endToday = endOfDay(today);

  // 1. Due Calendar Items (Past or Today, Unpaid)
  const dueCalendarItems = calendarItems.filter(item => 
    !item.isPaid && (isBefore(parseISO(item.date), endToday) || isSameDay(parseISO(item.date), today))
  ).map(i => ({ ...i, queueType: 'calendar' as const }));

  // 2. Pending Transactions
  const pendingTx = transactions.filter(t => 
    t.status === 'pending_review'
  ).map(t => ({ ...t, queueType: 'transaction' as const }));

  // 3. Combined & Sorted (Reverse Chronological: Newest First)
  const actionQueue = [...dueCalendarItems, ...pendingTx].sort((a, b) => {
    // Determine date property
    const dateA = a.queueType === 'calendar' ? (a as any).date : (a as any).date;
    const dateB = b.queueType === 'calendar' ? (b as any).date : (b as any).date;
    return new Date(dateB).getTime() - new Date(dateA).getTime();
  });

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  // Widget B Data
  const linkedHabits = habits.filter(h => activeChallenge.relatedHabitIds.includes(h.id));
  const completedHabitsCount = linkedHabits.reduce((acc, h) => acc + h.totalCount, 0); 
  const challengeTarget = activeChallenge.targetTotalCount;
  const challengeProgress = Math.min(100, (completedHabitsCount / challengeTarget) * 100);

  return (
    <div className="min-h-screen bg-brand-50 pb-28">
      
      {/* Dashboard Header */}
      <div className="px-4 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">Hi, {currentUser.displayName}</h1>
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
                const isCalendar = item.queueType === 'calendar';
                
                return (
                  <div key={item.id} className="bg-brand-50 rounded-xl border border-brand-100 overflow-hidden transition-all">
                    <div className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* Icon */}
                        <div className={`p-2 rounded-lg ${isCalendar ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                           {isCalendar ? <CalendarClock size={16} /> : <Receipt size={16} />}
                        </div>
                        <div>
                          <p className="font-bold text-brand-700 text-sm">
                            {isCalendar ? (item as any).title : (item as any).merchant}
                          </p>
                          <p className="text-xs text-brand-400">
                             {isCalendar ? 'Due: ' : 'Tx: '}
                             {(item as any).date}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-brand-800">${item.amount.toLocaleString()}</span>
                        {!isExpanded && (
                          <button 
                            onClick={() => isCalendar ? setPayModalItemId(item.id) : setExpandedId(item.id)}
                            className={`text-xs font-bold text-white px-3 py-1.5 rounded-lg shadow-sm active:scale-95 ${
                                isCalendar ? 'bg-brand-800' : 'bg-brand-600'
                            }`}
                          >
                            {isCalendar ? 'Pay' : 'Review'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded Category Selector (Transactions Only) */}
                    {!isCalendar && isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-brand-100 bg-white">
                        <div className="flex justify-between items-center mb-2">
                           <p className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Select Category</p>
                           <button onClick={() => setExpandedId(null)}><X size={14} className="text-brand-300"/></button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {buckets.map(bucket => (
                            <button
                              key={bucket.id}
                              onClick={() => {
                                updateTransactionCategory(item.id, bucket.name);
                                setExpandedId(null);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 border border-brand-200 hover:bg-brand-100 active:bg-brand-200 transition-colors"
                            >
                              {bucket.name}
                            </button>
                          ))}
                          <button
                              onClick={() => {
                                updateTransactionCategory(item.id, 'Budgeted in Calendar');
                                setExpandedId(null);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 active:bg-indigo-200 transition-colors"
                            >
                              Budgeted in Calendar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Widget B: Monthly Challenge */}
        <div className="bg-brand-800 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden group">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10"></div>
          
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-lg">{activeChallenge.title}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-white/10 px-2 py-1 rounded-lg">
                  {format(new Date(), 'MMM yyyy')}
                </span>
                <button 
                  onClick={() => setIsChallengeModalOpen(true)}
                  className="p-1 text-brand-300 hover:text-white transition-colors rounded-full hover:bg-white/10"
                >
                  <Pencil size={14} />
                </button>
              </div>
            </div>
            <p className="text-xs text-brand-300 mb-4">Complete habits to unlock {activeChallenge.yearlyRewardLabel}</p>
            
            <div className="h-2 w-full bg-brand-900 rounded-full overflow-hidden mb-2">
              <div 
                className="h-full bg-gradient-to-r from-habit-gold to-orange-400 rounded-full transition-all duration-1000"
                style={{ width: `${challengeProgress}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] font-medium text-brand-300">
              <span>{completedHabitsCount} Habits</span>
              <span>{challengeTarget} Target</span>
            </div>
          </div>
        </div>

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
      <ChallengeFormModal isOpen={isChallengeModalOpen} onClose={() => setIsChallengeModalOpen(false)} />
      
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
