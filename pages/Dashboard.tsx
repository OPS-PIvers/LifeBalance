import React, { useState, useCallback, Suspense } from 'react';
import { useFinance, useGamification, useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { BarChart2 } from 'lucide-react';
// Lazy-loaded so their heavy dependencies (e.g. recharts) stay out of the
// initial Dashboard bundle and only load when a modal is actually opened.
const AnalyticsModal = React.lazy(() => import('@/components/modals/AnalyticsModal'));
const ChallengeHubModal = React.lazy(() => import('@/components/modals/ChallengeHubModal'));
const InsightsArchiveModal = React.lazy(() => import('@/components/modals/InsightsArchiveModal'));
import { useActionQueue } from '@/hooks/useActionQueue';
import { ActionQueueItemCard } from '@/components/dashboard/ActionQueueItem';
import { ChallengeWidget } from '@/components/dashboard/ChallengeWidget';
import { EmptyChallengeWidget } from '@/components/dashboard/EmptyChallengeWidget';
import { InsightWidget } from '@/components/dashboard/InsightWidget';
import { MoneyPulseWidget } from '@/components/dashboard/MoneyPulseWidget';
import { DailyHabitsWidget } from '@/components/dashboard/DailyHabitsWidget';
import { UpcomingBillsWidget } from '@/components/dashboard/UpcomingBillsWidget';
import { CategorySpendWidget } from '@/components/dashboard/CategorySpendWidget';
import { ActivityFeedWidget } from '@/components/dashboard/ActivityFeedWidget';
import { CreateChallengePayload } from '@/types/schema';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { SafeToSpendHero } from '@/components/dashboard/SafeToSpendHero';

const Dashboard: React.FC = () => {
  // Consume the narrowest context slices so a change in one domain (e.g. a
  // shopping toggle) doesn't re-render the whole Dashboard.
  const { isLoading, currentUser, members, pendingItemsCount } = useHouseholdCore();
  const {
    accounts,
    buckets,
    transactions,
    payCalendarItem,
    deferCalendarItem,
    deleteCalendarItem,
    updateTransactionCategory,
    updateTransaction,
    deleteTransaction,
  } = useFinance();
  const { activeChallenge, habits } = useGamification();
  const { updateToDo, deleteToDo, completeToDo } = useTodos();
  
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [proposedChallenge, setProposedChallenge] = useState<CreateChallengePayload | null>(null);

  const handleCreateChallenge = useCallback((payload: CreateChallengePayload) => {
    setProposedChallenge(payload);
    setIsChallengeModalOpen(true);
  }, []);

  // --- ACTION QUEUE LOGIC ---
  const { actionQueue } = useActionQueue();

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-32">
      
      {/* Dashboard Header */}
      <div className="px-6 py-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Hi, {currentUser?.displayName || 'there'}</h1>
          <p className="text-base text-slate-500 dark:text-slate-400 font-medium mt-1">Let&apos;s make today count.</p>
        </div>
        <button
          onClick={() => setIsAnalyticsOpen(true)}
          className="p-3 bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 ring-1 ring-black/5 dark:ring-white/5 rounded-2xl shadow-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-white dark:hover:bg-slate-800 active:scale-95 transition-all"
          aria-label="Open Analytics"
        >
          <BarChart2 size={24} />
        </button>
      </div>

      <div className="px-4 space-y-8">

        {/* Hero: Safe to Spend */}
        <SafeToSpendHero />

        {/* Pending Voice Commands Banner */}
        {pendingItemsCount > 0 && (
          <div className="bg-white/90 dark:bg-slate-800/70 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-xs ring-1 ring-black/5 dark:ring-white/5 rounded-2xl p-4 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)] animate-pulse"></div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Processing voice command{pendingItemsCount !== 1 ? 's' : ''}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Adding {pendingItemsCount} item{pendingItemsCount !== 1 ? 's' : ''} from your Siri shortcuts...
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Widget A: Action Queue */}
        <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-premium ring-1 ring-black/5 dark:ring-white/5 rounded-3xl p-8 animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              {actionQueue.length > 0 ? (
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-xs"></span>
              ) : (
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs"></span>
              )}
              Action Queue {actionQueue.length > 0 && `(${actionQueue.length})`}
            </h2>
          </div>

          {actionQueue.length > 0 ? (
            <div className="space-y-4">
              {actionQueue.map(item => (
                <ActionQueueItemCard
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  setExpandedId={setExpandedId}
                  setPayModalItemId={setPayModalItemId}
                  buckets={buckets}
                  habits={habits}
                  transactions={transactions}
                  members={members}
                  updateTransactionCategory={updateTransactionCategory}
                  updateTransaction={updateTransaction}
                  deleteTransaction={deleteTransaction}
                  updateToDo={updateToDo}
                  deleteToDo={deleteToDo}
                  completeToDo={completeToDo}
                  deferCalendarItem={deferCalendarItem}
                  deleteCalendarItem={deleteCalendarItem}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm font-medium text-slate-400 dark:text-slate-500">✨ All caught up!</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Nothing needs your attention right now.</p>
            </div>
          )}
        </div>

        {/* Widget: Daily Habits */}
        <DailyHabitsWidget />

        {/* Widget: Money Pulse */}
        <MoneyPulseWidget />

        {/* Widget: Upcoming Bills */}
        <UpcomingBillsWidget onPay={setPayModalItemId} />

        {/* Widget: Recent Activity */}
        <ActivityFeedWidget />

        {/* Widget: Category Spend */}
        <CategorySpendWidget />

        {/* Widget B: Monthly Challenge (Enhanced) */}
        {activeChallenge ? (
          <ChallengeWidget onOpenModal={() => setIsChallengeModalOpen(true)} />
        ) : (
          <EmptyChallengeWidget onOpenModal={() => setIsChallengeModalOpen(true)} />
        )}

        {/* Widget C: Gemini Insight */}
        <InsightWidget
          onOpenArchive={() => setIsArchiveOpen(true)}
          onCreateChallenge={handleCreateChallenge}
        />

      </div>

      <Suspense fallback={<div className="fixed inset-0 z-modal bg-slate-900/40 backdrop-blur-xs" />}>
        {isAnalyticsOpen && <AnalyticsModal isOpen={isAnalyticsOpen} onClose={() => setIsAnalyticsOpen(false)} />}
        {isChallengeModalOpen && (
          <ChallengeHubModal
            isOpen={isChallengeModalOpen}
            onClose={() => {
              setIsChallengeModalOpen(false);
              setProposedChallenge(null);
            }}
            initialData={proposedChallenge}
          />
        )}
        {isArchiveOpen && <InsightsArchiveModal isOpen={isArchiveOpen} onClose={() => setIsArchiveOpen(false)} />}
      </Suspense>
      
      {/* Pay Modal for Calendar Items */}
      {payModalItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
           <div
             role="dialog"
             aria-modal="true"
             aria-labelledby="pay-bill-title"
             className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-white/20 dark:border-white/5 animate-in zoom-in-95"
           >
             <h3 id="pay-bill-title" className="font-bold text-lg text-slate-900 dark:text-slate-100 mb-2">Confirm Payment</h3>
             <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
               Select which account to deduct this payment from.
             </p>

             <div className="space-y-3 mb-6">
               {accounts.filter(a => a.type !== 'credit').map(acc => (
                 <button
                   key={acc.id}
                   onClick={() => {
                     payCalendarItem(payModalItemId, acc.id);
                     setPayModalItemId(null);
                   }}
                   className="w-full p-4 flex justify-between items-center bg-white dark:bg-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-slate-200 dark:hover:border-slate-600 shadow-xs hover:shadow-md transition-all group"
                 >
                   <span className="font-bold text-slate-700 dark:text-slate-200 text-sm group-hover:text-slate-900 dark:group-hover:text-slate-100">{acc.name}</span>
                   <span className="font-mono text-xs text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300">${acc.balance.toLocaleString()}</span>
                 </button>
               ))}
             </div>

             <button
               onClick={() => setPayModalItemId(null)}
               className="w-full py-3 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 font-semibold transition-colors text-sm"
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
