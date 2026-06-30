import React, { useState, useCallback, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFinance, useGamification, useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { AccountPicker } from '@/components/budget/AccountPicker';
import { BarChart2, CheckCircle2 } from 'lucide-react';
// Lazy-loaded so their heavy dependencies (e.g. recharts) stay out of the
// initial Dashboard bundle and only load when a modal is actually opened.
// The Analytics modal is retired: its Wallet charts now live in Money → Trends
// and its Behavior charts in Habits → Insights, so the Home chart button
// deep-links into Money → Trends instead of opening a modal (redesign IA).
const ChallengeHubModal = React.lazy(() => import('@/components/modals/ChallengeHubModal'));
const InsightsArchiveModal = React.lazy(() => import('@/components/modals/InsightsArchiveModal'));
// Lazy so the heavy Drawer-based capture flow stays out of the Dashboard chunk;
// it only loads when the "Pay down" quick action is used.
const CaptureModal = React.lazy(() => import('@/components/modals/CaptureModal'));
import { useActionQueue } from '@/hooks/useActionQueue';
import { ActionQueueItemCard } from '@/components/dashboard/ActionQueueItem';
import { InsightWidget } from '@/components/dashboard/InsightWidget';
import { DailyHabitsWidget } from '@/components/dashboard/DailyHabitsWidget';
import { KidsChoresWidget } from '@/components/dashboard/KidsChoresWidget';
import { ActivityFeedWidget } from '@/components/dashboard/ActivityFeedWidget';
import { PulseStripWidget } from '@/components/dashboard/PulseStripWidget';
import { CreateChallengePayload } from '@/types/schema';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { SafeToSpendHero } from '@/components/dashboard/SafeToSpendHero';
import { CreditCardActivityWidget } from '@/components/dashboard/CreditCardActivityWidget';
import { Section, SurfaceList } from '@/components/ui/Section';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

const Dashboard: React.FC = () => {
  // Consume the narrowest context slices so a change in one domain (e.g. a
  // shopping toggle) doesn't re-render the whole Dashboard.
  const { isLoading, currentUser, members, pendingItemsCount } = useHouseholdCore();
  const {
    buckets,
    transactions,
    payCalendarItem,
    deferCalendarItem,
    deleteCalendarItem,
    updateTransactionCategory,
    updateTransaction,
    deleteTransaction,
  } = useFinance();
  const { habits } = useGamification();
  const { updateToDo, deleteToDo, completeToDo } = useTodos();
  const { isModuleEnabled } = useModuleVisibility();
  const navigate = useNavigate();

  const [isChallengeModalOpen, setIsChallengeModalOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [proposedChallenge, setProposedChallenge] = useState<CreateChallengePayload | null>(null);

  const handleCreateChallenge = useCallback((payload: CreateChallengePayload) => {
    setProposedChallenge(payload);
    setIsChallengeModalOpen(true);
  }, []);

  const handleOpenArchive = useCallback(() => setIsArchiveOpen(true), []);

  // --- ACTION QUEUE LOGIC ---
  const { actionQueue } = useActionQueue();

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [payModalItemId, setPayModalItemId] = useState<string | null>(null);
  // The credit card targeted by the "Pay down" quick action (opens the capture
  // form pre-tagged as a payment toward that card).
  const [payDownAccountId, setPayDownAccountId] = useState<string | null>(null);
  const handlePayDown = useCallback((accountId: string) => setPayDownAccountId(accountId), []);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="min-h-screen bg-brand-50 dark:bg-brand-900 pb-nav-safe">

      {/* Editorial greeting header */}
      <PageHeader
        align="end"
        title={`Hi, ${currentUser?.displayName || 'there'}`}
        subtitle="Let's make today count."
        actions={
          /* Money trends shortcut (money domain — Plan 090). Hidden when money
             is off; the greeting then occupies the full header width. */
          isModuleEnabled('money') && (
            <button
              onClick={() => navigate('/budget', { state: { tab: 'trends' } })}
              className="shrink-0 p-2.5 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-card text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 hover:border-brand-300 dark:hover:border-brand-600 active:scale-[0.98] transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
              aria-label="View money trends"
            >
              <BarChart2 size={22} />
            </button>
          )
        }
      />

      <div className="px-4 space-y-6">

        {/* Hero: Safe to Spend — the single elevated surface on Home (money
            domain — Plan 090). The `space-y-6` stack collapses cleanly when it's
            removed (no doubled gap). */}
        {isModuleEnabled('money') && <SafeToSpendHero />}

        {/* Credit card activity — charges vs. paydowns this period so balances
            don't balloon (money domain). Self-nulls without any credit cards. */}
        {isModuleEnabled('money') && <CreditCardActivityWidget onPayDown={handlePayDown} />}

        {/* The Pulse strip — money + habits balance, the app's thesis metric */}
        <PulseStripWidget />

        {/* Pending Voice Commands Banner */}
        {pendingItemsCount > 0 && (
          <div className="surface-section p-4 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-accent-500 motion-safe:animate-pulse"></div>
              <div className="flex-1">
                <h3 className="font-display text-sm font-semibold text-brand-900 dark:text-brand-100">
                  Processing voice command{pendingItemsCount !== 1 ? 's' : ''}
                </h3>
                <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
                  Adding {pendingItemsCount} item{pendingItemsCount !== 1 ? 's' : ''} from your Siri shortcuts…
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Action Queue — triage of what needs attention */}
        <Section
          title={
            <span className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${actionQueue.length > 0 ? 'bg-habit-streak motion-safe:animate-pulse' : 'bg-money-pos'}`}
                aria-hidden="true"
              />
              Action Queue {actionQueue.length > 0 && `(${actionQueue.length})`}
            </span>
          }
        >
          {actionQueue.length > 0 ? (
            <SurfaceList>
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
            </SurfaceList>
          ) : (
            <EmptyState
              variant="surface"
              icon={<CheckCircle2 />}
              title="All caught up"
              description="Nothing needs your attention right now."
            />
          )}
        </Section>

        {/* Today's Habits — compact tracker (habits domain — Plan 090). */}
        {isModuleEnabled('habits') && <DailyHabitsWidget />}

        {/* Kids' Chores (parent overview) — self-nulls unless Kid Mode is on and a
            managed kid has a chore, so this is dormant by default. */}
        <KidsChoresWidget />

        {/* One AI Insight */}
        <InsightWidget
          onOpenArchive={handleOpenArchive}
          onCreateChallenge={handleCreateChallenge}
        />

        {/* Compact Recent Activity */}
        <ActivityFeedWidget />

      </div>

      <Suspense fallback={<div className="fixed inset-0 z-modal bg-brand-900/50" />}>
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
        {payDownAccountId && (
          <CaptureModal
            isOpen={!!payDownAccountId}
            onClose={() => setPayDownAccountId(null)}
            initialManualData={{ accountId: payDownAccountId, creditPayment: true }}
          />
        )}
      </Suspense>

      {/* Pay sheet for calendar items */}
      <AccountPicker
        isOpen={!!payModalItemId}
        onClose={() => setPayModalItemId(null)}
        onSelect={(accountId) => {
          if (payModalItemId) payCalendarItem(payModalItemId, accountId);
          setPayModalItemId(null);
        }}
      />

    </div>
  );
};

export default Dashboard;
