import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTodoAutoReschedule } from './useTodoAutoReschedule';
import type { ToDo } from '@/types/schema';

// 2026-07-21 is a Tuesday; "today" throughout is Friday 2026-07-24.
const TODAY = '2026-07-24';

const todo = (overrides: Partial<ToDo> = {}): ToDo => ({
  id: 't1',
  text: 'Kitchen reset',
  completeByDate: '2026-07-21',
  assignedTo: 'uid-1',
  isCompleted: false,
  createdBy: 'uid-1',
  createdAt: '2026-07-01T00:00:00.000Z',
  resetWhenExpired: true,
  recurrence: { frequency: 'weekly' },
  ...overrides,
});

interface Props {
  householdId: string | null;
  todos: ToDo[];
  updateToDo: (id: string, updates: Partial<ToDo>) => Promise<void>;
}

/** The callback awaits each write, so assertions must flush microtasks. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('useTodoAutoReschedule', () => {
  let updateToDo: ReturnType<typeof vi.fn<(id: string, updates: Partial<ToDo>) => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    updateToDo = vi.fn(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const setup = (props: Props) =>
    renderHook(
      (p: Props) => useTodoAutoReschedule({ ...p, today: () => TODAY }),
      { initialProps: props },
    );

  it('rolls an expired repeating chore forward to its next occurrence', async () => {
    setup({ householdId: 'h1', todos: [todo()], updateToDo });
    await flush();
    expect(updateToDo).toHaveBeenCalledTimes(1);
    expect(updateToDo).toHaveBeenCalledWith('t1', { completeByDate: '2026-07-28' });
  });

  it('clears checked steps when it rolls forward', async () => {
    setup({
      householdId: 'h1',
      todos: [todo({ subtasks: [{ id: 's1', text: 'Counters', isDone: true }] })],
      updateToDo,
    });
    await flush();
    expect(updateToDo).toHaveBeenCalledWith('t1', {
      completeByDate: '2026-07-28',
      subtasks: [{ id: 's1', text: 'Counters', isDone: false }],
    });
  });

  it('leaves every ineligible to-do alone', async () => {
    setup({
      householdId: 'h1',
      todos: [
        todo({ id: 'flag-off', resetWhenExpired: false }),
        todo({ id: 'not-recurring', recurrence: undefined }),
        todo({ id: 'completed', isCompleted: true }),
        todo({ id: 'awaiting-review', needsReview: true }),
        todo({ id: 'due-today', completeByDate: TODAY }),
        todo({ id: 'due-later', completeByDate: '2026-08-04' }),
      ],
      updateToDo,
    });
    await flush();
    expect(updateToDo).not.toHaveBeenCalled();
  });

  it('does nothing without a household', async () => {
    setup({ householdId: null, todos: [todo()], updateToDo });
    await flush();
    expect(updateToDo).not.toHaveBeenCalled();
  });

  it('writes once even when the tick fires again before the snapshot lands', async () => {
    setup({ householdId: 'h1', todos: [todo()], updateToDo });
    await flush();
    expect(updateToDo).toHaveBeenCalledTimes(1);

    // The 5-minute scheduler tick — `todos` still carries the OLD due date
    // because the Firestore round-trip hasn't come back yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await flush();
    expect(updateToDo).toHaveBeenCalledTimes(1);
  });

  it('keeps going after one to-do fails, and retries it on the next tick', async () => {
    updateToDo = vi
      .fn<(id: string, updates: Partial<ToDo>) => Promise<void>>()
      .mockRejectedValueOnce(new Error('permission-denied'))
      .mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    setup({
      householdId: 'h1',
      todos: [todo({ id: 'boom' }), todo({ id: 'fine' })],
      updateToDo,
    });
    await flush();

    // The rejection did not abort the loop.
    expect(updateToDo.mock.calls.map(c => c[0])).toEqual(['boom', 'fine']);
    expect(consoleError).toHaveBeenCalled();

    // The failed one is not marked as written, so the next tick retries it —
    // and the successful one is not written twice.
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    await flush();
    expect(updateToDo.mock.calls.map(c => c[0])).toEqual(['boom', 'fine', 'boom']);
  });
});
