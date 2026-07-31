import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Account, BudgetBucket, Habit, ToDo, Transaction } from '@/types/schema';
import { CREDIT_CARD_CATEGORY } from '@/types/schema';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  useFinance,
  useTodos,
  useHouseholdCore,
  useGamification,
  useExpandedCalendarItems,
} from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { CalendarQueueItem, ToDoActionQueueItem, TransactionQueueItem } from '@/hooks/useActionQueue';
import { useActionQueueTriage } from '@/hooks/useActionQueueTriage';

/**
 * `useActionQueueTriage`'s two swipe handlers commit real money: the
 * credit-card category sentinel, the habit-firing dedup, and an undo that
 * branches between an atomic reversal and a plain status flip. `Dashboard.test.tsx`
 * stubs `ActionQueueItemCard` to a bare div, so none of it was ever executed by
 * a test before this file.
 *
 * Convention follows the sibling `hooks/useActionQueue.test.tsx`: one `vi.fn()`
 * per context hook, configured through a single `setMocks()` per test, so a path
 * can never silently no-op on an `undefined` mutation.
 */

// react-hot-toast's default export is CALLED as a function for the undo toast
// (`toast((t) => <UndoToast … />)`) — capturing that render function is the only
// way to reach `onUndo`, so the mock must be callable, not just `{success,error}`.
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
  useTodos: vi.fn(),
  useHouseholdCore: vi.fn(),
  useGamification: vi.fn(),
  useExpandedCalendarItems: vi.fn(),
}));

vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

// --- Fixtures --------------------------------------------------------------

const TODAY = getLocalDateString();

const account = (overrides: Partial<Account>): Account =>
  ({
    id: 'acc-checking',
    name: 'Joint Checking',
    type: 'checking',
    balance: 1000,
    lastUpdated: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }) as Account;

const bucket = (overrides: Partial<BudgetBucket>): BudgetBucket =>
  ({
    id: 'bkt-groceries',
    name: 'Groceries',
    limit: 500,
    color: 'green',
    isVariable: true,
    isCore: true,
    ...overrides,
  }) as BudgetBucket;

const txItem = (overrides: Partial<TransactionQueueItem>): TransactionQueueItem =>
  ({
    queueType: 'transaction',
    id: 'tx-1',
    amount: 25,
    merchant: 'Coffee',
    category: 'Groceries',
    date: TODAY,
    status: 'pending_review',
    payPeriodId: '2026-07-01',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  }) as TransactionQueueItem;

const calItem = (overrides: Partial<CalendarQueueItem>): CalendarQueueItem =>
  ({
    queueType: 'calendar',
    id: 'cal-1',
    title: 'Electric bill',
    amount: 120,
    date: TODAY,
    type: 'expense',
    isPaid: false,
    ...overrides,
  }) as CalendarQueueItem;

const todoItem = (overrides: Partial<ToDoActionQueueItem>): ToDoActionQueueItem =>
  ({
    queueType: 'todo',
    id: 'todo-1',
    text: 'Buy milk',
    date: TODAY,
    assignedTo: 'uid-1',
    isCompleted: false,
    createdBy: 'uid-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }) as ToDoActionQueueItem;

const habit = (overrides: Partial<Habit>): Habit =>
  ({
    id: 'habit-1',
    title: 'Coffee run',
    category: 'Spending',
    type: 'negative',
    basePoints: -5,
    scoringType: 'incremental',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-07-01T00:00:00.000Z',
    triggers: { keywords: ['coffee'] },
    ...overrides,
  }) as Habit;

// --- Context wiring --------------------------------------------------------

const makeMutations = () => ({
  payCalendarItem: vi.fn(() => Promise.resolve()),
  deferCalendarItem: vi.fn(() => Promise.resolve()),
  deleteCalendarItem: vi.fn(() => Promise.resolve()),
  updateTransactionCategory: vi.fn(() => Promise.resolve()),
  reverseTransactionApproval: vi.fn(() => Promise.resolve()),
  updateTransaction: vi.fn(() => Promise.resolve()),
  deleteTransaction: vi.fn(() => Promise.resolve()),
  updateToDo: vi.fn(() => Promise.resolve()),
  deleteToDo: vi.fn(() => Promise.resolve()),
  completeToDo: vi.fn(() => Promise.resolve()),
});

type Mutations = ReturnType<typeof makeMutations>;
let mutations: Mutations;

const setMocks = (opts: {
  accounts?: Account[];
  buckets?: BudgetBucket[];
  transactions?: Transaction[];
  todos?: ToDo[];
  habits?: Habit[];
  calendar?: CalendarQueueItem[];
} = {}) => {
  vi.mocked(useFinance).mockReturnValue({
    accounts: opts.accounts ?? [account({})],
    buckets: opts.buckets ?? [bucket({})],
    transactions: opts.transactions ?? [],
    payCalendarItem: mutations.payCalendarItem,
    deferCalendarItem: mutations.deferCalendarItem,
    deleteCalendarItem: mutations.deleteCalendarItem,
    updateTransactionCategory: mutations.updateTransactionCategory,
    reverseTransactionApproval: mutations.reverseTransactionApproval,
    updateTransaction: mutations.updateTransaction,
    deleteTransaction: mutations.deleteTransaction,
  } as unknown as ReturnType<typeof useFinance>);

  vi.mocked(useTodos).mockReturnValue({
    todos: opts.todos ?? [],
    updateToDo: mutations.updateToDo,
    deleteToDo: mutations.deleteToDo,
    completeToDo: mutations.completeToDo,
  } as unknown as ReturnType<typeof useTodos>);

  vi.mocked(useHouseholdCore).mockReturnValue({
    members: [],
    currentUser: { uid: 'uid-1' },
    // Real `useMerchantRules` + `useFormatCurrency` read off this slice, so both
    // run through their production paths rather than a second mock.
    householdSettings: { merchantRules: [], currency: 'USD' },
    addMerchantRule: vi.fn(),
    updateMerchantRule: vi.fn(),
    deleteMerchantRule: vi.fn(),
  } as unknown as ReturnType<typeof useHouseholdCore>);

  vi.mocked(useGamification).mockReturnValue({
    habits: opts.habits ?? [],
  } as unknown as ReturnType<typeof useGamification>);

  vi.mocked(useExpandedCalendarItems).mockReturnValue(opts.calendar ?? []);

  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: () => true,
    isPlanVisible: true,
    isPlanTabVisible: () => true,
    isHomeVisible: true,
  });
};

/** The render function the last `toast(body, opts)` call was handed. */
type ToastBodyRenderer = (t: { id: string }) => ReactNode;
const lastToastBody = (): ToastBodyRenderer => {
  const call = [...toastMock.mock.calls].reverse().find(c => typeof c[0] === 'function');
  if (!call) throw new Error('No render-function toast was emitted');
  return call[0] as ToastBodyRenderer;
};

/** Render the captured undo toast and press its Undo button. */
const pressUndo = async (): Promise<void> => {
  render(<>{lastToastBody()({ id: 'toast-1' })}</>);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  });
};

beforeEach(() => {
  mutations = makeMutations();
  setMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useActionQueueTriage — handleSwipeApprove (transactions)', () => {
  it('tags a credit-account transaction with the CREDIT_CARD_CATEGORY sentinel, not a bucket', async () => {
    setMocks({
      accounts: [account({}), account({ id: 'acc-visa', name: 'Visa', type: 'credit' })],
      buckets: [bucket({ name: 'Groceries' })],
    });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(
        txItem({ accountId: 'acc-visa', category: 'Groceries' })
      );
    });

    expect(mutations.updateTransactionCategory).toHaveBeenCalledWith(
      'tx-1',
      CREDIT_CARD_CATEGORY,
      [],
      undefined
    );
  });

  it('gives a checking-account transaction the suggested bucket category', async () => {
    setMocks({
      accounts: [account({ id: 'acc-checking' })],
      buckets: [bucket({ name: 'Groceries' })],
    });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(
        txItem({ accountId: 'acc-checking', category: 'Groceries' })
      );
    });

    expect(mutations.updateTransactionCategory).toHaveBeenCalledWith(
      'tx-1',
      'Groceries',
      [],
      undefined
    );
    expect(mutations.updateTransactionCategory).not.toHaveBeenCalledWith(
      'tx-1',
      CREDIT_CARD_CATEGORY,
      expect.anything(),
      expect.anything()
    );
  });
});

describe('useActionQueueTriage — approve undo branch', () => {
  it('reverses atomically (reverseTransactionApproval) when habits fired', async () => {
    setMocks({
      accounts: [account({ id: 'acc-checking' })],
      buckets: [bucket({ name: 'Groceries' })],
      // Keyword "coffee" matches the merchant, and the habit has no completion
      // on this date, so the cross-source dedup leaves it in.
      habits: [habit({ id: 'habit-1', triggers: { keywords: ['coffee'] } })],
    });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(
        txItem({ accountId: 'acc-checking', category: 'Groceries' })
      );
    });

    // The habit really was requested — otherwise the undo branch below would be
    // exercising the "nothing fired" path while claiming to test the other one.
    expect(mutations.updateTransactionCategory).toHaveBeenCalledWith(
      'tx-1',
      'Groceries',
      ['habit-1'],
      undefined
    );

    await pressUndo();

    expect(toastMock.dismiss).toHaveBeenCalledWith('toast-1');
    expect(mutations.reverseTransactionApproval).toHaveBeenCalledWith(
      'tx-1',
      { category: 'Groceries', accountId: 'acc-checking', relatedHabitIds: [] },
      ['habit-1']
    );
    expect(mutations.updateTransaction).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('Moved back to review');
  });

  it('flips the status back with updateTransaction when no habits fired', async () => {
    setMocks({
      accounts: [account({ id: 'acc-checking' })],
      buckets: [bucket({ name: 'Groceries' })],
      habits: [],
    });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(
        txItem({ accountId: 'acc-checking', category: 'Groceries' })
      );
    });

    await pressUndo();

    expect(mutations.reverseTransactionApproval).not.toHaveBeenCalled();
    expect(mutations.updateTransaction).toHaveBeenCalledWith(
      'tx-1',
      { status: 'pending_review', category: 'Groceries', accountId: 'acc-checking' },
      { silent: true }
    );
  });

  it('clears an account tag the smart approve added, restoring the untagged prior state', async () => {
    // Verified history for the same merchant gives the smart approve an account
    // to add; the undo must CLEAR it (empty string ⇒ updateTransaction deletes
    // the field) rather than leave the guess behind.
    const history: Transaction = {
      id: 'tx-old',
      amount: 20,
      merchant: 'Coffee',
      category: 'Groceries',
      date: '2026-07-01',
      status: 'verified',
      accountId: 'acc-savings',
      isRecurring: false,
      source: 'manual',
      autoCategorized: false,
    } as Transaction;

    setMocks({
      accounts: [account({ id: 'acc-checking' }), account({ id: 'acc-savings', name: 'Savings', type: 'savings' })],
      buckets: [bucket({ name: 'Groceries' })],
      transactions: [history],
      habits: [],
    });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(txItem({ accountId: undefined }));
    });

    expect(mutations.updateTransactionCategory).toHaveBeenCalledWith(
      'tx-1',
      'Groceries',
      [],
      'acc-savings'
    );

    await pressUndo();

    expect(mutations.updateTransaction).toHaveBeenCalledWith(
      'tx-1',
      { status: 'pending_review', category: 'Groceries', accountId: '' },
      { silent: true }
    );
  });
});

describe('useActionQueueTriage — approveDetails', () => {
  it('discloses amount + target account for an approvable transaction but SKIPS a $0 needsAmount stub', () => {
    const approvable = txItem({ id: 'tx-1', amount: 25 });
    const stub = txItem({ id: 'tx-stub', amount: 0, needsAmount: true, merchant: 'Apple Pay' });
    setMocks({
      accounts: [account({ id: 'acc-checking', name: 'Joint Checking' })],
      transactions: [approvable as Transaction, stub as Transaction],
    });

    const { result } = renderHook(() => useActionQueueTriage());

    // Both rows really are in the queue — otherwise "no entry" would be
    // vacuously true for the stub.
    expect(result.current.actionQueue.map(i => i.id).sort()).toEqual(['tx-1', 'tx-stub']);
    expect(result.current.approveDetails.get('tx-1')).toBe('$25.00 → Joint Checking');
    expect(result.current.approveDetails.has('tx-stub')).toBe(false);
  });
});

describe('useActionQueueTriage — calendar approve', () => {
  it('falls back to the pay sheet when no payable account can be resolved', async () => {
    // Only a credit account exists: bills are never paid from credit, and there
    // is no checking account to fall back to.
    setMocks({ accounts: [account({ id: 'acc-visa', name: 'Visa', type: 'credit' })] });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(calItem({ id: 'cal-1', amount: 120 }));
    });

    expect(mutations.payCalendarItem).not.toHaveBeenCalled();
    expect(result.current.payModal).toEqual({ id: 'cal-1', amount: 120 });
  });

  it('pays from the smart-guessed account when one resolves', async () => {
    setMocks({ accounts: [account({ id: 'acc-checking', name: 'Joint Checking' })] });
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeApprove(calItem({ id: 'cal-1', amount: 120 }));
    });

    expect(mutations.payCalendarItem).toHaveBeenCalledWith('cal-1', 'acc-checking', { silent: true });
    expect(result.current.payModal).toBeNull();
  });
});

describe('useActionQueueTriage — openPaySheet delegation', () => {
  it('drives the hook’s own payModal when no onOpenPaySheet is supplied', () => {
    const { result } = renderHook(() => useActionQueueTriage());

    act(() => result.current.openPaySheet('cal-1', 120));

    expect(result.current.payModal).toEqual({ id: 'cal-1', amount: 120 });
  });

  it('hands the sheet to onOpenPaySheet and leaves payModal null', () => {
    const onOpenPaySheet = vi.fn();
    const { result } = renderHook(() => useActionQueueTriage({ onOpenPaySheet }));

    act(() => result.current.openPaySheet('cal-1', 120));

    expect(onOpenPaySheet).toHaveBeenCalledWith('cal-1', 120);
    // A second consumer renders its OWN AccountPicker — setting payModal here
    // too would mount a duplicate one.
    expect(result.current.payModal).toBeNull();
  });

  it('routes the calendar swipe fallback through the delegate as well', async () => {
    const onOpenPaySheet = vi.fn();
    setMocks({ accounts: [account({ id: 'acc-visa', name: 'Visa', type: 'credit' })] });
    const { result } = renderHook(() => useActionQueueTriage({ onOpenPaySheet }));

    await act(async () => {
      await result.current.handleSwipeApprove(calItem({ id: 'cal-1', amount: 120 }));
    });

    expect(onOpenPaySheet).toHaveBeenCalledWith('cal-1', 120);
    expect(result.current.payModal).toBeNull();
  });
});

describe('useActionQueueTriage — handleSwipeDefer', () => {
  it('snoozes a pending transaction to tomorrow', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-15T12:00:00') });
    setMocks();
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeDefer(txItem({ id: 'tx-1', date: '2026-07-13' }));
    });

    expect(mutations.updateTransaction).toHaveBeenCalledWith(
      'tx-1',
      { reviewSnoozedUntil: '2026-07-16' },
      { silent: true }
    );
    expect(mutations.deferCalendarItem).not.toHaveBeenCalled();
  });

  it('routes a calendar item to deferCalendarItem', async () => {
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeDefer(calItem({ id: 'cal-1' }));
    });

    expect(mutations.deferCalendarItem).toHaveBeenCalledWith('cal-1');
    expect(mutations.updateTransaction).not.toHaveBeenCalled();
  });

  it('pushes a to-do forward via updateToDo', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-15T12:00:00') });
    setMocks();
    const { result } = renderHook(() => useActionQueueTriage());

    await act(async () => {
      await result.current.handleSwipeDefer(todoItem({ id: 'todo-1', date: '2026-07-13' }));
    });

    expect(mutations.updateToDo).toHaveBeenCalledWith('todo-1', { completeByDate: '2026-07-16' });
    expect(mutations.updateTransaction).not.toHaveBeenCalled();
  });
});
