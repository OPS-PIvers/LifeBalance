import { useEffect, useMemo, useState } from 'react';
import {
  endOfDay, isBefore, parseISO, isSameDay, subMonths, addMonths,
  startOfDay, addDays, differenceInMilliseconds, isToday, isTomorrow, isValid
} from 'date-fns';
import { Transaction, CalendarItem, ToDo } from '@/types/schema';
import { useFinance, useTodos, useExpandedCalendarItems } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { getLocalDateString } from '@/utils/dateHelpers';

// ToDoActionQueueItem normalizes the ToDo interface for the action queue
// by replacing 'completeByDate' with 'date' to match Transaction and CalendarItem.
// Todos do not have a monetary amount; any amount-related logic should check
// the queueType and ignore items where queueType === 'todo'.
export type ToDoActionQueueItem = Omit<ToDo, 'completeByDate'> & {
  queueType: 'todo';
  date: string; // Maps from ToDo.completeByDate for consistent ActionQueueItem interface
};

export type TransactionQueueItem = Transaction & {
  queueType: 'transaction';
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
 * A transaction is a REVIEW candidate when it is either a classic
 * `pending_review` row OR a bank-email-sync row that was born `verified` but
 * still `needsCategory` (bankEmailSync Cloud Function). The latter carries an
 * authoritative balance already, so its review is a bucket-assignment only (no
 * balance delta on categorize) — but it must still surface in the same review
 * surfaces (Action Queue + on-open review drawer) so it doesn't sit
 * uncategorized forever.
 */
export const needsReview = (
  tx: Pick<Transaction, 'status' | 'needsCategory'>,
): boolean => tx.status === 'pending_review' || (tx.status === 'verified' && tx.needsCategory === true);

export const useActionQueue = () => {
  const { transactions } = useFinance();
  const { todos } = useTodos();
  const { isModuleEnabled, isPlanTabVisible } = useModuleVisibility();

  // Plan 090 (graceful degradation): gate each queue source by its domain so a
  // disabled module never surfaces an item whose destination page is hidden.
  // Bills (calendar) + pending transactions are money; to-dos are gated by the
  // Plan→To-Dos cascade (the master toggle, not the raw `todos` flag), matching
  // the route/capture guards.
  const showMoney = isModuleEnabled('money');
  const showTodos = isPlanTabVisible('todos');

  // Local-day anchor for every date comparison below. Held in state (not a
  // mount-time memo) so an always-open dashboard (e.g. wall-mounted tablet PWA)
  // rolls forward at local midnight instead of keeping yesterday's "today"
  // until a remount. A self-rescheduling timeout re-derives the day just past
  // midnight; setState with the unchanged string is a no-op, so renders only
  // happen when the day actually flips.
  const [localToday, setLocalToday] = useState(() => getLocalDateString());
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const scheduleMidnightTick = () => {
      const now = new Date();
      // addDays is DST-safe (vs. a manual 24h add); the +1s buffer keeps a
      // slightly-early wakeup from re-arming a zero-delay loop.
      const msUntilMidnight =
        differenceInMilliseconds(startOfDay(addDays(now, 1)), now) + 1000;
      timeoutId = setTimeout(() => {
        setLocalToday(getLocalDateString());
        scheduleMidnightTick();
      }, msUntilMidnight);
    };
    scheduleMidnightTick();
    return () => clearTimeout(timeoutId);
  }, []);

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
  const dueCalendarItems: ActionQueueItem[] = useMemo(() => showMoney ? expandedCalendarItems.filter(item =>
    !item.isPaid && (isBefore(parseISO(item.date), endToday) || isSameDay(parseISO(item.date), today))
  ).map(i => ({ ...i, queueType: 'calendar' as const })) : [], [showMoney, expandedCalendarItems, endToday, today]);

  // 2. Pending Transactions — money domain. A row deferred via the queue's
  // swipe/bulk "Defer" is snoozed (hidden) while its reviewSnoozedUntil is
  // still in the future; both sides are local yyyy-MM-dd, so lexical compare
  // is chronological. It still counts toward pendingSpend / Safe-to-Spend.
  const pendingTx: ActionQueueItem[] = useMemo(() => showMoney ? transactions.filter(t =>
    needsReview(t) &&
    !isReviewSnoozed(t, localToday)
  ).map(t => ({ ...t, queueType: 'transaction' as const })) : [], [showMoney, transactions, localToday]);

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
  }).map(t => ({ ...t, queueType: 'todo' as const, date: t.completeByDate })), [showTodos, todos, today]);

  // 4. Combined & Sorted (Chronological: Oldest First)
  const actionQueue = useMemo(() => {
    return [...dueCalendarItems, ...pendingTx, ...immediateToDos].sort((a, b) => {
      // All queue items carry a zero-padded ISO yyyy-MM-dd date, so lexical order
      // matches chronological order. Plain >/< beats localeCompare (no V8 collation
      // cost) and avoids the per-comparison Date allocation. (asc, oldest first)
      return a.date > b.date ? 1 : a.date < b.date ? -1 : 0;
    });
  }, [dueCalendarItems, pendingTx, immediateToDos]);

  return { actionQueue };
};
