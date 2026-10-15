import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Account, BudgetBucket, CalendarItem, HalfPlan, Transaction } from '@/types/schema';
import PayPeriodSheet from './PayPeriodSheet';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';

vi.mock('@/contexts/FirebaseHouseholdContext', async () => {
  const { expandCalendarItems } = await vi.importActual<typeof import('@/utils/calendarRecurrence')>('@/utils/calendarRecurrence');
  const fn = vi.fn();
  return {
    useFinance: fn,
    useHouseholdCore: fn,
    useExpandedCalendarItems: (start: Date, end: Date) => {
      const { calendarItems } = fn() as { calendarItems: CalendarItem[] };
      return expandCalendarItems(calendarItems, start, end);
    },
  };
});
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `$${n.toFixed(2)}`,
}));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('@/utils/dateHelpers', async () => ({
  ...(await vi.importActual<object>('@/utils/dateHelpers')),
  getLocalDateString: () => '2026-10-08',
}));

const paycheck: CalendarItem = {
  id: 'pay',
  title: 'Paycheck',
  amount: 2851.5,
  date: '2026-01-01',
  type: 'income',
  isPaid: false,
  isRecurring: true,
  frequency: 'semi-monthly',
  semiMonthlyDays: [1, 16],
  weekendShift: 'before',
  earnerId: 'jen',
};
const mortgage: CalendarItem = {
  id: 'mortgage',
  title: 'Mortgage',
  amount: 2166,
  date: '2026-01-01',
  type: 'expense',
  isPaid: false,
  isRecurring: true,
  frequency: 'monthly',
};
const accounts: Account[] = [
  { id: 'chk', name: 'Checking', type: 'checking', balance: 3000, lastUpdated: '' },
  { id: 'sav', name: 'Savings', type: 'savings', balance: 9000, lastUpdated: '' },
];
const buckets = [{ id: 'grocery', name: 'Groceries', limit: 850, color: 'green', isVariable: true, isCore: true }] satisfies BudgetBucket[];

const saveHalfPlan = vi.fn().mockResolvedValue(undefined);
const setAllocationDone = vi.fn().mockResolvedValue(undefined);
const setOccurrenceAmount = vi.fn().mockResolvedValue(undefined);
const payCalendarItem = vi.fn().mockResolvedValue(undefined);
const editCalendarEntry = vi.fn().mockResolvedValue(undefined);
const deleteCalendarItem = vi.fn().mockResolvedValue(undefined);

function setup(halfPlans: HalfPlan[] = [], transactions: Transaction[] = []) {
  vi.mocked(useFinance).mockReturnValue({
    calendarItems: [paycheck, mortgage],
    halfPlans,
    transactions,
    buckets,
    accounts,
    defaultAccountId: undefined,
    safeToSpend: 1234,
    members: [{ uid: 'jen', displayName: 'Jen' }],
    saveHalfPlan,
    setAllocationDone,
    setOccurrenceAmount,
    payCalendarItem,
    updateCalendarItem: vi.fn(),
    addCalendarItem: vi.fn(),
    editCalendarEntry,
    deleteCalendarItem,
  } as unknown as ReturnType<typeof useFinance>);
  render(<PayPeriodSheet />);
}

describe('PayPeriodSheet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the current half: paycheck at the top, bills on their days, Left to assign', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Oct 1 – 15' })).toBeInTheDocument();
    expect(screen.getByText(/Jen/)).toBeInTheDocument();
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByTestId('left-to-assign')).toHaveTextContent('$685.50');
    expect(screen.getByText(/Safe-to-Spend right now/)).toBeInTheDocument();
  });

  it('steps to the next half, which starts the Friday before a weekend payday', () => {
    setup();
    fireEvent.click(screen.getByLabelText('Next half'));
    expect(screen.getByRole('heading', { name: 'Oct 16 – 29' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next half'));
    expect(screen.getByRole('heading', { name: 'Oct 30 – Nov 15' })).toBeInTheDocument();
    expect(screen.getByText(/November · 1st pay period/)).toBeInTheDocument();
  });

  it('saves a planned budget typed into its cell', async () => {
    setup();
    const cell = screen.getByLabelText('Groceries planned for this half');
    fireEvent.change(cell, { target: { value: '850' } });
    fireEvent.blur(cell);
    await waitFor(() =>
      expect(saveHalfPlan).toHaveBeenCalledWith(expect.objectContaining({ id: '2026-10-01', budgets: { grocery: 850 } }))
    );
  });

  it('sends what is left to savings in one tap', async () => {
    setup();
    fireEvent.click(screen.getByText('Send $685.50 to savings'));
    await waitFor(() =>
      expect(saveHalfPlan).toHaveBeenCalledWith(
        expect.objectContaining({ allocations: [expect.objectContaining({ kind: 'to-savings', amount: 685.5 })] })
      )
    );
  });

  it('checks a saved allocation off through the transfer mutation', () => {
    const plan: HalfPlan = { id: '2026-10-01', budgets: {}, allocations: [{ id: 's', kind: 'to-savings', label: 'Leftover to savings', amount: 685.5 }] };
    setup([plan]);
    expect(screen.getByTestId('left-to-assign')).toHaveTextContent('$0.00');
    fireEvent.click(screen.getByLabelText('Mark Leftover to savings done'));
    expect(setAllocationDone).toHaveBeenCalledWith(plan, 's', true);
  });

  it('asks which months a recurring bill change applies to', async () => {
    setup();
    const cell = screen.getByLabelText('Mortgage amount');
    fireEvent.change(cell, { target: { value: '2200' } });
    fireEvent.blur(cell);
    fireEvent.click(await screen.findByText('Just October'));
    await waitFor(() => expect(setOccurrenceAmount).toHaveBeenCalledWith('mortgage_instance_2026-10-01', 2200));
  });
});

describe('editing rows', () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the section's Add at the top of the list, ready to type", () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const name = screen.getByLabelText('New bill name');
    expect(name).toHaveFocus();
    // Above the first bill, not after the last one.
    expect(name.compareDocumentPosition(screen.getByText('Mortgage')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("taps a row's name to rename it or move this month's to another date", async () => {
    setup();
    fireEvent.click(screen.getByLabelText('Edit Mortgage'));
    expect(screen.getByText(/a new date moves just October's/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-03' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(editCalendarEntry).toHaveBeenCalledWith('mortgage_instance_2026-10-01', { date: '2026-10-03' })
    );
  });

  it("deletes just this month's occurrence", async () => {
    setup();
    fireEvent.click(screen.getByLabelText('Edit Mortgage'));
    fireEvent.click(screen.getByRole('button', { name: "Delete October's" }));
    await waitFor(() => expect(deleteCalendarItem).toHaveBeenCalledWith('mortgage_instance_2026-10-01'));
  });
});

describe('overspending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows what a budget spent and offers to cover an overrun from savings', async () => {
    const plan: HalfPlan = { id: '2026-10-01', budgets: { grocery: 400 }, allocations: [] };
    const groceries = { id: 't1', date: '2026-10-05', category: 'Groceries', amount: 450, merchant: 'Lunds', status: 'verified' } as Transaction;
    setup([plan], [groceries]);
    expect(screen.getByText('$450.00 spent')).toBeInTheDocument();
    expect(screen.getByText(/Groceries is \$50.00 over/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cover from savings' }));
    await waitFor(() =>
      expect(saveHalfPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          budgets: { grocery: 450 },
          allocations: [expect.objectContaining({ kind: 'from-savings', amount: 50 })],
        })
      )
    );
  });
});

describe('MoneyCell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows grouped cents at rest and puts the old value back on Escape', () => {
    setup();
    const cell = screen.getByLabelText('Mortgage amount');
    expect(cell).toHaveValue('2,166.00');
    fireEvent.focus(cell);
    expect(cell).toHaveValue('2166');
    fireEvent.change(cell, { target: { value: '9999' } });
    fireEvent.keyDown(cell, { key: 'Escape' });
    fireEvent.blur(cell);
    expect(cell).toHaveValue('2,166.00');
    expect(setOccurrenceAmount).not.toHaveBeenCalled();
    expect(screen.queryByText('Just October')).not.toBeInTheDocument();
  });
});
