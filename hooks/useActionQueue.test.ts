import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { CalendarItem, ToDo, Transaction } from '@/types/schema';
import { useActionQueue } from '@/hooks/useActionQueue';

// Mutable containers read lazily by the mocked context hooks so each test can
// swap in its own data before rendering. vi.hoisted runs before the hoisted
// vi.mock factories, so the references are safe to close over.
const mockData = vi.hoisted(() => ({
  transactions: [] as Transaction[],
  todos: [] as ToDo[],
  calendarItems: [] as CalendarItem[],
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ transactions: mockData.transactions }),
  useTodos: () => ({ todos: mockData.todos }),
  useExpandedCalendarItems: () => mockData.calendarItems,
}));

vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: () => ({
    isModuleEnabled: () => true,
    isPlanVisible: true,
    isPlanTabVisible: () => true,
  }),
}));

const makeCalendarItem = (overrides: Partial<CalendarItem>): CalendarItem => ({
  id: 'cal-1',
  title: 'Electric bill',
  amount: 120,
  date: '2026-06-16',
  type: 'expense',
  isPaid: false,
  ...overrides,
});

const makeTransaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'tx-1',
  amount: 42,
  merchant: 'Coffee Shop',
  category: 'Dining',
  date: '2026-06-15',
  status: 'pending_review',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  ...overrides,
});

const makeTodo = (overrides: Partial<ToDo>): ToDo => ({
  id: 'todo-1',
  text: 'Take out trash',
  completeByDate: '2026-06-16',
  assignedTo: 'uid-1',
  isCompleted: false,
  createdBy: 'uid-1',
  createdAt: '2026-06-01T12:00:00.000Z',
  ...overrides,
});

// One local hour before midnight, then one hour + tick buffer to cross it.
const MS_TO_MIDNIGHT = 60 * 60 * 1000 + 2000;

describe('useActionQueue midnight rollover', () => {
  beforeEach(() => {
    // Fixed local time shortly before midnight so rollover math is deterministic.
    vi.useFakeTimers({ now: new Date('2026-06-16T23:00:00') });
    mockData.transactions = [];
    mockData.todos = [];
    mockData.calendarItems = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('surfaces due/overdue bills and hides future ones', () => {
    mockData.calendarItems = [
      makeCalendarItem({ id: 'due-today', date: '2026-06-16' }),
      makeCalendarItem({ id: 'overdue', date: '2026-06-10' }),
      makeCalendarItem({ id: 'due-tomorrow', date: '2026-06-17' }),
      makeCalendarItem({ id: 'paid', date: '2026-06-16', isPaid: true }),
    ];

    const { result } = renderHook(() => useActionQueue());

    expect(result.current.actionQueue.map(i => i.id)).toEqual(['overdue', 'due-today']);
  });

  it('surfaces a bill due "tomorrow" once local midnight passes without a remount', async () => {
    mockData.calendarItems = [
      makeCalendarItem({ id: 'due-tomorrow', date: '2026-06-17' }),
    ];

    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_TO_MIDNIGHT);
    });

    expect(result.current.actionQueue.map(i => i.id)).toEqual(['due-tomorrow']);
  });

  it('un-hides a snoozed transaction when its reviewSnoozedUntil day arrives', async () => {
    mockData.transactions = [
      makeTransaction({ id: 'snoozed', reviewSnoozedUntil: '2026-06-17' }),
    ];

    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_TO_MIDNIGHT);
    });

    expect(result.current.actionQueue.map(i => i.id)).toEqual(['snoozed']);
  });

  it('re-anchors the to-do today/tomorrow window after midnight', async () => {
    mockData.todos = [
      makeTodo({ id: 'todo-day-after', completeByDate: '2026-06-18' }),
    ];

    const { result } = renderHook(() => useActionQueue());
    // Two days out: neither overdue, today, nor tomorrow yet.
    expect(result.current.actionQueue).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_TO_MIDNIGHT);
    });

    // Now 2026-06-17, so the 06-18 to-do qualifies as "tomorrow".
    expect(result.current.actionQueue.map(i => i.id)).toEqual(['todo-day-after']);
  });

  it('keeps rolling on subsequent midnights', async () => {
    mockData.calendarItems = [
      makeCalendarItem({ id: 'due-in-two-days', date: '2026-06-18' }),
    ];

    const { result } = renderHook(() => useActionQueue());
    expect(result.current.actionQueue).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MS_TO_MIDNIGHT); // -> 2026-06-17
    });
    expect(result.current.actionQueue).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // -> 2026-06-18
    });
    expect(result.current.actionQueue.map(i => i.id)).toEqual(['due-in-two-days']);
  });
});
