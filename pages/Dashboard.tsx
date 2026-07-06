import React, { useState, useCallback, useMemo, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { useFinance, useTodos, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { AccountPicker } from '@/components/budget/AccountPicker';
import { BarChart2, Check, CheckCircle2, Clock, Trash2, X } from 'lucide-react';
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
import {
  useActionQueue,
  isCalendarQueueItem,
  isTodoQueueItem,
  isTransactionQueueItem,
  type ActionQueueItem,
} from '@/hooks/useActionQueue';
import { ActionQueueItemCard } from '@/components/dashboard/ActionQueueItem';
import {
  suggestAccountForCalendarItem,
  suggestAccountIdForTransaction,
  suggestCategoryForTransaction,
  nextDeferDate,
} from '@/utils/actionQueueSmart';
import { showDeleteConfirmation } from '@/utils/toastHelpers';
import { Button } from '@/components/ui/Button';
import { InsightWidget } from '@/components/dashboard/InsightWidget';
import { DailyHabitsWidget } from '@/components/dashboard/DailyHabitsWidget';
import { KidsChoresWidget } from '@/components/dashboard/KidsChoresWidget';
import { ActivityFeedWidget } from '@/components/dashboard/ActivityFeedWidget';
import { PulseStripWidget } from '@/components/dashboard/PulseStripWidget';
import { WeeklyRecapCard } from '@/components/dashboard/WeeklyRecapCard';
import { CreateChallengePayload, CREDIT_CARD_CATEGORY } from '@/types/schema';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { CreditCardActivityWidget } from '@/components/dashboard/CreditCardActivityWidget';
import { Section, SurfaceList } from '@/components/ui/Section';
import { ShowMoreRow } from '@/components/ui/ShowMoreRow';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';

// Cap the Action Queue like the sibling widgets (which cap at 5; the queue gets
// one extra row since it's the page's primary triage surface). useActionQueue
// pre-sorts by priority, so slicing keeps the most urgent items visible.
const MAX_VISIBLE_QUEUE_ITEMS = 6;

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

  // Whether the capped queue list is expanded to show every item.
  const [queueExpanded, setQueueExpanded] = useState(false);

  // --- Action Queue triage: multi-select + swipe gestures ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isBulkApprovePickerOpen, setIsBulkApprovePickerOpen] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);

  const selectedItems = useMemo(
    () => actionQueue.filter(i => selectedIds.has(i.id)),
    [actionQueue, selectedIds]
  );

  const enterSelectionMode = useCallback((id?: string) => {
    setExpandedId(null);
    setSelectionMode(true);
    setSelectedIds(id ? new Set([id]) : new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setIsBulkApprovePickerOpen(false);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const allSelected = actionQueue.length > 0 && selectedItems.length === actionQueue.length;
  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size >= actionQueue.length ? new Set() : new Set(actionQueue.map(i => i.id))
    );
  }, [actionQueue]);

  // Swipe right — instant approve with smart defaults. The card already
  // deflects transactions that can't be instant-approved ($0 stubs, no
  // resolvable category) into the review panel, so every item arriving here
  // can be committed directly.
  const handleSwipeApprove = useCallback(async (item: ActionQueueItem) => {
    try {
      if (isTodoQueueItem(item)) {
        await completeToDo(item.id);
        toast.success('To-Do completed! 🎉');
        return;
      }
      if (isCalendarQueueItem(item)) {
        const account = suggestAccountForCalendarItem(item, accounts, transactions);
        if (!account) {
          // No payable account to guess — fall back to the explicit pay sheet.
          setPayModalItemId(item.id);
          return;
        }
        await payCalendarItem(item.id, account.id, { silent: true });
        toast.success(
          item.type === 'expense'
            ? `Paid from ${account.name}`
            : `Received into ${account.name}`
        );
        return;
      }
      // A credit-tagged transaction (existing tag or the smart suggestion)
      // carries the CREDIT_CARD_CATEGORY sentinel, not a bucket category —
      // credit spend never counts toward buckets.
      const accountId = suggestAccountIdForTransaction(item, accounts, transactions);
      const isCredit = accounts.find(a => a.id === (accountId ?? item.accountId))?.type === 'credit';
      const category = isCredit
        ? CREDIT_CARD_CATEGORY
        : suggestCategoryForTransaction(item, buckets, transactions);
      if (!category) {
        // The card's pre-check makes this unreachable in practice; expand as a
        // safe fallback rather than guessing a category.
        setExpandedId(item.id);
        return;
      }
      await updateTransactionCategory(item.id, category, item.relatedHabitIds ?? [], accountId);
      toast.success(`Approved · ${category}`);
    } catch (error) {
      console.error('[ActionQueue] Swipe approve failed:', error);
      toast.error('Failed to approve. Please try again.');
    }
  }, [accounts, buckets, transactions, completeToDo, payCalendarItem, updateTransactionCategory]);

  // Swipe left — instant defer: bills/to-dos move a day forward, pending
  // transactions snooze out of the queue until tomorrow.
  const handleSwipeDefer = useCallback(async (item: ActionQueueItem) => {
    try {
      if (isCalendarQueueItem(item)) {
        await deferCalendarItem(item.id);
        return;
      }
      if (isTodoQueueItem(item)) {
        const newDate = nextDeferDate(item.date);
        await updateToDo(item.id, { completeByDate: newDate });
        toast.success(`Deferred to ${format(parseISO(newDate), 'MMM d')}`);
        return;
      }
      const snoozeUntil = nextDeferDate(item.date);
      await updateTransaction(item.id, { reviewSnoozedUntil: snoozeUntil }, { silent: true });
      toast.success('Snoozed until tomorrow');
    } catch (error) {
      console.error('[ActionQueue] Swipe defer failed:', error);
      toast.error('Failed to defer. Please try again.');
    }
  }, [deferCalendarItem, updateToDo, updateTransaction]);

  // Bulk approve. `accountOverrideId` (from the picker) pays/tags every money
  // item from that account; undefined = smart per-item assignment. Items that
  // can't be auto-approved ($0 stubs, unresolvable category/account) are
  // skipped and stay in the queue.
  const runBulkApprove = useCallback(async (accountOverrideId?: string) => {
    setIsBulkApprovePickerOpen(false);
    setIsBulkRunning(true);
    let approved = 0;
    let skipped = 0;
    for (const item of selectedItems) {
      try {
        if (isTodoQueueItem(item)) {
          await completeToDo(item.id);
          approved++;
        } else if (isCalendarQueueItem(item)) {
          const account = accountOverrideId
            ? accounts.find(a => a.id === accountOverrideId)
            : suggestAccountForCalendarItem(item, accounts, transactions);
          if (!account) {
            skipped++;
            continue;
          }
          await payCalendarItem(item.id, account.id, { silent: true });
          approved++;
        } else if (isTransactionQueueItem(item)) {
          if (item.needsAmount) {
            skipped++;
            continue;
          }
          const category = suggestCategoryForTransaction(item, buckets, transactions);
          if (!category) {
            skipped++;
            continue;
          }
          const accountId =
            accountOverrideId ?? suggestAccountIdForTransaction(item, accounts, transactions);
          await updateTransactionCategory(item.id, category, item.relatedHabitIds ?? [], accountId);
          approved++;
        }
      } catch (error) {
        console.error('[ActionQueue] Bulk approve failed for item:', item.id, error);
        skipped++;
      }
    }
    setIsBulkRunning(false);
    if (approved > 0) toast.success(`Approved ${approved} item${approved === 1 ? '' : 's'}`);
    if (skipped > 0) toast(`${skipped} left in the queue (needs an amount, category, or account)`, { icon: '👀' });
    exitSelectionMode();
  }, [selectedItems, accounts, buckets, transactions, completeToDo, payCalendarItem, updateTransactionCategory, exitSelectionMode]);

  const handleBulkApprove = useCallback(() => {
    // Only money items involve an account; a to-dos-only selection completes
    // directly without the picker detour.
    const needsAccount = selectedItems.some(i => isCalendarQueueItem(i) || isTransactionQueueItem(i));
    if (needsAccount && accounts.some(a => a.type !== 'credit')) {
      setIsBulkApprovePickerOpen(true);
    } else {
      void runBulkApprove();
    }
  }, [selectedItems, accounts, runBulkApprove]);

  const handleBulkDefer = useCallback(async () => {
    setIsBulkRunning(true);
    let deferred = 0;
    let failed = 0;
    for (const item of selectedItems) {
      try {
        if (isCalendarQueueItem(item)) {
          await deferCalendarItem(item.id, { silent: true });
        } else if (isTodoQueueItem(item)) {
          await updateToDo(item.id, { completeByDate: nextDeferDate(item.date) });
        } else {
          await updateTransaction(item.id, { reviewSnoozedUntil: nextDeferDate(item.date) }, { silent: true });
        }
        deferred++;
      } catch (error) {
        console.error('[ActionQueue] Bulk defer failed for item:', item.id, error);
        failed++;
      }
    }
    setIsBulkRunning(false);
    if (deferred > 0) toast.success(`Deferred ${deferred} item${deferred === 1 ? '' : 's'}`);
    if (failed > 0) toast.error(`Failed to defer ${failed} item${failed === 1 ? '' : 's'}`);
    exitSelectionMode();
  }, [selectedItems, deferCalendarItem, updateToDo, updateTransaction, exitSelectionMode]);

  const handleBulkDelete = useCallback(() => {
    const items = selectedItems;
    showDeleteConfirmation(async () => {
      setIsBulkRunning(true);
      let deleted = 0;
      let failed = 0;
      for (const item of items) {
        try {
          if (isCalendarQueueItem(item)) await deleteCalendarItem(item.id, { silent: true });
          else if (isTodoQueueItem(item)) await deleteToDo(item.id);
          else await deleteTransaction(item.id, { silent: true });
          deleted++;
        } catch (error) {
          console.error('[ActionQueue] Bulk delete failed for item:', item.id, error);
          failed++;
        }
      }
      setIsBulkRunning(false);
      if (deleted > 0) toast.success(`Deleted ${deleted} item${deleted === 1 ? '' : 's'}`);
      if (failed > 0) toast.error(`Failed to delete ${failed} item${failed === 1 ? '' : 's'}`);
      exitSelectionMode();
    }, items.length === 1 ? 'item' : `${items.length} items`);
  }, [selectedItems, deleteCalendarItem, deleteToDo, deleteTransaction, exitSelectionMode]);

  // Selection mode always renders the FULL queue so bulk select/approve/defer
  // operates on everything the user expects — the cap must never silently hide
  // items during bulk operations.
  const visibleQueueItems =
    queueExpanded || selectionMode
      ? actionQueue
      : actionQueue.slice(0, MAX_VISIBLE_QUEUE_ITEMS);

  if (isLoading) {
    return <DashboardSkeleton />;
  }

  // Action Queue — triage of what needs attention. Swipe right to approve,
  // swipe left to defer, long-press (or "Select") for bulk approve/defer/
  // delete. Extracted once so it can render in either of two page positions
  // (top when it has items, its original spot when empty) without duplicating
  // the JSX.
  const actionQueueSection = (
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
      action={
        actionQueue.length > 0 ? (
          selectionMode ? (
            <button
              onClick={exitSelectionMode}
              className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 px-1 min-h-6"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => enterSelectionMode()}
              className="text-xs font-semibold text-accent-700 dark:text-accent-300 hover:underline px-1 min-h-6"
            >
              Select
            </button>
          )
        ) : undefined
      }
    >
      {actionQueue.length > 0 ? (
        <SurfaceList>
          {visibleQueueItems.map(item => (
            <ActionQueueItemCard
              key={item.id}
              item={item}
              isExpanded={expandedId === item.id}
              setExpandedId={setExpandedId}
              setPayModalItemId={setPayModalItemId}
              selectionMode={selectionMode}
              isSelected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelect}
              onEnterSelectionMode={enterSelectionMode}
              onSwipeApprove={handleSwipeApprove}
              onSwipeDefer={handleSwipeDefer}
              buckets={buckets}
              transactions={transactions}
              members={members}
              updateToDo={updateToDo}
              deleteToDo={deleteToDo}
              completeToDo={completeToDo}
              deferCalendarItem={deferCalendarItem}
              deleteCalendarItem={deleteCalendarItem}
            />
          ))}
          {!selectionMode && (
            <ShowMoreRow
              hiddenCount={actionQueue.length - MAX_VISIBLE_QUEUE_ITEMS}
              expanded={queueExpanded}
              onToggle={() => setQueueExpanded(v => !v)}
              noun="item"
            />
          )}
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
  );

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

        {/* Action Queue jumps to the top of the stack whenever it has items —
            it's the page's primary triage surface, so it shouldn't sit below
            the widgets when there's something to act on. When it's empty, it
            stays in its original spot below the widgets (see below) so the
            "All caught up" state doesn't dominate the top of the page. */}
        {actionQueue.length > 0 && actionQueueSection}

        {/* Credit card activity — charges vs. paydowns this period so balances
            don't balloon (money domain). Self-nulls without any credit cards. */}
        {isModuleEnabled('money') && <CreditCardActivityWidget onPayDown={handlePayDown} />}

        {/* The Pulse strip — money + habits balance, the app's thesis metric */}
        <PulseStripWidget />

        {/* Weekly recap (Plan 02) — fresh for a few days after the Sunday
            generation, dismissible; also hosts the recap detail drawer (which
            must stay mounted for the ?recap= push deep link even when the
            card itself is hidden). */}
        <WeeklyRecapCard />

        {/* Pending Voice Commands Banner — on the shared Section wrapper so it
            reads as the same idiom as every other widget, not a bespoke ad hoc
            container. */}
        {pendingItemsCount > 0 && (
          <Section className="animate-in fade-in slide-in-from-top-2 duration-(--duration-base)">
            <div className="surface-section p-4">
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
          </Section>
        )}

        {/* Empty-queue case: the "All caught up" section stays in its original
            position below the widgets rather than leading the page. */}
        {actionQueue.length === 0 && actionQueueSection}

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

      {/* Bulk approve: pick one account for everything, or smart-assign */}
      <AccountPicker
        isOpen={isBulkApprovePickerOpen}
        onClose={() => setIsBulkApprovePickerOpen(false)}
        title={`Approve ${selectedItems.length} item${selectedItems.length === 1 ? '' : 's'}`}
        description="Pick one account for all selected items, or let each use its usual one."
        topAction={{
          label: 'Smart assign (recommended)',
          description: 'Checking, or the account you used last time',
          onSelect: () => void runBulkApprove(),
        }}
        onSelect={(accountId) => void runBulkApprove(accountId)}
      />

      {/* Bulk action bar — replaces the bottom nav while selecting (Gmail-style) */}
      {selectionMode && (
        <div className="fixed bottom-0 inset-x-0 z-banner bg-white dark:bg-brand-800 border-t border-brand-200 dark:border-brand-700 shadow-nav pb-safe">
          <div className="px-4 py-3 space-y-2 max-w-lg mx-auto">
            <div className="flex items-center justify-between text-xs font-semibold text-brand-500 dark:text-brand-400">
              <span aria-live="polite">
                {selectedItems.length} selected
              </span>
              <button
                onClick={toggleSelectAll}
                className="text-accent-700 dark:text-accent-300 hover:underline min-h-6 px-1"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex items-stretch gap-2">
              <Button
                variant="success"
                className="flex-1"
                disabled={selectedItems.length === 0 || isBulkRunning}
                onClick={handleBulkApprove}
                leftIcon={<Check size={16} />}
              >
                Approve
              </Button>
              <Button
                variant="warning"
                className="flex-1"
                disabled={selectedItems.length === 0 || isBulkRunning}
                onClick={() => void handleBulkDefer()}
                leftIcon={<Clock size={16} />}
              >
                Defer
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={selectedItems.length === 0 || isBulkRunning}
                onClick={handleBulkDelete}
                leftIcon={<Trash2 size={16} />}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                onClick={exitSelectionMode}
                aria-label="Exit selection mode"
                className="px-3"
              >
                <X size={16} />
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
