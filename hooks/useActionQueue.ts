import { useMemo } from 'react';
import {
  endOfDay, isBefore, parseISO, isSameDay, subMonths, addMonths,
  startOfToday, isToday, isTomorrow, isValid
} from 'date-fns';
import { expandCalendarItems } from '../utils/calendarRecurrence';
import { Transaction, CalendarItem, ToDo } from '../types/schema';
import { useHousehold } from '../contexts/FirebaseHouseholdContext';

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

export const useActionQueue = () => {
  const { transactions, calendarItems, todos } = useHousehold();

  // Use startOfToday for stable date reference across renders for the same day
  // This prevents unnecessary re-calculations if the component re-renders
  const today = useMemo(() => startOfToday(), []);
  const endToday = useMemo(() => endOfDay(today), [today]);

  // Expand recurring calendar items for a reasonable range (1 month past to 3 months future)
  // This ensures we catch any due recurring items
  const expandedCalendarItems = useMemo(
    () => expandCalendarItems(calendarItems, subMonths(today, 1), addMonths(today, 3)),
    [calendarItems, today]
  );

  // 1. Due Calendar Items (Past or Today, Unpaid)
  const dueCalendarItems: ActionQueueItem[] = useMemo(() => expandedCalendarItems.filter(item =>
    !item.isPaid && (isBefore(parseISO(item.date), endToday) || isSameDay(parseISO(item.date), today))
  ).map(i => ({ ...i, queueType: 'calendar' as const })), [expandedCalendarItems, endToday, today]);

  // 2. Pending Transactions
  const pendingTx: ActionQueueItem[] = useMemo(() => transactions.filter(t =>
    t.status === 'pending_review'
  ).map(t => ({ ...t, queueType: 'transaction' as const })), [transactions]);

  // 3. Immediate To-Dos (Overdue, Today or Tomorrow)
  // Filter out todos with invalid dates early to prevent issues downstream
  const immediateToDos: ActionQueueItem[] = useMemo(() => todos.filter(t => {
    if (t.isCompleted) return false;
    const date = parseISO(t.completeByDate);
    // Validate the parsed date before using it
    if (!isValid(date)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('Invalid todo date detected; skipping todo item from action queue.');
      }
      return false;
    }
    // Use consistent date-only comparisons: Overdue (before today), Today, or Tomorrow
    return isBefore(date, today) || isToday(date) || isTomorrow(date);
  }).map(t => ({ ...t, queueType: 'todo' as const, date: t.completeByDate })), [todos, today]);

  // 4. Combined & Sorted (Chronological: Oldest First)
  const actionQueue = useMemo(() => {
    return [...dueCalendarItems, ...pendingTx, ...immediateToDos].sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [dueCalendarItems, pendingTx, immediateToDos]);

  return { actionQueue };
};
