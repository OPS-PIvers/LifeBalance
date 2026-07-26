import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Transaction, CalendarItem, ToDo, ModuleKey } from '@/types/schema';
import {
  useActionQueue,
  isTransactionQueueItem,
  isCalendarQueueItem,
  isTodoQueueItem,
  type ActionQueueItem,
} from '@/hooks/useActionQueue';
import {
  useFinance,
  useTodos,
  useExpandedCalendarItems,
} from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
  useTodos: vi.fn(),
  useExpandedCalendarItems: vi.fn(),
}));

// Module visibility (Plan 090): mocked so each test can choose which domains
// are enabled. Defaults to all-on (pre-090 behavior).
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    // A to-do is only reachable when the Plan master AND the To-Dos tab are on.
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
  });
};

// Minimal fixture builders.
const makeCalendarItem = (overrides: Partial<CalendarItem>): CalendarItem =>
  ({
    id: 'cal-1',
    title: 'Rent',
    amount: 1000,
    date: '2026-06-16',
    type: 'expense',
    isPaid: false,
    ...overrides,
  } as CalendarItem);

const makeTransaction = (overrides: Partial<Transaction>): Transaction =>
  ({
    id: 'tx-1',
    amount: 50,
    merchant: 'Store',
    category: 'Groceries',
    date: '2026-06-16',
    status: 'pending_review',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  } as unknown as Transaction);

const makeTodo = (overrides: Partial<ToDo>): ToDo =>
  ({
    id: 'todo-1',
    text: 'Do thing',
    completeByDate: '2026-06-16',
    assignedTo: 'uid-1',
    isCompleted: false,
    createdBy: 'uid-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as unknown as ToDo);

const setMocks = (opts: {
  transactions?: Transaction[];
  todos?: ToDo[];
  calendar?: CalendarItem[];
}) => {
  vi.mocked(useFinance).mockReturnValue({
    transactions: opts.transactions ?? [],
  } as unknown as ReturnType<typeof useFinance>);
  vi.mocked(useTodos).mockReturnValue({
    todos: opts.todos ?? [],
  } as unknown as ReturnType<typeof useTodos>);
  vi.mocked(useExpandedCalendarItems).mockReturnValue(opts.calendar ?? []);
};

describe('useActionQueue', () => {
  beforeEach(() => {
    // Pin "today" to 2026-06-16 noon.
    vi.useFakeTimers({ now: new Date('2026-06-16T12:00:00') });
    // Default: every domain on (pre-090 behavior). Plan on so to-dos surface.
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns an empty queue for empty inputs', () => {
    setMocks({});
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue).toEqual([]);
  });

  it('combines all three sources, tags queueType, and sorts chronologically (oldest first)', () => {
    setMocks({
      calendar: [makeCalendarItem({ id: 'cal-1', date: '2026-06-15', isPaid: false })],
      transactions: [
        makeTransaction({ id: 'tx-1', date: '2026-06-10', status: 'pending_review' }),
      ],
      todos: [makeTodo({ id: 'todo-1', completeByDate: '2026-06-16' })],
    });

    const { result } = renderHook(() => useActionQueue());
    const queue = result.current.actionQueue;

    expect(queue).toHaveLength(3);
    // Chronological: tx (06-10), cal (06-15), todo (06-16)
    expect(queue.map((i) => i.id)).toEqual(['tx-1', 'cal-1', 'todo-1']);
    expect(queue.map((i) => i.queueType)).toEqual(['transaction', 'calendar', 'todo']);

    const todoItem = queue[2];
    expect(todoItem).toBeDefined();
    if (todoItem && isTodoQueueItem(todoItem)) {
      // ToDo's completeByDate is mapped onto `date`.
      expect(todoItem.date).toBe('2026-06-16');
    }
  });

  it('excludes paid calendar items', () => {
    setMocks({
      calendar: [
        makeCalendarItem({ id: 'paid', date: '2026-06-15', isPaid: true }),
        makeCalendarItem({ id: 'unpaid', date: '2026-06-15', isPaid: false }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id)).toEqual(['unpaid']);
  });

  it('excludes future-dated unpaid calendar items', () => {
    setMocks({
      calendar: [
        makeCalendarItem({ id: 'today', date: '2026-06-16', isPaid: false }),
        makeCalendarItem({ id: 'future', date: '2026-06-20', isPaid: false }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id)).toEqual(['today']);
  });

  it('includes overdue/today/tomorrow todos but excludes ones beyond tomorrow', () => {
    setMocks({
      todos: [
        makeTodo({ id: 'overdue', completeByDate: '2026-06-10' }),
        makeTodo({ id: 'today', completeByDate: '2026-06-16' }),
        makeTodo({ id: 'tomorrow', completeByDate: '2026-06-17' }),
        makeTodo({ id: 'far', completeByDate: '2026-06-18' }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    const ids = result.current.actionQueue.map((i) => i.id);
    expect(ids).toContain('overdue');
    expect(ids).toContain('today');
    expect(ids).toContain('tomorrow');
    expect(ids).not.toContain('far');
  });

  it('excludes completed todos', () => {
    setMocks({
      todos: [
        makeTodo({ id: 'done', completeByDate: '2026-06-16', isCompleted: true }),
        makeTodo({ id: 'open', completeByDate: '2026-06-16', isCompleted: false }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id)).toEqual(['open']);
  });

  // Layer 4 regression: a held-for-review todo (captureReview) must never
  // surface as an individual Action Queue card — it's only reachable via the
  // aggregate ReviewQueueCard until approved. In production `useTodos().todos`
  // is already filtered upstream (the context splits visible vs.
  // awaiting-review), but this asserts the guarantee holds at this hook too,
  // even if a caller (a test, Test Mode, or a future context change) ever
  // hands it an unfiltered list.
  it('excludes needsReview todos even if the upstream todos slice were to leak one', () => {
    setMocks({
      todos: [
        makeTodo({ id: 'held', completeByDate: '2026-06-16', needsReview: true }),
        makeTodo({ id: 'visible', completeByDate: '2026-06-16' }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id)).toEqual(['visible']);
  });

  it('includes pending_review transactions but excludes verified ones', () => {
    setMocks({
      transactions: [
        makeTransaction({ id: 'pending', date: '2026-06-16', status: 'pending_review' }),
        makeTransaction({ id: 'verified', date: '2026-06-16', status: 'verified' }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id)).toEqual(['pending']);
  });

  it('hides snoozed pending transactions until their reviewSnoozedUntil passes', () => {
    setMocks({
      transactions: [
        // Snoozed until tomorrow → hidden today.
        makeTransaction({
          id: 'snoozed',
          date: '2026-06-14',
          status: 'pending_review',
          reviewSnoozedUntil: '2026-06-17',
        }),
        // Snooze expired (today) → visible again.
        makeTransaction({
          id: 'expired',
          date: '2026-06-14',
          status: 'pending_review',
          reviewSnoozedUntil: '2026-06-16',
        }),
        makeTransaction({ id: 'never-snoozed', date: '2026-06-14', status: 'pending_review' }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    const ids = result.current.actionQueue.map((i) => i.id);
    expect(ids).not.toContain('snoozed');
    expect(ids).toContain('expired');
    expect(ids).toContain('never-snoozed');
  });

  it('keeps an Apple Pay $0 stub in the queue even after it was dismissed from the on-open drawer', () => {
    setMocks({
      transactions: [
        // Dismissed stub: needsAmount true + needsAmountPromptedAt set. It must
        // still surface in the Action Queue (the queue filters only on status).
        makeTransaction({
          id: 'stub',
          date: '2026-06-16',
          amount: 0,
          status: 'pending_review',
          needsAmount: true,
          needsAmountPromptedAt: '2026-06-16T09:00:00.000Z',
        }),
      ],
    });
    const { result } = renderHook(() => useActionQueue());
    const item = result.current.actionQueue.find((i) => i.id === 'stub');
    expect(item).toBeDefined();
    expect(item && isTransactionQueueItem(item) && item.needsAmount).toBe(true);
  });

  it('skips todos with invalid dates without throwing', () => {
    setMocks({
      todos: [
        makeTodo({ id: 'bad', completeByDate: 'not-a-date' }),
        makeTodo({ id: 'good', completeByDate: '2026-06-16' }),
      ],
    });
    let result: { current: ReturnType<typeof useActionQueue> } | undefined;
    expect(() => {
      result = renderHook(() => useActionQueue()).result;
    }).not.toThrow();
    expect(result?.current.actionQueue.map((i) => i.id)).toEqual(['good']);
  });

  // --- Plan 090: graceful degradation (per-domain gating) ---

  it('drops bills + pending transactions when money is off, keeps to-dos', () => {
    setEnabledModules(['habits', 'lists', 'todos']); // money OFF, todos reachable
    setMocks({
      calendar: [makeCalendarItem({ id: 'cal-1', date: '2026-06-15', isPaid: false })],
      transactions: [
        makeTransaction({ id: 'tx-1', date: '2026-06-10', status: 'pending_review' }),
      ],
      todos: [makeTodo({ id: 'todo-1', completeByDate: '2026-06-16' })],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id)).toEqual(['todo-1']);
  });

  it('drops to-dos when the Plan→To-Dos destination is unreachable, keeps money items', () => {
    // todos flag on, but Plan master off → the To-Dos page is unreachable, so
    // to-do items must not surface; bills + pending transactions remain.
    setEnabledModules(['habits', 'money', 'todos']); // Plan OFF
    setMocks({
      calendar: [makeCalendarItem({ id: 'cal-1', date: '2026-06-15', isPaid: false })],
      transactions: [
        makeTransaction({ id: 'tx-1', date: '2026-06-10', status: 'pending_review' }),
      ],
      todos: [makeTodo({ id: 'todo-1', completeByDate: '2026-06-16' })],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue.map((i) => i.id).sort()).toEqual(['cal-1', 'tx-1']);
  });

  it('returns an empty queue when both money and the To-Dos destination are off', () => {
    setEnabledModules(['habits']); // money OFF, Plan/To-Dos OFF
    setMocks({
      calendar: [makeCalendarItem({ id: 'cal-1', date: '2026-06-15', isPaid: false })],
      transactions: [
        makeTransaction({ id: 'tx-1', date: '2026-06-10', status: 'pending_review' }),
      ],
      todos: [makeTodo({ id: 'todo-1', completeByDate: '2026-06-16' })],
    });
    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue).toEqual([]);
  });

  it('type guards correctly narrow tagged items', () => {
    setMocks({
      calendar: [makeCalendarItem({ id: 'cal-1', date: '2026-06-15' })],
      transactions: [makeTransaction({ id: 'tx-1', date: '2026-06-10' })],
      todos: [makeTodo({ id: 'todo-1', completeByDate: '2026-06-16' })],
    });
    const { result } = renderHook(() => useActionQueue());
    const queue: ActionQueueItem[] = result.current.actionQueue;

    const tx = queue.find((i) => i.id === 'tx-1');
    const cal = queue.find((i) => i.id === 'cal-1');
    const todo = queue.find((i) => i.id === 'todo-1');

    expect(tx && isTransactionQueueItem(tx)).toBe(true);
    expect(cal && isCalendarQueueItem(cal)).toBe(true);
    expect(todo && isTodoQueueItem(todo)).toBe(true);

    // Negative cases.
    expect(cal && isTransactionQueueItem(cal)).toBe(false);
    expect(tx && isTodoQueueItem(tx)).toBe(false);
  });
});
