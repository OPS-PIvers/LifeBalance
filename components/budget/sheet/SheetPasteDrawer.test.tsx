import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { parseISO } from 'date-fns';
import type { Account, BudgetBucket, CalendarItem } from '@/types/schema';
import { expandCalendarItems } from '@/utils/calendarRecurrence';
import { buildPayHalves } from '@/utils/payPeriodHalves';
import { OCTOBER_SHEET_PASTE } from '@/utils/sheetPaste.fixture';
import SheetPasteDrawer from './SheetPasteDrawer';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({ useFinance: vi.fn() }));
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`,
}));
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, title, footer, children }: { isOpen: boolean; title?: string; footer?: React.ReactNode; children: React.ReactNode }) =>
    isOpen ? (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ) : null,
}));

const paycheck: CalendarItem = {
  id: 'pay', title: 'Paycheck', amount: 2851.5, date: '2026-01-01', type: 'income', isPaid: false,
  isRecurring: true, frequency: 'semi-monthly', semiMonthlyDays: [1, 16], weekendShift: 'before',
};
const paycheck2: CalendarItem = { ...paycheck, id: 'pay2' };
// Already in the app: the mortgage at the same amount, Comcast at a different one.
const mortgage: CalendarItem = {
  id: 'mortgage', title: 'Mortgage', amount: 2166, date: '2026-01-01', type: 'expense', isPaid: false,
  isRecurring: true, frequency: 'monthly',
};
const comcast: CalendarItem = { ...mortgage, id: 'comcast', title: 'Comcast', amount: 150, date: '2026-01-17' };
const items = [paycheck, paycheck2, mortgage, comcast];
const expanded = expandCalendarItems(items, parseISO('2026-09-20'), parseISO('2026-11-20'));
const halves = buildPayHalves(expanded, items).flatMap(h =>
  h.end && h.id.startsWith('2026-10') ? [{ ...h, end: h.end }] : []
);
const buckets: BudgetBucket[] = [
  { id: 'gas', name: 'Gas', limit: 0, color: 'orange', isVariable: true, isCore: true },
  { id: 'groc', name: 'Groceries', limit: 0, color: 'green', isVariable: true, isCore: true },
  { id: 'care', name: 'Childcare', limit: 0, color: 'blue', isVariable: true, isCore: true },
];
const accounts: Account[] = [{ id: 'amex', name: 'AmEx', type: 'credit', balance: 0, lastUpdated: '' }];
const importSheetMonth = vi.fn().mockResolvedValue(undefined);

describe('SheetPasteDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useFinance).mockReturnValue({
      buckets, accounts, halfPlans: [], importSheetMonth,
    } as unknown as ReturnType<typeof useFinance>);
  });

  it('previews October against what the app has, landing on the sheet\'s own remainders', () => {
    render(<SheetPasteDrawer isOpen onClose={vi.fn()} month="2026-10" halves={halves} expanded={expanded} />);
    fireEvent.change(screen.getByLabelText('Pasted sheet'), { target: { value: OCTOBER_SHEET_PASTE } });

    // The mortgage is already there, so it isn't offered as new.
    expect(screen.queryByLabelText('Add Mortgage on 2026-10-01')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Add Jen Hair on 2026-10-05')).toBeChecked();
    expect(screen.getByText(/Change to the sheet's \$158.00 for October only/)).toBeInTheDocument();

    // Same figures as the sheet's "1st half Remainder" and "2nd half Remainder".
    expect(screen.getByText('-$452.89')).toBeInTheDocument();
    expect(screen.getByText('$150.57')).toBeInTheDocument();
  });

  it('imports new bills, the changed amount and both halves\' plans in one call', async () => {
    const onClose = vi.fn();
    render(<SheetPasteDrawer isOpen onClose={onClose} month="2026-10" halves={halves} expanded={expanded} />);
    fireEvent.change(screen.getByLabelText('Pasted sheet'), { target: { value: OCTOBER_SHEET_PASTE } });
    fireEvent.click(screen.getByLabelText('Add Stella bday gift on 2026-10-02'));
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => expect(importSheetMonth).toHaveBeenCalledTimes(1));
    const [data] = importSheetMonth.mock.calls[0] ?? [];
    // 31 dated bills, minus the mortgage and Comcast (already there) and the unticked gift.
    expect(data.newBills).toHaveLength(28);
    expect(data.newBills).not.toContainEqual(expect.objectContaining({ title: 'Stella bday gift' }));
    expect(data.amountChanges).toEqual([{ item: expect.objectContaining({ id: 'comcast_instance_2026-10-17' }), amount: 158 }]);
    expect(data.plans.map((p: { id: string }) => p.id)).toEqual(['2026-10-01', '2026-10-16']);
    expect(data.plans[0].budgets).toEqual({ gas: 120, groc: 850 });
    expect(data.plans[0].allocations).toEqual([expect.objectContaining({ kind: 'card-extra', amount: 700, accountId: 'amex' })]);
    expect(data.plans[1].budgets).toEqual({ gas: 110, groc: 850, care: 400 });
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps a line with no matching budget in the totals as an Other line', () => {
    vi.mocked(useFinance).mockReturnValue({
      buckets: buckets.filter(b => b.id !== 'care'), accounts, halfPlans: [], importSheetMonth,
    } as unknown as ReturnType<typeof useFinance>);
    render(<SheetPasteDrawer isOpen onClose={vi.fn()} month="2026-10" halves={halves} expanded={expanded} />);
    fireEvent.change(screen.getByLabelText('Pasted sheet'), { target: { value: OCTOBER_SHEET_PASTE } });
    expect(screen.getByLabelText('Childcare goes to')).toHaveValue('alloc:other');
    expect(screen.getByText('$150.57')).toBeInTheDocument();
  });

  it('lets an Other Expenses line be pointed somewhere else', () => {
    render(<SheetPasteDrawer isOpen onClose={vi.fn()} month="2026-10" halves={halves} expanded={expanded} />);
    fireEvent.change(screen.getByLabelText('Pasted sheet'), { target: { value: OCTOBER_SHEET_PASTE } });
    const [firstGas] = screen.getAllByLabelText('Gas goes to');
    expect(firstGas).toHaveValue('bucket:gas');
    fireEvent.change(firstGas!, { target: { value: 'skip' } });
    expect(within(firstGas!.closest('div')!).getByText('$120.00')).toHaveClass('line-through');
  });
});
