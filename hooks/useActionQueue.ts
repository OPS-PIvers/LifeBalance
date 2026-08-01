import { useMemo } from 'react';
import {
  endOfDay, isBefore, parseISO, isSameDay, subMonths, addMonths,
  isToday, isTomorrow, isValid
} from 'date-fns';
import { Transaction, CalendarItem, ToDo } from '@/types/schema';
import { useFinance, useTodos, useExpandedCalendarItems, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useMerchantRules } from '@/hooks/useMerchantRules';
import { useLocalToday } from '@/hooks/useLocalToday';
import { parseRecurringId } from '@/utils/calendarRecurrence';
import { needsReview } from '@/utils/reviewQueue';
import {
  pickBillToPay,
  type BillMatchSource,
  type BillPayCandidate,
} from '@/utils/billDescriptorMatch';

// ToDoActionQueueItem normalizes the ToDo interface for the action queue
// by replacing 'completeByDate' with 'date' to match Transaction and CalendarItem.
// Todos do not have a monetary amount; any amount-related logic should check
// the queueType and ignore items where queueType === 'todo'.
export type ToDoActionQueueItem = Omit<ToDo, 'completeByDate'> & {
  queueType: 'todo';
  date: string; // Maps from ToDo.completeByDate for consistent ActionQueueItem interface
};

/**
 * The unpaid bill a queued transaction was recognised as paying (see
 * `matchedBills` below). Present ONLY when the shared matcher
 * (`utils/billDescriptorMatch.ts`) linked the two, in which case the bill's own
 * row is suppressed and this transaction row stands for the pair.
 */
export interface MatchedBillRef {
  /** Calendar item id — the synthetic instance id for a recurring occurrence. */
  id: string;
  title: string;
  /** The bill's SCHEDULED amount, which may differ from the charge. */
  amount: number;
  matchedBy: BillMatchSource;
}

export type TransactionQueueItem = Transaction & {
  queueType: 'transaction';
  matchedBill?: MatchedBillRef;
};

export type CalendarQueueItem = CalendarItem & {
  queueType: 'calendar';
};

export type ActionQueueItem = TransactionQueueItem | CalendarQueueItem | ToDoActionQueueItem;

// Type guard functions for ActionQueueItem
export const isTransactionQueueItem = (item: ActionQueueItem): item is TransactionQueueItem => {
  return item.queueType === 'transaction';
};

export const isCalendarQueueItem = (item: ActionQueueItem): item is CalendarQueueItem => {
  return item.queueType === 'calendar';
};

export const isTodoQueueItem = (item: ActionQueueItem): item is ToDoActionQueueItem => {
  return item.queueType === 'todo';
};

/**
 * A `pending_review` transaction is hidden from review surfaces (the Action
 * Queue and the on-open review drawer) while its Action-Queue snooze is still in
 * the future. Both sides are local `yyyy-MM-dd`, so a lexical compare is
 * chronological. Snoozing defers the REVIEW only — the transaction still counts
 * toward pendingSpend / Safe-to-Spend.
 */
export const isReviewSnoozed = (
  tx: Pick<Transaction, 'reviewSnoozedUntil'>,
  today: string,
): boolean => !!tx.reviewSnoozedUntil && tx.reviewSnoozedUntil > today;

/**
 * `needsReview` now lives in `@/utils/reviewQueue` (a pure module) so
 * dependency-light utils can use it without dragging React/contexts in. It is
 * re-exported here unchanged, so every existing `from '@/hooks/useActionQueue'`
 * import keeps working.
 */
export { needsReview };

export const useActionQueue = () => {
  const { transactions } = useFinance();
  const { todos } = useTodos();
  const { currentUser } = useHouseholdCore();
  const { isModuleEnabled, isPlanTabVisible } = useModuleVisibility();
  // Household merchant rules — the most authoritative bill-match tier (a rule's
  // `billId` is an explicit "this descriptor IS that bill" statement). Read via
  // the shared hook so the array identity only changes when the rules really do.
  const { rules: merchantRules } = useMerchantRules();

  // Plan 090 (graceful degradation): gate each queue source by its domain so a
  // disabled module never surfaces an item whose destination page is hidden.
  // Bills (calendar) + pending transactions are money; to-dos are gated by the
  // Plan→To-Dos cascade (the master toggle, not the raw `todos` flag), matching
  // the route/capture guards.
  const showMoney = isModuleEnabled('money');
  const showTodos = isPlanTabVisible('todos');

  // Local-day anchor for every date comparison below, rolling forward at local
  // midnight. Shared with the footer's review badge (`BottomNav`) so the badge
  // and this queue can never anchor on different days — see `useLocalToday`.
  const localToday = useLocalToday();

  // parseISO on a local yyyy-MM-dd string yields local midnight — the same
  // instant startOfToday() returns while `localToday` is current — so the Date
  // anchors stay referentially stable within a day and advance with the tick.
  const today = useMemo(() => parseISO(localToday), [localToday]);
  const endToday = useMemo(() => endOfDay(today), [today]);

  // Expand recurring calendar items for a reasonable range (1 month past to 3
  // months future) via the shared memoized helper, so this window's expansion is
  // reused across renders instead of being recomputed inline on every render.
  const windowStart = useMemo(() => subMonths(today, 1), [today]);
  const windowEnd = useMemo(() => addMonths(today, 3), [today]);
  const expandedCalendarItems = useExpandedCalendarItems(windowStart, windowEnd);

  // 1. Due Calendar Items (Past or Today, Unpaid) — money domain
  const dueCalendarItems: CalendarQueueItem[] = useMemo(() => showMoney ? expandedCalendarItems.filter(item =>
    !item.isPaid && (isBefore(parseISO(item.date), endToday) || isSameDay(parseISO(item.date), today))
  ).map(i => ({ ...i, queueType: 'calendar' as const })) : [], [showMoney, expandedCalendarItems, endToday, today]);

  // 2. Pending Transactions — money domain. A row deferred via the queue's
  // swipe/bulk "Defer" is snoozed (hidden) while its reviewSnoozedUntil is
  // still in the future; both sides are local yyyy-MM-dd, so lexical compare
  // is chronological. It still counts toward pendingSpend / Safe-to-Spend.
  const pendingTx: TransactionQueueItem[] = useMemo(() => showMoney ? transactions.filter(t =>
    needsReview(t) &&
    !isReviewSnoozed(t, localToday)
  ).map(t => ({ ...t, queueType: 'transaction' as const })) : [], [showMoney, transactions, localToday]);

  // 2b. Bill ← transaction recognition (owner paper cut PC#3).
  //
  // A charge can enter this app by two roads. The nightly bank-EMAIL sync runs
  // the three-tier matcher in `functions/src/quickAdd/bankSyncMatch.ts` and
  // settles the bill server-side, so the queue never sees a pair. A SCREENSHOT
  // import (CaptureModal → parseBankStatement → `pending_review` rows) never
  // touched that matcher, so a recurring bill entered by hand and the imported
  // charge that pays it both surfaced as unrelated "Review" rows.
  //
  // Run the SAME logic here, at its existing strictness, over the bills that are
  // actually in the queue: a match collapses the pair to the transaction row
  // (annotated with the bill), because the transaction is the real money
  // movement and still needs categorising, while the bill it pays is only
  // waiting on confirmation. No match ⇒ both rows stand, which is the safe
  // default — a duplicate row is a nuisance, but silently associating the wrong
  // bill is a money bug.
  //
  // Candidates are drawn from `dueCalendarItems` on purpose (not the whole
  // expansion window): the only thing this fixes is two rows appearing at once,
  // so a bill that isn't in the queue has nothing to collapse with.
  const matchedBills = useMemo(() => {
    const byTransactionId = new Map<string, MatchedBillRef>();
    if (!showMoney || pendingTx.length === 0) return byTransactionId;

    const candidates: BillPayCandidate[] = dueCalendarItems
      .filter(item => item.type === 'expense')
      .map(item => ({
        id: item.id,
        // A merchant rule's `billId` names the recurring TEMPLATE, while an
        // expanded occurrence carries a synthetic `templateId_instance_date` id
        // — so the template id has to travel alongside it for the rule tier.
        templateId: parseRecurringId(item.id)?.templateId ?? item.parentRecurringId,
        title: item.title,
        amount: item.amount,
        bankDescriptorAliases: item.bankDescriptorAliases,
      }));
    if (candidates.length === 0) return byTransactionId;

    for (const tx of pendingTx) {
      // An Apple Pay `$0` stub has no amount yet, so the tolerance guard can't
      // do its job (every bill under $25 would look "within tolerance" of $0).
      // The server twin never sees this case — a bank withdrawal is never $0 —
      // so skipping keeps the two copies equivalent rather than diverging.
      if (tx.needsAmount) continue;
      // The RAW stored merchant is the identity key — never a merchant-rule
      // display name (see utils/transactionIdentity.ts for why).
      const match = pickBillToPay(
        { descriptor: tx.merchant, amount: tx.amount },
        candidates,
        merchantRules,
      );
      if (match) {
        byTransactionId.set(tx.id, {
          id: match.bill.id,
          title: match.bill.title,
          amount: match.bill.amount,
          matchedBy: match.matchedBy,
        });
      }
    }
    return byTransactionId;
  }, [showMoney, dueCalendarItems, pendingTx, merchantRules]);

  // The bill rows a queued transaction now stands for, and the transaction rows
  // that carry them. Both derivations are pure functions of `matchedBills`, so
  // deleting or approving the transaction restores the bill's own row on the
  // next render — nothing here is persisted.
  const queuedCalendarItems: CalendarQueueItem[] = useMemo(() => {
    if (matchedBills.size === 0) return dueCalendarItems;
    const claimed = new Set(Array.from(matchedBills.values(), m => m.id));
    return dueCalendarItems.filter(item => !claimed.has(item.id));
  }, [dueCalendarItems, matchedBills]);

  const queuedTransactions: TransactionQueueItem[] = useMemo(() => {
    if (matchedBills.size === 0) return pendingTx;
    return pendingTx.map(tx => {
      const matchedBill = matchedBills.get(tx.id);
      return matchedBill ? { ...tx, matchedBill } : tx;
    });
  }, [pendingTx, matchedBills]);

  // 3. Immediate To-Dos (Overdue, Today or Tomorrow) — Plan→To-Dos domain
  // Filter out todos with invalid dates early to prevent issues downstream
  const immediateToDos: ActionQueueItem[] = useMemo(() => !showTodos ? [] : todos.filter(t => {
    if (t.isCompleted) return false;
    // Held-for-review captures (captureReview, Plan L1) are hidden from the
    // Action Queue as individual to-do cards — they surface only via the
    // aggregate ReviewQueueCard until approved. `useTodos().todos` already
    // excludes these upstream (the context splits visible vs. awaiting-review),
    // so this is defense-in-depth rather than the primary guarantee.
    if (t.needsReview === true) return false;
    // Owner-reported paper cut: a member's queue should show only items
    // assigned to THEM or to the whole household (assignedTo absent/undefined
    // is the "whole household" sentinel — see ToDosPage's write of
    // __whole_household__ as `undefined`), not every household member's
    // personal to-dos. If `currentUser` hasn't loaded yet, `currentUser?.uid`
    // is undefined and only household-wide items pass — the safe transient
    // (never over-shows someone else's personal item during load).
    if (t.assignedTo && t.assignedTo !== currentUser?.uid) return false;
    const date = parseISO(t.completeByDate);
    // Validate the parsed date before using it
    if (!isValid(date)) {
      if (import.meta.env.DEV) {
        console.warn('Invalid todo date detected; skipping todo item from action queue.');
      }
      return false;
    }
    // Use consistent date-only comparisons: Overdue (before today), Today, or Tomorrow
    return isBefore(date, today) || isToday(date) || isTomorrow(date);
  }).map(t => ({ ...t, queueType: 'todo' as const, date: t.completeByDate })), [showTodos, todos, today, currentUser?.uid]);

  // 4. Combined & Sorted (Chronological: Oldest First)
  const actionQueue = useMemo(() => {
    return [...queuedCalendarItems, ...queuedTransactions, ...immediateToDos].sort((a, b) => {
      // All queue items carry a zero-padded ISO yyyy-MM-dd date, so lexical order
      // matches chronological order. Plain >/< beats localeCompare (no V8 collation
      // cost) and avoids the per-comparison Date allocation. (asc, oldest first)
      return a.date > b.date ? 1 : a.date < b.date ? -1 : 0;
    });
  }, [queuedCalendarItems, queuedTransactions, immediateToDos]);

  return { actionQueue };
};
