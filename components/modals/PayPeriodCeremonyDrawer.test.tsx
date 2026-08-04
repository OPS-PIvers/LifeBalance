import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PayPeriodCeremonyDrawer from './PayPeriodCeremonyDrawer';
import { type Account, type BudgetBucket, type BucketPeriodSnapshot } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type PayPeriodCeremonyEvent } from '@/utils/payPeriodCeremony';

const mockUseHousehold = vi.fn();
const saveCeremonyChanges = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useHouseholdCore: value,
  };
});

// Passthrough Drawer so the test sees the body + the footer buttons.
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({
    isOpen,
    title,
    header,
    footer,
    children,
  }: {
    isOpen: boolean;
    title?: string;
    header?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="drawer">
        {title && <h2>{title}</h2>}
        {header}
        {children}
        {footer}
      </div>
    ) : null,
}));

const bucket = (id: string, name: string, limit: number): BudgetBucket => ({
  id,
  name,
  limit,
  color: 'green',
  isVariable: true,
  isCore: false,
});

const account = (over: Partial<Account> & { id: string; balance: number }): Account => ({
  name: over.id,
  type: 'checking',
  lastUpdated: '2026-08-01T00:00:00.000Z',
  ...over,
});

const event: PayPeriodCeremonyEvent = {
  kind: 'roll',
  previousPeriodId: '2026-07-17',
  newPeriodId: '2026-07-31',
  paycheckTitle: 'Paycheck',
  paycheckAmount: 2100,
};

const snapshot = (
  over: Partial<BucketPeriodSnapshot> & { id: string; bucketId: string },
): BucketPeriodSnapshot => ({
  bucketName: over.bucketId,
  periodId: '2026-07-17',
  periodStartDate: '2026-07-17',
  periodEndDate: '2026-07-30',
  limit: 100,
  totalSpent: 0,
  totalPending: 0,
  transactionCount: 0,
  createdAt: '2026-07-31T00:00:00.000Z',
  ...over,
});

const setFinance = (config?: {
  buckets?: BudgetBucket[];
  accounts?: Account[];
  bucketHistory?: BucketPeriodSnapshot[];
  bucketSpentMap?: Map<string, BucketSpent>;
  safeToSpend?: number;
}) => {
  mockUseHousehold.mockReturnValue({
    accounts: config?.accounts ?? [account({ id: 'chk', name: 'Checking', balance: 1000 })],
    buckets: config?.buckets ?? [bucket('b1', 'Groceries', 300)],
    bucketHistory: config?.bucketHistory ?? [],
    bucketSpentMap: config?.bucketSpentMap ?? new Map(),
    safeToSpend: config?.safeToSpend ?? 500,
    saveCeremonyChanges,
    householdSettings: { currency: 'USD' },
  });
};

const renderDrawer = () =>
  render(<PayPeriodCeremonyDrawer event={event} isOpen onClose={vi.fn()} />);

const saveButton = () => screen.getByRole('button', { name: 'Save changes' });
// PayPeriodCeremonyDrawer mounts BucketPlanEditor with idPrefix="ceremony",
// so its testid is namespaced to match (BucketPlanEditor.tsx ~line 177) —
// keeps this apart from a second mounted editor (e.g. a rebalance drawer)
// using BucketPlanEditor's own default `bucket-plan` prefix.
const meter = () => screen.getByTestId('ceremony-meter');

beforeEach(() => {
  vi.clearAllMocks();
  saveCeremonyChanges.mockResolvedValue(undefined);
  setFinance();
});

describe('PayPeriodCeremonyDrawer — existing behaviour', () => {
  it('prefills each bucket field with its carried-over limit', () => {
    setFinance({ buckets: [bucket('b1', 'Groceries', 300), bucket('b2', 'Gas', 120)] });
    renderDrawer();

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(300);
    expect(screen.getByLabelText('Gas budget for this period')).toHaveValue(120);
  });

  it('offers the 3-period-average suggestion and applies it to the field', async () => {
    const user = userEvent.setup();
    setFinance({
      buckets: [bucket('b1', 'Groceries', 300)],
      bucketHistory: [
        snapshot({ id: 's1', bucketId: 'b1', periodId: '2026-07-17', totalSpent: 201 }),
        snapshot({ id: 's2', bucketId: 'b1', periodId: '2026-07-03', totalSpent: 199 }),
      ],
    });
    renderDrawer();

    // avg(201, 199) = 200 → rounds UP to the nearest $5 → 200.
    const chip = screen.getByRole('button', { name: /Suggested: \$200/ });
    await user.click(chip);

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(200);
  });

  it('writes nothing when no draft changed (Save stays disabled)', () => {
    renderDrawer();
    expect(saveButton()).toBeDisabled();
  });

  it('saves only the CHANGED limits and balances in one call', async () => {
    const user = userEvent.setup();
    setFinance({
      buckets: [bucket('b1', 'Groceries', 300), bucket('b2', 'Gas', 120)],
      accounts: [
        account({ id: 'chk', name: 'Checking', balance: 1000 }),
        account({ id: 'sav', name: 'Savings', balance: 5000, type: 'savings' }),
      ],
    });
    renderDrawer();

    const groceries = screen.getByLabelText('Groceries budget for this period');
    await user.clear(groceries);
    await user.type(groceries, '250');

    const checking = screen.getByLabelText('Checking balance');
    await user.clear(checking);
    await user.type(checking, '1200');

    await user.click(saveButton());

    expect(saveCeremonyChanges).toHaveBeenCalledTimes(1);
    expect(saveCeremonyChanges).toHaveBeenCalledWith({
      // Gas and Savings were untouched, so neither appears.
      bucketLimits: [{ id: 'b1', limit: 250 }],
      accountBalances: [{ id: 'chk', balance: 1200 }],
    });
  });

  it('disables Save while a limit field holds unparseable text', async () => {
    const user = userEvent.setup();
    renderDrawer();

    const groceries = screen.getByLabelText('Groceries budget for this period');
    await user.clear(groceries);
    await user.type(groceries, '-5');

    expect(saveButton()).toBeDisabled();
  });
});

describe('PayPeriodCeremonyDrawer — fit meter', () => {
  it('measures the plan against Safe-to-Spend', () => {
    setFinance({ buckets: [bucket('b1', 'Groceries', 300)], safeToSpend: 500 });
    renderDrawer();

    expect(meter()).toHaveTextContent('$300.00 of $500.00');
    expect(meter()).toHaveTextContent('$200.00 left unplanned');
  });

  it('folds an UNSAVED checking-balance edit into the available cash', async () => {
    const user = userEvent.setup();
    setFinance({
      buckets: [bucket('b1', 'Groceries', 600)],
      accounts: [account({ id: 'chk', name: 'Checking', balance: 1000 })],
      safeToSpend: 500,
    });
    renderDrawer();

    expect(meter()).toHaveTextContent('Short by $100.00');

    // Typing a higher balance (nothing written yet) must move the meter.
    const checking = screen.getByLabelText('Checking balance');
    await user.clear(checking);
    await user.type(checking, '1300');

    expect(meter()).toHaveTextContent('$600.00 of $800.00');
    expect(meter()).toHaveTextContent('$200.00 left unplanned');
  });

  it('does NOT move the available cash for an unsaved SAVINGS edit', async () => {
    const user = userEvent.setup();
    setFinance({
      buckets: [bucket('b1', 'Groceries', 600)],
      accounts: [
        account({ id: 'chk', name: 'Checking', balance: 1000 }),
        account({ id: 'sav', name: 'Savings', balance: 5000, type: 'savings' }),
      ],
      safeToSpend: 500,
    });
    renderDrawer();

    const savings = screen.getByLabelText('Savings balance');
    await user.clear(savings);
    await user.type(savings, '9000');

    expect(meter()).toHaveTextContent('$600.00 of $500.00');
    expect(meter()).toHaveTextContent('Short by $100.00');
  });

  /**
   * THE NEVER-BLOCK RULE. The ceremony is the one screen where balances are
   * half-entered, so the projected cash is unsettled by design — trapping the
   * user behind a number that is still mid-edit would be worse than the
   * over-allocation. The meter informs; the user decides. If a later change
   * disables Save (or interposes a confirm dialog) while over-allocated, this
   * test is what should fail.
   */
  it('still saves an over-allocated plan — no disabled Save, no confirm dialog', async () => {
    const user = userEvent.setup();
    setFinance({ buckets: [bucket('b1', 'Groceries', 300)], safeToSpend: 100 });
    renderDrawer();

    const groceries = screen.getByLabelText('Groceries budget for this period');
    await user.clear(groceries);
    await user.type(groceries, '900');

    // The plan is plainly over-allocated…
    expect(meter()).toHaveTextContent('Short by $800.00');
    // …and Save is nonetheless live.
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());

    // One click, one write — nothing interposed a confirmation step.
    expect(saveCeremonyChanges).toHaveBeenCalledTimes(1);
    expect(saveCeremonyChanges).toHaveBeenCalledWith({
      bucketLimits: [{ id: 'b1', limit: 900 }],
      accountBalances: [],
    });
  });
});
