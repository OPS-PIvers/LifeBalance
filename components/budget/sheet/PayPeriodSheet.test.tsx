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
let wide = false;
let extraItems: CalendarItem[] = [];
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => wide }));
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
  semiMonthlyDays: [15, 31],
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
const addCalendarItem = vi.fn().mockResolvedValue(undefined);

function setup(halfPlans: HalfPlan[] = [], transactions: Transaction[] = [], isWide = false) {
  wide = isWide;
  vi.mocked(useFinance).mockReturnValue({
    calendarItems: [paycheck, mortgage, ...extraItems],
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
    addCalendarItem,
    editCalendarEntry,
    deleteCalendarItem,
  } as unknown as ReturnType<typeof useFinance>);
  render(<PayPeriodSheet />);
}

const change = (el: HTMLElement, value: string) => {
  fireEvent.focus(el);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

describe('PayPeriodSheet on a phone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extraItems = [];
  });

  it('pins the paycheck at the top, lists the due days, and pins the remainder', () => {
    setup();
    expect(screen.getByText('Paycheck · Oct 1 – 15')).toBeInTheDocument();
    expect(screen.getByTestId('paycheck-total')).toHaveTextContent('$2851.50');
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('+ Add to the 1st')).toBeInTheDocument();
    // Every day with nothing due collapses into one line.
    expect(screen.getByText('Oct 2–15 · nothing due')).toBeInTheDocument();
    expect(screen.getByTestId('left-to-assign')).toHaveTextContent('+$685.50');
    // Safe-to-Spend is its own figure, never merged into the remainder.
    expect(screen.getByText(/Safe-to-Spend now/)).toHaveTextContent('$1234.00');
  });

  it('switches halves, each with the paycheck that funds it', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Oct 1–15' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Oct 16–31' }));
    expect(screen.getByText('Paycheck · Oct 16 – 31')).toBeInTheDocument();
    expect(screen.queryByText(/Safe-to-Spend now/)).not.toBeInTheDocument();
    // Sat Oct 31 is paid Fri Oct 30 and funds November's first half.
    fireEvent.click(screen.getByRole('button', { name: 'Nov 1–15' }));
    fireEvent.click(screen.getByRole('button', { name: /Paycheck · Nov 1 – 15/ }));
    expect(screen.getByRole('button', { name: /Paycheck, \$2851\.50/ })).toBeInTheDocument();
  });

  it('asks which months a repeating bill change applies to', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Mortgage, \$2166\.00/ }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Just October' }));
    await waitFor(() => expect(setOccurrenceAmount).toHaveBeenCalledWith('mortgage_instance_2026-10-01', 2200));
  });

  it("renames a row, or deletes just this month's", async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Mortgage, / }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'House' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(editCalendarEntry).toHaveBeenCalledWith('mortgage_instance_2026-10-01', { title: 'House' })
    );
    fireEvent.click(screen.getByRole('button', { name: /^Mortgage, / }));
    fireEvent.click(await screen.findByRole('button', { name: "Delete October's" }));
    await waitFor(() => expect(deleteCalendarItem).toHaveBeenCalledWith('mortgage_instance_2026-10-01'));
  });

  it('saves a one-off bill\'s new name, date and amount in one write', async () => {
    extraItems = [{ id: 'gift', title: 'Gift', amount: 40, date: '2026-10-02', type: 'expense', isPaid: false }];
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Gift, / }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stella bday gift' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '42.18' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(editCalendarEntry).toHaveBeenCalledWith('gift', { title: 'Stella bday gift', date: '2026-10-03', amount: 42.18 })
    );
    expect(editCalendarEntry).toHaveBeenCalledTimes(1);
  });

  it('renames a repeating bill after its new amount, so neither write is lost', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /^Mortgage, / }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'House' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(editCalendarEntry).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Just October' }));
    await waitFor(() =>
      expect(editCalendarEntry).toHaveBeenCalledWith('mortgage_instance_2026-10-01', { title: 'House' })
    );
    expect(setOccurrenceAmount).toHaveBeenCalledWith('mortgage_instance_2026-10-01', 2200);
    expect(setOccurrenceAmount.mock.invocationCallOrder[0]).toBeLessThan(editCalendarEntry.mock.invocationCallOrder[0] ?? 0);
  });

  it('adds a bill to a day', async () => {
    setup();
    fireEvent.click(screen.getByText('+ Add to the 1st'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Water' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '36.56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(addCalendarItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Water', amount: 36.56, date: '2026-10-01', type: 'expense' })
      )
    );
  });

  it('sends what is left to savings in one tap', async () => {
    setup();
    fireEvent.click(screen.getByText('Send to savings'));
    await waitFor(() =>
      expect(saveHalfPlan).toHaveBeenCalledWith(
        expect.objectContaining({ allocations: [expect.objectContaining({ kind: 'to-savings', amount: 685.5 })] })
      )
    );
  });

  it('checks an allocation off through the transfer mutation', () => {
    const plan: HalfPlan = { id: '2026-10-01', budgets: {}, allocations: [{ id: 's', kind: 'to-savings', label: 'Leftover to savings', amount: 685.5 }] };
    setup([plan]);
    expect(screen.getByTestId('left-to-assign')).toHaveTextContent('$0.00');
    fireEvent.click(screen.getByRole('button', { name: /Leftover to savings/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    expect(setAllocationDone).toHaveBeenCalledWith(plan, 's', true);
  });

  it('flags an overspent budget and covers it from savings', async () => {
    const plan: HalfPlan = { id: '2026-10-01', budgets: { grocery: 400 }, allocations: [] };
    const groceries = { id: 't1', date: '2026-10-05', category: 'Groceries', amount: 450, merchant: 'Lunds', status: 'verified' } as Transaction;
    setup([plan], [groceries]);
    expect(screen.getByText('$450.00 spent, over budget')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
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

describe('PayPeriodSheet on a wide screen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the month as two halves, a row for every day, and the month net', () => {
    setup([], [], true);
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument();
    expect(screen.getAllByText('Paycheck')).toHaveLength(2);
    expect(screen.getByRole('table', { name: '1st half · Oct 1 – 15' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '2nd half · Oct 16 – 31' })).toBeInTheDocument();
    // Empty days still get a row to type into.
    expect(screen.getByLabelText('New bill on the 2nd')).toBeInTheDocument();
    expect(screen.getByLabelText('New bill on the 31st')).toBeInTheDocument();
    const [first, second] = screen.getAllByTestId('left-to-assign');
    expect(first).toHaveTextContent('+$685.50');
    expect(second).toHaveTextContent('+$2851.50');
    expect(screen.getByTestId('month-net')).toHaveTextContent('+$3537.00');
  });

  it('steps a month at a time', () => {
    setup([], [], true);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument();
  });

  it('saves a planned budget typed into its cell', async () => {
    setup([{ id: '2026-10-01', budgets: { grocery: 0 }, allocations: [] }], [], true);
    // The 2nd half starts as a copy of the 1st; type into the 1st's cell.
    change(screen.getAllByLabelText('Groceries planned for this half')[0] as HTMLElement, '850');
    await waitFor(() =>
      expect(saveHalfPlan).toHaveBeenCalledWith(expect.objectContaining({ id: '2026-10-01', budgets: { grocery: 850 } }))
    );
  });

  it('asks which months a repeating bill change applies to', async () => {
    setup([], [], true);
    change(screen.getByLabelText('Mortgage amount'), '2200');
    fireEvent.click(await screen.findByRole('button', { name: 'Just October' }));
    await waitFor(() => expect(setOccurrenceAmount).toHaveBeenCalledWith('mortgage_instance_2026-10-01', 2200));
  });

  it('pays a bill when its actual amount is typed in', () => {
    setup([], [], true);
    change(screen.getByLabelText('Mortgage actual'), '2150');
    expect(payCalendarItem).toHaveBeenCalledWith('mortgage_instance_2026-10-01', 'chk', { actualAmount: 2150 });
  });

  it('adds a row on the same day with Enter, and saves what is typed into it', async () => {
    setup([], [], true);
    fireEvent.keyDown(screen.getByLabelText('Mortgage name'), { key: 'Enter' });
    const rows = screen.getAllByLabelText('New bill on the 1st');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveFocus();
    fireEvent.change(rows[0] as HTMLElement, { target: { value: 'Parkway' } });
    // Rounded to cents like every other amount entry.
    fireEvent.change(screen.getByLabelText('New bill on the 1st amount'), { target: { value: '80.004' } });
    fireEvent.keyDown(screen.getByLabelText('New bill on the 1st amount'), { key: 'Enter' });
    await waitFor(() =>
      expect(addCalendarItem).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Parkway', amount: 80, date: '2026-10-01', type: 'expense' })
      )
    );
  });

  it('adds a typed bill once, even when Enter is followed by leaving the row', async () => {
    let finish: () => void = () => undefined;
    addCalendarItem.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    setup([], [], true);
    fireEvent.change(screen.getByLabelText('New bill on the 12th'), { target: { value: 'Gift' } });
    const amount = screen.getByLabelText('New bill on the 12th amount');
    fireEvent.change(amount, { target: { value: '40' } });
    fireEvent.keyDown(amount, { key: 'Enter' });
    fireEvent.focusOut(amount);
    finish();
    await waitFor(() => expect(addCalendarItem).toHaveBeenCalledTimes(1));
  });

  it('adds a bill on an empty day by typing into its row', async () => {
    setup([], [], true);
    fireEvent.change(screen.getByLabelText('New bill on the 13th'), { target: { value: 'Spotify' } });
    fireEvent.change(screen.getByLabelText('New bill on the 13th amount'), { target: { value: '22' } });
    fireEvent.keyDown(screen.getByLabelText('New bill on the 13th amount'), { key: 'Enter' });
    await waitFor(() =>
      expect(addCalendarItem).toHaveBeenCalledWith(expect.objectContaining({ title: 'Spotify', amount: 22, date: '2026-10-13' }))
    );
  });
});

describe('MoneyCell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows dollars at rest and puts the old value back on Escape', () => {
    setup([], [], true);
    const cell = screen.getByLabelText('Mortgage amount');
    expect(cell).toHaveValue('$2,166.00');
    fireEvent.focus(cell);
    expect(cell).toHaveValue('2166');
    fireEvent.change(cell, { target: { value: '9999' } });
    fireEvent.keyDown(cell, { key: 'Escape' });
    fireEvent.blur(cell);
    expect(cell).toHaveValue('$2,166.00');
    expect(setOccurrenceAmount).not.toHaveBeenCalled();
    expect(screen.queryByText('Just October')).not.toBeInTheDocument();
  });
});
