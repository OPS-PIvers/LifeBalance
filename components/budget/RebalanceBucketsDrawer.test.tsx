import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import RebalanceBucketsDrawer from './RebalanceBucketsDrawer';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type BucketPeriodSnapshot, type BudgetBucket } from '@/types/schema';

// The drawer reads useFinance (breakdown, buckets, spent map, history,
// setBucketLimits) and — via useFormatCurrency — useHouseholdCore. One shared
// mock backs both, mirroring SafeToSpendBreakdownDrawer.test.tsx.
const mockUseHousehold = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
  };
});

// Passthrough Drawer, so the assertions are about this drawer's own content.
// The footer is rendered too — that's where Save lives.
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
    header?: ReactNode;
    footer?: ReactNode;
    children: ReactNode;
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

const snapshot = (bucketId: string, periodId: string, totalSpent: number): BucketPeriodSnapshot => ({
  id: `${bucketId}-${periodId}`,
  bucketId,
  bucketName: bucketId,
  periodId,
  periodStartDate: periodId,
  periodEndDate: periodId,
  limit: 0,
  totalSpent,
  totalPending: 0,
  transactionCount: 1,
  createdAt: `${periodId}T00:00:00.000Z`,
});

const setBucketLimits = vi.fn(async () => {});

const setFinance = (config: {
  safeToSpend?: number;
  breakdownUndefined?: boolean;
  buckets?: BudgetBucket[];
  bucketSpentMap?: Map<string, BucketSpent>;
  bucketHistory?: BucketPeriodSnapshot[];
}) => {
  const safeToSpend = config.safeToSpend ?? 0;
  mockUseHousehold.mockReturnValue({
    safeToSpendBreakdown: config.breakdownUndefined
      ? undefined
      : {
          checkingBalance: safeToSpend,
          unpaidBills: 0,
          pendingSpend: 0,
          safeToSpend,
          nextPaycheckDate: null,
          unpaidBillItems: [],
          pendingTransactions: [],
        },
    buckets: config.buckets ?? [],
    bucketSpentMap: config.bucketSpentMap ?? new Map(),
    bucketHistory: config.bucketHistory ?? [],
    setBucketLimits,
    householdSettings: { currency: 'USD' },
  });
};

const meter = () => screen.getByTestId('rebalance-meter');

describe('RebalanceBucketsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when the breakdown has not loaded yet', () => {
    setFinance({ breakdownUndefined: true });
    const { container } = render(<RebalanceBucketsDrawer open onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when closed', () => {
    setFinance({ safeToSpend: 500, buckets: [bucket('b1', 'Groceries', 600)] });
    const { container } = render(<RebalanceBucketsDrawer open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('seeds the drafts with the trim plan so the meter already reads as fitting', () => {
    // StS $500, buckets claim $600 → $100 short. `fun` has the larger slack
    // ($300 limit, needs $100 by history) so the trim lands there first.
    setFinance({
      safeToSpend: 500,
      buckets: [bucket('groc', 'Groceries', 300), bucket('fun', 'Fun money', 300)],
      bucketSpentMap: new Map<string, BucketSpent>([
        ['groc', { verified: 0, pending: 0 }],
        ['fun', { verified: 0, pending: 0 }],
      ]),
      bucketHistory: [snapshot('groc', '2026-07-01', 280), snapshot('fun', '2026-07-01', 100)],
    });
    render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    // Fun money trimmed 300 → 200; Groceries untouched at 300.
    expect(screen.getByLabelText('Fun money budget for this period')).toHaveValue(200);
    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(300);

    // …and the seeded plan balances: $500 claimed of $500 available.
    expect(meter()).toHaveTextContent('$500.00 of $500.00');
    expect(meter()).toHaveTextContent('Fully planned');
    expect(meter()).not.toHaveTextContent('Short by');
  });

  it('states the shortfall it is closing', () => {
    setFinance({
      safeToSpend: 500,
      buckets: [bucket('fun', 'Fun money', 600)],
      bucketSpentMap: new Map<string, BucketSpent>([['fun', { verified: 0, pending: 0 }]]),
      bucketHistory: [snapshot('fun', '2026-07-01', 100)],
    });
    render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    expect(screen.getByTestId('rebalance-shortfall')).toHaveTextContent(
      'Your budgets claim $100.00 more than you have left.',
    );
  });

  it('saves every changed limit in ONE setBucketLimits call', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    setFinance({
      safeToSpend: 400,
      buckets: [bucket('groc', 'Groceries', 300), bucket('fun', 'Fun money', 300)],
      bucketSpentMap: new Map<string, BucketSpent>([
        ['groc', { verified: 0, pending: 0 }],
        ['fun', { verified: 0, pending: 0 }],
      ]),
      // Both need $100 and both carry $200 of slack; the $200 shortfall is a
      // slack TIE, broken by display order — so it all comes out of Groceries
      // and Fun money is left alone (and therefore is not written).
      bucketHistory: [snapshot('groc', '2026-07-01', 100), snapshot('fun', '2026-07-01', 100)],
    });
    render(<RebalanceBucketsDrawer open onClose={onClose} />);

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(100);
    expect(screen.getByLabelText('Fun money budget for this period')).toHaveValue(300);

    await user.click(screen.getByRole('button', { name: 'Save budgets' }));

    expect(setBucketLimits).toHaveBeenCalledTimes(1);
    expect(setBucketLimits).toHaveBeenCalledWith([{ id: 'groc', limit: 100 }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves the user’s override, not the seeded plan — the plan is a starting point', async () => {
    const user = userEvent.setup();
    setFinance({
      safeToSpend: 400,
      buckets: [bucket('groc', 'Groceries', 600)],
      bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 0, pending: 0 }]]),
      bucketHistory: [snapshot('groc', '2026-07-01', 100)],
    });
    render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    const field = screen.getByLabelText('Groceries budget for this period');
    expect(field).toHaveValue(400); // seeded trim: 600 → 400

    await user.clear(field);
    await user.type(field, '250');
    await user.click(screen.getByRole('button', { name: 'Save budgets' }));

    expect(setBucketLimits).toHaveBeenCalledTimes(1);
    expect(setBucketLimits).toHaveBeenCalledWith([{ id: 'groc', limit: 250 }]);
  });

  it('says nothing about an uncovered remainder when the plan closes the whole shortfall', () => {
    // Positive control for the banner assertion below: the same drawer, with
    // enough slack to absorb the gap, must NOT render the warning.
    setFinance({
      safeToSpend: 400,
      buckets: [bucket('groc', 'Groceries', 600)],
      bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 0, pending: 0 }]]),
      bucketHistory: [snapshot('groc', '2026-07-01', 100)],
    });
    render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(400);
    expect(screen.queryByTestId('rebalance-unresolved')).not.toBeInTheDocument();
    expect(meter()).toHaveTextContent('Fully planned');
  });

  it('explains WHY the buckets had no room left, without restating the shortfall', () => {
    // StS $50. Rent claims $900 (nothing spent) but its history says it NEEDS
    // $900, so it has zero slack. Shortfall $850, resolvable $0.
    setFinance({
      safeToSpend: 50,
      buckets: [bucket('rent', 'Rent', 900)],
      bucketSpentMap: new Map<string, BucketSpent>([['rent', { verified: 0, pending: 0 }]]),
      bucketHistory: [snapshot('rent', '2026-07-01', 900)],
    });
    render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    expect(screen.getByTestId('rebalance-unresolved')).toHaveTextContent(
      'Only $0.00 can come off without dropping a bucket below what it has already spent this period, or what it usually needs.',
    );
    // The live shortfall is the METER's figure — the explanation must not echo
    // it back beside the meter in a second alarm-coloured box. (The header's
    // "Your budgets claim $850.00 more than you have left" is a different
    // statement: the problem the drawer OPENED on, which stays put while the
    // meter tracks the drafts.)
    expect(screen.getByTestId('rebalance-unresolved')).not.toHaveTextContent('$850.00');
    expect(meter()).toHaveTextContent('Short by $850.00');
    expect(screen.getByRole('button', { name: 'Save budgets' })).toBeDisabled();
  });

  it('never seeds a limit below what a bucket has already spent this period', () => {
    // $200 limit, $180 already spent, history suggests only $50. The shortfall
    // is huge, but the seeded limit floors at the spend — a trim that instantly
    // puts a bucket over budget is worse than the over-allocation.
    setFinance({
      safeToSpend: 0,
      buckets: [bucket('groc', 'Groceries', 200)],
      bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 150, pending: 30 }]]),
      bucketHistory: [snapshot('groc', '2026-07-01', 50)],
    });
    render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(180);
  });

  it('re-seeds on reopen — LazyMount keeps it mounted, so stale drafts must not survive', async () => {
    const user = userEvent.setup();
    setFinance({
      safeToSpend: 400,
      buckets: [bucket('groc', 'Groceries', 600)],
      bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 0, pending: 0 }]]),
      bucketHistory: [snapshot('groc', '2026-07-01', 100)],
    });
    const { rerender } = render(<RebalanceBucketsDrawer open onClose={() => {}} />);

    const field = screen.getByLabelText('Groceries budget for this period');
    await user.clear(field);
    await user.type(field, '999');
    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(999);

    // Close and reopen WITHOUT unmounting, exactly as LazyMount does.
    rerender(<RebalanceBucketsDrawer open={false} onClose={() => {}} />);
    rerender(<RebalanceBucketsDrawer open onClose={() => {}} />);

    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(400);
  });

  it('keeps the drawer open when the save fails, so edits are not lost', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    setBucketLimits.mockRejectedValueOnce(new Error('offline'));
    setFinance({
      safeToSpend: 400,
      buckets: [bucket('groc', 'Groceries', 600)],
      bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 0, pending: 0 }]]),
      bucketHistory: [snapshot('groc', '2026-07-01', 100)],
    });
    render(<RebalanceBucketsDrawer open onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Save budgets' }));

    expect(setBucketLimits).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Groceries budget for this period')).toHaveValue(400);
  });
});
