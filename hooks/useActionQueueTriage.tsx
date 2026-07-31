import { useState, useCallback, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { useFinance, useTodos, useHouseholdCore, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { Check } from 'lucide-react';
import { toastIcon } from '@/components/ui/toastIcon';
import {
  useActionQueue,
  isCalendarQueueItem,
  isTodoQueueItem,
  isTransactionQueueItem,
  type ActionQueueItem,
} from '@/hooks/useActionQueue';
import {
  suggestAccountForCalendarItem,
  suggestAccountIdForTransaction,
  suggestCategoryForTransaction,
  nextDeferDate,
} from '@/utils/actionQueueSmart';
import {
  approveTargetAccountForTransaction,
  approveDetailLabel,
  calendarApproveDetail,
  approvedToastMessage,
} from '@/utils/approveDisclosure';
import { resolveTargetAccount } from '@/utils/accountImpact';
import {
  keywordMatchedHabitIds,
  selectHabitsToFire,
  suppressAlreadyLoggedHabitIds,
} from '@/utils/transactionHabitFiring';
import { isTodoSubtasksIncompleteError } from '@/utils/todoSubtaskGate';
import { UndoToast } from '@/components/ui/UndoToast';
import { CREDIT_CARD_CATEGORY } from '@/types/schema';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';

export interface UseActionQueueTriageOptions {
  /**
   * Take over the pay sheet instead of the hook's own `payModal` state — for a
   * second consumer that already renders its own `AccountPicker` and would
   * otherwise mount a duplicate one.
   */
  onOpenPaySheet?: (id: string, amount: number) => void;
}

/**
 * The Action Queue's PER-ROW triage: the queue itself, the row expansion +
 * pay-sheet state, the pre-commit approve disclosure, and the two swipe
 * handlers — everything an `ActionQueueItemCard` needs that isn't bulk
 * selection. Extracted from `pages/Dashboard.tsx` unchanged so a second surface
 * can render the same rows with the same behaviour.
 */
export const useActionQueueTriage = (options?: UseActionQueueTriageOptions) => {
  // Consume the narrowest context slices so a change in one domain (e.g. a
  // shopping toggle) doesn't re-render every triage consumer.
  const { members } = useHouseholdCore();
  const {
    accounts,
    buckets,
    transactions,
    payCalendarItem,
    deferCalendarItem,
    deleteCalendarItem,
    updateTransactionCategory,
    reverseTransactionApproval,
    updateTransaction,
    deleteTransaction,
  } = useFinance();
  const { updateToDo, deleteToDo, completeToDo } = useTodos();
  // F-MONEY-14: the swipe-approve path must fire the same habits the review card
  // showed, so keyword matching sees the friendly name as well as the descriptor.
  const { rules: merchantRules } = useMerchantRules();
  const { habits } = useGamification();
  const fmt = useFormatCurrency();

  // --- ACTION QUEUE LOGIC ---
  const { actionQueue } = useActionQueue();

  // State for expansions/modals
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The pay sheet's target: the calendar item id plus the amount to pay —
  // already edited in the queue's review drawer, or the budgeted amount when
  // arriving via a path with no edit step (swipe fallback).
  const [payModal, setPayModal] = useState<{ id: string; amount: number } | null>(null);
  const onOpenPaySheet = options?.onOpenPaySheet;
  const openPaySheet = useCallback((id: string, amount: number) => {
    // A consumer that owns its own AccountPicker takes the sheet over entirely;
    // otherwise the hook's own `payModal` state drives it.
    if (onOpenPaySheet) {
      onOpenPaySheet(id, amount);
      return;
    }
    setPayModal({ id, amount });
  }, [onOpenPaySheet]);

  // Pre-commit reassurance for the swipe rail (error prevention): what an
  // instant approve WILL commit — amount + smart-guessed account — mirroring
  // handleSwipeApprove's resolution exactly, so the rail never promises a
  // different account than the mutation targets. To-dos have no money detail.
  const approveDetails = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of actionQueue) {
      if (isTransactionQueueItem(item)) {
        // A $0 stub deflects into the review drawer instead of committing, so
        // a money disclosure would over-promise there.
        if (item.needsAmount) continue;
        const account = approveTargetAccountForTransaction(item, accounts, transactions);
        map.set(item.id, approveDetailLabel(fmt(item.amount), account?.name));
      } else if (isCalendarQueueItem(item)) {
        map.set(item.id, calendarApproveDetail(item, accounts, transactions, fmt(item.amount)));
      }
    }
    return map;
  }, [actionQueue, accounts, transactions, fmt]);

  // Swipe right — instant approve with smart defaults. The card already
  // deflects transactions that can't be instant-approved ($0 stubs, no
  // resolvable category) into the review panel, so every item arriving here
  // can be committed directly.
  const handleSwipeApprove = useCallback(async (item: ActionQueueItem) => {
    try {
      if (isTodoQueueItem(item)) {
        await completeToDo(item.id);
        toast.success('To-Do completed!');
        return;
      }
      if (isCalendarQueueItem(item)) {
        const account = suggestAccountForCalendarItem(item, accounts, transactions);
        if (!account) {
          // No payable account to guess — fall back to the explicit pay sheet.
          openPaySheet(item.id, item.amount);
          return;
        }
        await payCalendarItem(item.id, account.id, { silent: true });
        // Cause-carrying confirmation: name the amount AND the account the
        // smart default picked, so a wrong guess is noticed immediately.
        toast.success(
          item.type === 'expense'
            ? `Paid ${fmt(item.amount)} from ${account.name}`
            : `Received ${fmt(item.amount)} into ${account.name}`
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
      // Resolve the account the balance impact WILL land on (same rule the
      // mutation applies) BEFORE committing, so the toast can name it.
      const targetAccount = resolveTargetAccount(accountId ?? item.accountId, accounts);
      // Snapshot the pre-approve state for undo — the mutation re-tags the
      // account and rewrites the category.
      const prior = { category: item.category, accountId: item.accountId, relatedHabitIds: item.relatedHabitIds ?? [] };
      // Habit Automations (PRD #1065): a swipe-approve accepts ALL pre-checked
      // chips — the transaction's explicit habit tags UNIONed with every habit
      // whose keywords match this merchant/notes. Dedup against what this row
      // already fired so an undo→re-approve can't double-log.
      // A swipe has no UI moment to offer an override, so the cross-source dedup
      // applies as the effective default: a keyword match whose habit was already
      // logged for this transaction's date is dropped rather than double-counted
      // (you tapped it by hand; the overnight sync's charge is the same event).
      // Reviewing the row in the drawer is how you force a second log.
      // Explicit prior tags are NOT suppressed — those were asked for by hand.
      const requestedHabitIds = Array.from(new Set([
        ...(item.relatedHabitIds ?? []),
        ...suppressAlreadyLoggedHabitIds(habits, keywordMatchedHabitIds(habits, item, merchantRules), item.date),
      ]));
      const { toFire: firedHabitIds } = selectHabitsToFire(requestedHabitIds, item.firedHabitIds ?? []);
      await updateTransactionCategory(item.id, category, requestedHabitIds, accountId);
      const baseMessage = approvedToastMessage(fmt(item.amount), targetAccount?.name);
      const firedTitles = firedHabitIds
        .map(id => habits.find(h => h.id === id)?.title)
        .filter((t): t is string => !!t);
      // Name what was logged so the undo is cause-carrying (story 19).
      const message = firedTitles.length > 0
        ? `${baseMessage} · logged ${firedTitles.join(', ')}`
        : baseMessage;
      // Cause-carrying undo. When habits fired, use the atomic
      // reverseTransactionApproval (reverses the fires + points + balance in one
      // batch); otherwise the plain updateTransaction status flip suffices.
      toast(
        (t) => (
          <UndoToast
            message={message}
            onUndo={() => {
              toast.dismiss(t.id);
              void (async () => {
                try {
                  if (firedHabitIds.length > 0) {
                    await reverseTransactionApproval(item.id, prior, firedHabitIds);
                  } else {
                    await updateTransaction(
                      item.id,
                      // An empty accountId explicitly clears a tag the smart
                      // approve added (updateTransaction deletes the field).
                      { status: 'pending_review', category: prior.category, accountId: prior.accountId ?? '' },
                      { silent: true }
                    );
                  }
                  toast.success('Moved back to review');
                } catch (error) {
                  console.error('[ActionQueue] Undo approve failed:', error);
                  toast.error('Couldn’t undo — find it in Money → Transactions.');
                }
              })();
            }}
          />
        ),
        { duration: 6000, icon: toastIcon(Check) }
      );
    } catch (error) {
      // A habit-linked to-do with unfinished subtasks is REFUSED by the mutation
      // (PRD #1065), not a failure — surface the remaining step count instead.
      if (isTodoSubtasksIncompleteError(error)) {
        toast(`${error.stepsLeft} step${error.stepsLeft === 1 ? '' : 's'} left on “${error.title}”`);
        return;
      }
      console.error('[ActionQueue] Swipe approve failed:', error);
      toast.error('Failed to approve. Please try again.');
    }
  }, [accounts, buckets, transactions, habits, merchantRules, completeToDo, payCalendarItem, updateTransactionCategory, reverseTransactionApproval, updateTransaction, openPaySheet, fmt]);

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

  // The `ActionQueueItemCard` props that are pure context pass-through (no
  // swipe/selection/expansion state). Bundled so a consumer spreads one object
  // instead of re-plumbing nine context reads; spreading preserves each prop's
  // identity, so the card's memo comparator behaves exactly as before.
  const cardProps = useMemo(
    () => ({
      buckets,
      transactions,
      members,
      updateToDo,
      deleteToDo,
      completeToDo,
      deferCalendarItem,
      deleteCalendarItem,
      deleteTransaction,
    }),
    [
      buckets,
      transactions,
      members,
      updateToDo,
      deleteToDo,
      completeToDo,
      deferCalendarItem,
      deleteCalendarItem,
      deleteTransaction,
    ]
  );

  return {
    actionQueue,
    expandedId,
    setExpandedId,
    payModal,
    setPayModal,
    openPaySheet,
    approveDetails,
    handleSwipeApprove,
    handleSwipeDefer,
    cardProps,
  };
};
