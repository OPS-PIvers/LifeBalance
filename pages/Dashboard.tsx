import React, { useState, useCallback, useMemo, useRef, useEffect, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useFinance, useTodos, useHouseholdCore, useGamification, useShopping } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { AccountPicker } from '@/components/budget/AccountPicker';
import { TrendingUp, Check, Clock, Eye, Trash2, X, ListChecks, CheckCircle2 } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import { sectionHeadingClasses } from '@/components/ui/SectionHeading';
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
// Lazy (+ LazyMount-gated mount) so the Drawer/framer-motion stay out of the
// boot bundle — this drawer only mounts once the aggregate ReviewQueueCard
// (below) is actually tapped. Mirrors MainLayout's on-open-review-drawer
// wiring, but scoped to shopping+todo held captures only (no transactions —
// those keep their existing individual Action Queue cards).
const ReviewPendingDrawer = React.lazy(() => import('@/components/modals/ReviewPendingDrawer'));
import { LazyMount } from '@/components/ui/LazyMount';
import { buildReviewQueueSnapshot, type ReviewQueueItem } from '@/utils/reviewQueue';
import { ReviewQueueCard } from '@/components/dashboard/ReviewQueueCard';
import {
  isCalendarQueueItem,
  isTodoQueueItem,
  isTransactionQueueItem,
} from '@/hooks/useActionQueue';
import { useActionQueueTriage } from '@/hooks/useActionQueueTriage';
import { ActionQueueItemCard } from '@/components/dashboard/ActionQueueItem';
import {
  suggestAccountForCalendarItem,
  suggestAccountIdForTransaction,
  suggestCategoryForTransaction,
  nextDeferDate,
} from '@/utils/actionQueueSmart';
import { isTodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { requestDeleteConfirmation } from '@/components/ui/confirmDialogStore';
import {
  captureDeferUndo,
  findRecurringDeferArtifacts,
  type DeferUndoDescriptor,
} from '@/utils/bulkDeferUndo';
import { UndoToast } from '@/components/ui/UndoToast';
import { getLocalDateString } from '@/utils/dateHelpers';
import { Button } from '@/components/ui/Button';
import { InsightWidget } from '@/components/dashboard/InsightWidget';
import { DailyHabitsWidget } from '@/components/dashboard/DailyHabitsWidget';
import { ScoreboardWidget } from '@/components/dashboard/ScoreboardWidget';
import { HabitCoachWidget } from '@/components/dashboard/HabitCoachWidget';
import { KidsChoresWidget } from '@/components/dashboard/KidsChoresWidget';
import { ActivityFeedWidget } from '@/components/dashboard/ActivityFeedWidget';
import { PulseStripWidget } from '@/components/dashboard/PulseStripWidget';
import { PartnerActivityWidget } from '@/components/dashboard/PartnerActivityWidget';
import { RecapSlot } from '@/components/dashboard/RecapSlot';
import { SetupChecklistCard } from '@/components/dashboard/SetupChecklistCard';
import { VisibilityDiscoveryCard } from '@/components/dashboard/VisibilityDiscoveryCard';
import { PointRebalanceCard } from '@/components/dashboard/PointRebalanceCard';
import { CreateChallengePayload } from '@/types/schema';
import { DashboardSkeleton } from '@/components/dashboard/DashboardSkeleton';
import { CreditCardActivityWidget } from '@/components/dashboard/CreditCardActivityWidget';
import { Section, SurfaceList, Stat, StatGroup } from '@/components/ui/Section';
import { ShowMoreRow } from '@/components/ui/ShowMoreRow';
import PageHeader from '@/components/ui/PageHeader';
import { getVisibleOrderedWidgetIds } from '@/utils/dashboardLayout';
import { resolveHiddenKeys } from '@/utils/moduleVisibility';
import { getDayCompleteStatus } from '@/utils/dayComplete';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

// Cap the Action Queue like the sibling widgets (which cap at 5; the queue gets
// one extra row since it's the page's primary triage surface). useActionQueue
// pre-sorts by priority, so slicing keeps the most urgent items visible.
const MAX_VISIBLE_QUEUE_ITEMS = 6;

const Dashboard: React.FC = () => {
  // Consume the narrowest context slices so a change in one domain (e.g. a
  // shopping toggle) doesn't re-render the whole Dashboard.
  const { isLoading, currentUser, pendingItemsCount } = useHouseholdCore();
  const {
    accounts,
    buckets,
    transactions,
    calendarItems,
    safeToSpendBreakdown,
    payCalendarItem,
    deferCalendarItem,
    updateCalendarItem,
    deleteCalendarItem,
    updateTransactionCategory,
    updateTransaction,
    deleteTransaction,
  } = useFinance();
  const { updateToDo, deleteToDo, completeToDo, todosAwaitingReview } = useTodos();
  const { shoppingAwaitingReview } = useShopping();
  const { isModuleEnabled, isPlanTabVisible } = useModuleVisibility();
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
  // Per-row triage (the queue, row expansion, the pay sheet, the pre-commit
  // approve disclosure and both swipe handlers) lives in the shared hook; the
  // bulk-selection machinery below stays here.
  const triage = useActionQueueTriage();
  const { actionQueue } = triage;

  // --- Aggregate review queue (Layer 4) ---
  // Held-for-review shopping + to-do captures ONLY (todos → shopping order,
  // matching MainLayout's on-open cycler, via the shared buildReviewQueueSnapshot
  // helper — an empty transactions input yields exactly that ordering) —
  // transactions are deliberately excluded here since they keep their existing
  // individual Action Queue cards; surfacing them again in this card would
  // double-count them. Also gated on module visibility (Plan 090) — a
  // household that hid the To-Dos or Shopping tab must not get a review card
  // surfacing items whose destination page is hidden.
  const reviewQueueItems = useMemo<ReviewQueueItem[]>(
    () =>
      buildReviewQueueSnapshot({
        pendingReviewTransactions: [],
        todosAwaitingReview: isPlanTabVisible('todos') ? todosAwaitingReview : [],
        shoppingAwaitingReview: isPlanTabVisible('shopping') ? shoppingAwaitingReview : [],
        householdSettings: undefined,
      }),
    [todosAwaitingReview, shoppingAwaitingReview, isPlanTabVisible]
  );
  const [reviewDrawerOpen, setReviewDrawerOpen] = useState(false);
  // Snapshot taken on open (not the live lists) so approvals shrinking the
  // underlying lists mid-cycle don't reshuffle the drawer's indices — mirrors
  // MainLayout's reviewSnapshot.
  const [reviewSnapshot, setReviewSnapshot] = useState<ReviewQueueItem[]>([]);
  const openReviewQueue = useCallback(() => {
    setReviewSnapshot(reviewQueueItems);
    setReviewDrawerOpen(true);
  }, [reviewQueueItems]);

  // Data for the empty-queue "today at a glance" hero (impeccable r6): today's
  // due-habit progress (same "positive daily you can finish today" definition
  // as the day-complete celebration) and the Safe-to-Spend figure the toolbar
  // shows — no new derivations, just the two numbers that answer "how is today
  // going?" when there's nothing to triage.
  //
  // COST: this subscribes Dashboard to the full gamification slice (there is
  // no narrower `habits`-only hook today), so every habit toggle re-renders
  // Dashboard even while the queue hero is showing and `glanceHero` is never
  // mounted. Acceptable for now; if Dashboard re-render cost becomes a pain
  // point, add `habits` to a narrower slice and consume that instead.
  const { habits } = useGamification();
  const fmt = useFormatCurrency();
  const habitsToday = useMemo(() => getDayCompleteStatus(habits), [habits]);
  const safeToSpend = safeToSpendBreakdown?.safeToSpend ?? 0;

  // F-XCUT-02: per-member Dashboard widget order/visibility. The Action
  // Queue and voice-command banner stay structural (fixed position); only
  // the widgets below are reorderable/hideable — see utils/dashboardLayout.ts.
  // 2F.1 folded widget visibility into the member's unified `hiddenKeys` list;
  // `resolveHiddenKeys` still falls back to the legacy `dashboardHidden` and
  // then to the lean defaults, so an existing member's Home is unchanged.
  const dashboardLayout = currentUser?.dashboardLayout;
  const memberHiddenKeys = currentUser?.hiddenKeys;
  const legacyDashboardHidden = currentUser?.dashboardHidden;
  const widgetOrder = useMemo(
    () =>
      getVisibleOrderedWidgetIds(
        dashboardLayout,
        resolveHiddenKeys({ hiddenKeys: memberHiddenKeys, dashboardHidden: legacyDashboardHidden })
      ),
    [dashboardLayout, memberHiddenKeys, legacyDashboardHidden]
  );

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

  const setExpandedId = triage.setExpandedId;
  const enterSelectionMode = useCallback((id?: string) => {
    setExpandedId(null);
    setSelectionMode(true);
    setSelectedIds(id ? new Set([id]) : new Set());
  }, [setExpandedId]);

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

  // Bulk approve. `accountOverrideId` (from the picker) pays/tags every money
  // item from that account; undefined = smart per-item assignment. Items that
  // can't be auto-approved ($0 stubs, unresolvable category/account) are
  // skipped and stay in the queue.
  const runBulkApprove = useCallback(async (accountOverrideId?: string) => {
    setIsBulkApprovePickerOpen(false);
    setIsBulkRunning(true);
    let approved = 0;
    let approvedMoney = 0;
    let skipped = 0;
    let gated = 0; // habit-linked to-dos with unfinished subtasks (PRD #1065)
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
          approvedMoney++;
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
          approvedMoney++;
        }
      } catch (error) {
        // Subtask-gated to-do (PRD #1065): skip and report separately, not as a
        // generic failure.
        if (isTodoSubtasksIncompleteError(error)) {
          gated++;
          continue;
        }
        console.error('[ActionQueue] Bulk approve failed for item:', item.id, error);
        skipped++;
      }
    }
    setIsBulkRunning(false);
    if (approved > 0) {
      if (approvedMoney > 0) {
        // Full undo of bulk approvals is deliberately NOT offered — reversing
        // balance deltas across N documents is riskier than a recovery deep
        // link. Instead, "Review" jumps to Money → Transactions where each
        // just-verified row can be inspected/edited individually.
        toast(
          (t) => (
            <UndoToast
              message={`Approved ${approved} item${approved === 1 ? '' : 's'}`}
              actionLabel="Review"
              onUndo={() => {
                toast.dismiss(t.id);
                navigate('/budget', { state: { tab: 'transactions' } });
              }}
            />
          ),
          { duration: 6000, icon: toastIcon(Check) }
        );
      } else {
        toast.success(`Approved ${approved} item${approved === 1 ? '' : 's'}`);
      }
    }
    if (skipped > 0) toast(`${skipped} left in the queue (needs an amount, category, or account)`, { icon: toastIcon(Eye) });
    if (gated > 0) toast(`${gated} to-do${gated === 1 ? '' : 's'} still ${gated === 1 ? 'has' : 'have'} steps left`, { icon: toastIcon(Eye) });
    exitSelectionMode();
  }, [selectedItems, accounts, buckets, transactions, completeToDo, payCalendarItem, updateTransactionCategory, exitSelectionMode, navigate]);

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

  // Undoing a bulk defer restores each item's captured prior state by looping
  // the existing single-item mutations in reverse (utils/bulkDeferUndo.ts has
  // the per-kind contract). Recurring-instance defers created new docs whose
  // ids only the Firestore listener knows, so the restore reads the LATEST
  // calendarItems through a ref — the toast closure would otherwise be frozen
  // on the pre-defer snapshot.
  const calendarItemsRef = useRef(calendarItems);
  useEffect(() => {
    calendarItemsRef.current = calendarItems;
  }, [calendarItems]);

  const undoBulkDefer = useCallback(
    async (undos: readonly DeferUndoDescriptor[], preExistingCalendarIds: ReadonlySet<string>) => {
      let restored = 0;
      let failed = 0;
      for (const undo of undos) {
        try {
          if (undo.kind === 'todo') {
            await updateToDo(undo.id, { completeByDate: undo.previousDate });
          } else if (undo.kind === 'transaction') {
            // A prior snooze of `undefined` is restored as "today" — lexically
            // NOT greater than today, so isReviewSnoozed treats it exactly like
            // no snooze and the row re-enters the queue (updateTransaction's
            // Partial<Transaction> can't express a field delete).
            await updateTransaction(
              undo.id,
              { reviewSnoozedUntil: undo.previousSnooze ?? getLocalDateString() },
              { silent: true }
            );
          } else if (undo.kind === 'calendar-single') {
            await updateCalendarItem(undo.item, { silent: true });
          } else {
            const artifacts = findRecurringDeferArtifacts(
              calendarItemsRef.current,
              preExistingCalendarIds,
              undo
            );
            if (!artifacts) {
              // Can't identify the created docs unambiguously — skip rather
              // than risk deleting the wrong one.
              failed++;
              continue;
            }
            // Tombstone first: if the second delete fails mid-undo, the user
            // is left with an extra visible copy at the deferred date
            // (recoverable in the UI) rather than a tombstone silently hiding
            // the original occurrence with its copy already gone.
            await deleteCalendarItem(artifacts.tombstoneId, { silent: true });
            await deleteCalendarItem(artifacts.deferredCopyId, { silent: true });
          }
          restored++;
        } catch (error) {
          console.error('[ActionQueue] Undo defer failed:', undo, error);
          failed++;
        }
      }
      if (restored > 0) toast.success(`Restored ${restored} item${restored === 1 ? '' : 's'}`);
      if (failed > 0) toast.error(`Couldn't restore ${failed} item${failed === 1 ? '' : 's'}`);
    },
    [updateToDo, updateTransaction, updateCalendarItem, deleteCalendarItem]
  );

  const handleBulkDefer = useCallback(async () => {
    setIsBulkRunning(true);
    // Snapshot BEFORE mutating: per-item prior state (for the reverse loop)
    // and the set of calendar doc ids that already existed (so undo can pick
    // out the docs a recurring-instance defer created).
    const preExistingCalendarIds: ReadonlySet<string> = new Set(calendarItems.map(i => i.id));
    const undos: DeferUndoDescriptor[] = [];
    let deferred = 0;
    let failed = 0;
    for (const item of selectedItems) {
      try {
        const undo = captureDeferUndo(item);
        if (isCalendarQueueItem(item)) {
          await deferCalendarItem(item.id, { silent: true });
        } else if (isTodoQueueItem(item)) {
          await updateToDo(item.id, { completeByDate: nextDeferDate(item.date) });
        } else {
          await updateTransaction(item.id, { reviewSnoozedUntil: nextDeferDate(item.date) }, { silent: true });
        }
        undos.push(undo);
        deferred++;
      } catch (error) {
        console.error('[ActionQueue] Bulk defer failed for item:', item.id, error);
        failed++;
      }
    }
    setIsBulkRunning(false);
    if (deferred > 0) {
      toast(
        (t) => (
          <UndoToast
            message={`Deferred ${deferred} item${deferred === 1 ? '' : 's'}`}
            onUndo={() => {
              toast.dismiss(t.id);
              void undoBulkDefer(undos, preExistingCalendarIds);
            }}
          />
        ),
        { duration: 6000, icon: toastIcon(Clock) }
      );
    }
    if (failed > 0) toast.error(`Failed to defer ${failed} item${failed === 1 ? '' : 's'}`);
    exitSelectionMode();
  }, [selectedItems, calendarItems, deferCalendarItem, updateToDo, updateTransaction, undoBulkDefer, exitSelectionMode]);

  const handleBulkDelete = useCallback(() => {
    const items = selectedItems;
    // Bulk delete spans transactions, calendar items and to-dos at once, so no
    // single noun fits the standard "Delete this {itemName}?" question — and
    // the count read as "Delete this 3 items?". Ask it by count instead; the
    // noun still names the thing in the host's failure toast.
    requestDeleteConfirmation({
      itemName: items.length === 1 ? 'item' : 'items',
      title: items.length === 1 ? 'Delete this item?' : `Delete ${items.length} items?`,
      onConfirm: async () => {
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
      },
    });
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

  // --- TIER 1: the page's single focal point (impeccable r6) ---
  // The hero slot always leads the page: the Action Queue when there's
  // something to act on, otherwise a "today at a glance" moment. Both faces
  // now render in the SAME section register as every other dashboard header
  // (icon + `sectionHeadingClasses`, matching CreditCardActivityWidget) — they
  // are one slot showing two states, so they must not sit at two different
  // type scales. They previously used a larger editorial `text-lg` heading;
  // what still marks this as tier 1 is its position and the bare canvas (no
  // card), not a bigger font.

  const queueHero = (
    <section aria-labelledby="action-queue-heading">
      <div className="flex items-end justify-between px-1 mb-2">
        <div className="min-w-0">
          {/* Matches the CreditCardActivityWidget/Section header spec exactly
              (same sectionHeadingClasses, same inline icon-in-heading shape).
              The `Section` primitive itself still can't render this: it always
              owns its own `<h2>`, which can't carry the `action-queue-heading`
              id the outer `aria-labelledby` depends on. Reusing the shared
              class constant keeps this in sync with `Section`/`SectionHeading`
              without forking the spec. The old pulsing dot is dropped — it was
              a second "needs attention" signal competing with the icon, and
              the reference has no dot. */}
          {/* The COUNT is the heading (owner call): every other header on this
              page NAMES its content — "Credit card activity", "Scoreboard",
              "This week (so far)" — whereas "Needs you" was a mood, which
              pushed the only informative line down into a subtitle. This also
              keeps the "Action Queue" product term visible, which toast and
              capture copy both refer to ("Check your Action Queue"). One line,
              like the reference, so nothing competes with it underneath. */}
          <h2 id="action-queue-heading" className={`${sectionHeadingClasses} flex items-center gap-2`}>
            <ListChecks size={14} className="text-warm-600 dark:text-warm-300" aria-hidden="true" />
            {actionQueue.length} item{actionQueue.length === 1 ? '' : 's'} in your Action Queue
          </h2>
        </div>
        {selectionMode ? (
          <button
            onClick={exitSelectionMode}
            className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200 px-2 -mx-1 min-h-11 -my-3"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={() => enterSelectionMode()}
            className="text-xs font-semibold text-accent-700 dark:text-accent-300 hover:underline px-2 -mx-1 min-h-11 -my-3"
          >
            Select
          </button>
        )}
      </div>
      <SurfaceList>
        {visibleQueueItems.map(item => (
          <ActionQueueItemCard
            key={item.id}
            item={item}
            isExpanded={triage.expandedId === item.id}
            setExpandedId={triage.setExpandedId}
            openPaySheet={triage.openPaySheet}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(item.id)}
            onToggleSelect={toggleSelect}
            onEnterSelectionMode={enterSelectionMode}
            onSwipeApprove={triage.handleSwipeApprove}
            onSwipeDefer={triage.handleSwipeDefer}
            approveDetail={triage.approveDetails.get(item.id)}
            {...triage.cardProps}
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
    </section>
  );

  // Empty-queue hero: the "all caught up" identity moves up here (the old
  // bottom-of-page EmptyState card is gone — it duplicated this message) with
  // the two figures that answer "how is today going?": due-habit progress and
  // Safe to Spend. Each figure hides with its module; with both off the hero
  // is just the reassurance line.
  const glanceHero = (
    <section aria-labelledby="today-glance-heading" className="px-1">
      <h2 id="today-glance-heading" className={`${sectionHeadingClasses} flex items-center gap-2`}>
        <CheckCircle2 size={14} className="text-money-pos dark:text-money-posDark" aria-hidden="true" />
        All caught up
      </h2>
      {(isModuleEnabled('habits') && habitsToday.total > 0) || isModuleEnabled('money') ? (
        // StatGroup is the house wrapper for Stat rows; justify-start + the
        // wider gap keep the hero's left-set editorial alignment (the default
        // justify-between would spread two figures to opposite edges).
        <StatGroup className="mt-4 justify-start gap-x-10">
          {isModuleEnabled('habits') && habitsToday.total > 0 && (
            <Stat
              label={habitsToday.done === habitsToday.total ? 'habits — day complete' : 'habits done today'}
              value={`${habitsToday.done}/${habitsToday.total}`}
              valueClassName="text-2xl text-habit-blue"
            />
          )}
          {isModuleEnabled('money') && (
            <Stat
              label="safe to spend"
              value={fmt(safeToSpend)}
              valueClassName={`text-2xl ${
                safeToSpend > -0.005
                  ? 'text-money-pos dark:text-money-posDark'
                  : 'text-money-neg dark:text-money-negDark'
              }`}
            />
          )}
        </StatGroup>
      ) : null}
    </section>
  );

  return (
    <div className="bg-brand-50 dark:bg-brand-900 pb-nav-safe">

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
              type="button"
              onClick={() => navigate('/budget', { state: { tab: 'trends' } })}
              className="shrink-0 p-2.5 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-card text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 hover:border-brand-300 dark:hover:border-brand-600 active:scale-[0.98] transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-900"
              aria-label="View trends"
            >
              <TrendingUp size={22} />
            </button>
          )
        }
      />

      <div className="px-4">

        {/* Aggregate "N items to review" card (Layer 4) — leads the Action
            Queue area, independent of whether the queue itself is empty, so
            held Quick-Add captures stay discoverable even on an otherwise
            "all caught up" day. */}
        <ReviewQueueCard count={reviewQueueItems.length} onOpen={openReviewQueue} />

        {/* TIER 1 — the hero slot: the queue when it has items, the "today at
            a glance" moment when it doesn't. Always the page's focal point. */}
        {actionQueue.length > 0 ? queueHero : glanceHero}

        {/* TIER 2 — the demoted widget stack: tighter rhythm than the air
            around the hero, so it reads as one denser supporting list rather
            than five peer surfaces competing with the hero for weight. */}
        <div className="mt-8 space-y-4">

        {/* F-XCUT-02: the widgets below render in each member's customized
            order (Settings → Dashboard widgets), defaulting to this order.
            Module-gating (habits/money) still applies on top of the
            member's own hide list. */}
        {widgetOrder.map(id => {
          switch (id) {
            case 'pulseStrip':
              // The Pulse strip — "This week" at a glance (money + habits
              // balance, the app's thesis metric).
              return <PulseStripWidget key={id} />;
            case 'partnerActivity':
              // "Since you were here" — a warm, dismissible digest of what
              // OTHER housemates added since this device's last visit (money
              // domain; self-nulls when empty/first-visit or money is off).
              return <PartnerActivityWidget key={id} />;
            case 'dailyHabits':
              // Today's Habits — smart-ranked compact tracker (habits
              // domain — Plan 090).
              return isModuleEnabled('habits') ? <DailyHabitsWidget key={id} /> : null;
            case 'scoreboard':
              // Household points scoreboard (per-member points, PR 4/6) —
              // habits domain (points come from habit completions), so it
              // shares dailyHabits' gate.
              return isModuleEnabled('habits') ? <ScoreboardWidget key={id} /> : null;
            case 'creditCardActivity':
              // Credit card activity — charges vs. paydowns this period so
              // balances don't balloon (money domain). Self-nulls without
              // any credit cards.
              return isModuleEnabled('money')
                ? <CreditCardActivityWidget key={id} onPayDown={handlePayDown} />
                : null;
            case 'weeklyRecap':
            case 'moneyRecap': {
              // The weekly recap (Plan 02) and monthly money recap
              // (F-MONEY-06) share ONE Dashboard slot (see RecapSlot) — when
              // both are fresh, only the newer one renders a card, but both
              // detail drawers stay mounted for their push deep links. The
              // slot renders at the position of whichever recap id comes
              // first in the member's order; the other id contributes its
              // enablement and renders nothing of its own.
              const firstRecapId = widgetOrder.find(
                w => w === 'weeklyRecap' || w === 'moneyRecap'
              );
              if (id !== firstRecapId) return null;
              return (
                <RecapSlot
                  key="recapSlot"
                  weekly={widgetOrder.includes('weeklyRecap')}
                  money={widgetOrder.includes('moneyRecap')}
                />
              );
            }
            case 'kidsChores':
              // Kids' Chores (parent overview) — self-nulls unless Kid Mode
              // is on and a managed kid has a chore.
              return <KidsChoresWidget key={id} />;
            case 'insight':
              // One AI Insight
              return (
                <InsightWidget
                  key={id}
                  onOpenArchive={handleOpenArchive}
                  onCreateChallenge={handleCreateChallenge}
                />
              );
            case 'activityFeed':
              // Compact Recent Activity
              return <ActivityFeedWidget key={id} />;
            case 'habitCoach':
              // Habit Coach (F-DASH-03) — AI coaching on habit patterns
              // (habits domain). Customizable (default-hidden) since the
              // lean-triage defaults landed.
              return isModuleEnabled('habits') ? <HabitCoachWidget key={id} /> : null;
            default:
              return null;
          }
        })}

        {/* Setup checklist (F-PLAT-03) — nudges a few high-value setup actions
            the onboarding wizard doesn't cover; self-clears once every item is
            done, dismissed, or ~2 weeks old. Leads the widget stack so new
            households see it before it's buried. Not part of the F-XCUT-02
            customizable widgetOrder (it's a self-clearing onboarding nudge,
            not a persistent widget a member would want to reorder/hide). */}
        <SetupChecklistCard />

        {/* One-time "What I see" discovery nudge (2F.3) — points a member at
            the per-member visibility editor they'd otherwise never find.
            Dismissible, never reappears (see utils/visibilityDiscovery.ts).
            Placed right after the setup checklist so it doesn't compete with
            it for the same "first things to notice" slot. */}
        <VisibilityDiscoveryCard />

        {/* Point-rebalance nudge (F-DASH-08) — a dismissible, cadence-gated
            suggestion to raise/lower one habit's basePoints, computed
            deterministically from completion frequency by
            `utils/pointRebalance.ts` (no AI call; paper cut #8 replaced the
            Gemini helper, which had no sense of scale and read consistency
            backwards). Self-nulls when powerToolsEnabled is off or there's
            nothing to suggest. */}
        {isModuleEnabled('habits') && <PointRebalanceCard />}

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

        </div>

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

      {/* Aggregate review drawer (Layer 4) — lazy so Drawer/framer-motion stay
          out of the boot bundle; only mounts once the ReviewQueueCard above is
          tapped. Scoped to the held shopping/to-do snapshot only. */}
      <LazyMount when={reviewDrawerOpen}>
        <ReviewPendingDrawer
          items={reviewSnapshot}
          isOpen={reviewDrawerOpen}
          onClose={() => setReviewDrawerOpen(false)}
        />
      </LazyMount>

      {/* Pay sheet for calendar items — seeded with the amount already edited
          in the review drawer (still editable here for paths without an edit
          step, e.g. the swipe fallback). */}
      <AccountPicker
        isOpen={!!triage.payModal}
        onClose={() => triage.setPayModal(null)}
        editableAmount={triage.payModal?.amount}
        onSelect={(accountId, amount) => {
          if (triage.payModal) {
            payCalendarItem(
              triage.payModal.id,
              accountId,
              amount !== undefined ? { actualAmount: amount } : undefined
            );
          }
          triage.setPayModal(null);
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
