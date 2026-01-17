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

const Dashboard: React.FC = () => {
  const {
    activeChallenge,
    currentUser,
    payCalendarItem,
    accounts,
  } = useHousehold();
  
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);

  // --- ACTION QUEUE LOGIC ---
  const { actionQueue } = useActionQueue();

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-brand-50 pb-28">
      
      {/* Dashboard Header */}
      <div className="px-4 py-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-800">Hi, {currentUser?.displayName || 'there'}</h1>
          <p className="text-sm text-brand-400">Let&apos;s make today count.</p>
        </div>
        <button 
          onClick={() => setIsAnalyticsOpen(true)}
          className="p-3 bg-white border border-brand-100 rounded-xl shadow-sm text-brand-600 hover:bg-brand-50 active:scale-95 transition-all"
          aria-label="Open Analytics"
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
              {actionQueue.map(item => (
                <ActionQueueItemCard
                  key={item.id}
                  item={item}
                  isExpanded={expandedId === item.id}
                  setExpandedId={setExpandedId}
                  setPayModalItemId={setPayModalItemId}
                />
              ))}
            </div>
          </div>
        )}

        {/* Widget B: Monthly Challenge (Enhanced) */}
        {activeChallenge ? (
          <ChallengeWidget onOpenModal={() => setIsChallengeModalOpen(true)} />
        ) : (
          <EmptyChallengeWidget onOpenModal={() => setIsChallengeModalOpen(true)} />
        )}

        {/* Widget C: Gemini Insight */}
        <InsightWidget onOpenArchive={() => setIsArchiveOpen(true)} />

      </div>

      {isAnalyticsOpen && <AnalyticsModal isOpen={isAnalyticsOpen} onClose={() => setIsAnalyticsOpen(false)} />}
      {isChallengeModalOpen && <ChallengeHubModal isOpen={isChallengeModalOpen} onClose={() => setIsChallengeModalOpen(false)} />}
      {isArchiveOpen && <InsightsArchiveModal isOpen={isArchiveOpen} onClose={() => setIsArchiveOpen(false)} />}
      
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
