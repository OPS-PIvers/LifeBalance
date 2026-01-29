import React, { useState } from 'react';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';
import { BarChart2 } from 'lucide-react';
import AnalyticsModal from '../components/modals/AnalyticsModal';
import ChallengeHubModal from '../components/modals/ChallengeHubModal';
import InsightsArchiveModal from '../components/modals/InsightsArchiveModal';
import { useActionQueue } from '../hooks/useActionQueue';
import { ActionQueueItemCard } from '../components/dashboard/ActionQueueItem';
import { ChallengeWidget } from '../components/dashboard/ChallengeWidget';
import { EmptyChallengeWidget } from '../components/dashboard/EmptyChallengeWidget';
import { InsightWidget } from '../components/dashboard/InsightWidget';
import { MoneyPulseWidget } from '../components/dashboard/MoneyPulseWidget';
import { CategorySpendWidget } from '../components/dashboard/CategorySpendWidget';
import { CreateChallengePayload } from '@/types/schema';

const Dashboard: React.FC = () => {
  const {
    activeChallenge,
    currentUser,
    payCalendarItem,
    accounts,
    pendingItemsCount,
    // Destructure required props for ActionQueueItemCard
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
  } = useHousehold();
  
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [proposedChallenge, setProposedChallenge] = useState<CreateChallengePayload | null>(null);

  const handleCreateChallenge = (payload: CreateChallengePayload) => {
    setProposedChallenge(payload);
    setIsChallengeModalOpen(true);
  };

  // --- ACTION QUEUE LOGIC ---
  const { actionQueue } = useActionQueue();

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-brand-50 pb-32">
      
      {/* Dashboard Header */}
      <div className="px-6 py-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Hi, {currentUser?.displayName || 'there'}</h1>
          <p className="text-base text-slate-500 font-medium mt-1">Let&apos;s make today count.</p>
        </div>
        <button 
          onClick={() => setIsAnalyticsOpen(true)}
          className="p-3 bg-white/80 backdrop-blur-xl border border-white/20 ring-1 ring-black/5 rounded-2xl shadow-sm text-slate-500 hover:text-slate-900 hover:bg-white active:scale-95 transition-all"
          aria-label="Open Analytics"
        >
          <BarChart2 size={24} />
        </button>
      </div>

      <div className="px-4 space-y-8">

        {/* Pending Voice Commands Banner */}
        {pendingItemsCount > 0 && (
          <div className="bg-white/80 backdrop-blur-md rounded-2xl p-4 shadow-sm animate-in fade-in slide-in-from-top-4 ring-1 ring-black/5">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
              <div className="flex-1">
                <h3 className="text-sm font-bold text-slate-700">
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
        {actionQueue.length > 0 && (
          <div className="bg-white/80 backdrop-blur-xl border border-white/20 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shadow-sm"></span>
                Action Queue ({actionQueue.length})
              </h2>
            </div>
            
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
          </div>
        )}

        {/* Widget: Money Pulse */}
        <MoneyPulseWidget />

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
      
      {/* Pay Modal for Calendar Items */}
      {payModalItemId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md">
           <div className="bg-white/90 backdrop-blur-2xl w-full max-w-sm rounded-2xl p-6 shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95">
             <h3 className="font-bold text-lg text-slate-900 mb-2">Confirm Payment</h3>
             <p className="text-sm text-slate-500 mb-6 leading-relaxed">
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
                   className="w-full p-4 flex justify-between items-center bg-white/50 hover:bg-white rounded-xl border border-slate-200/50 hover:border-slate-300 shadow-sm group transition-colors"
                 >
                   <span className="font-semibold text-slate-700 text-sm group-hover:text-slate-900 transition-colors">{acc.name}</span>
                   <span className="font-mono text-xs text-slate-500 group-hover:text-slate-700 transition-colors">${acc.balance.toLocaleString()}</span>
                 </button>
               ))}
             </div>
             
             <button 
               onClick={() => setPayModalItemId(null)}
               className="w-full py-3 text-slate-400 font-semibold hover:text-slate-600 transition-colors"
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
