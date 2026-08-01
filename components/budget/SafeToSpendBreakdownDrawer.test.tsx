import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import SafeToSpendBreakdownDrawer from './SafeToSpendBreakdownDrawer';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type CalendarItem, type Transaction } from '@/types/schema';

// The drawer reads useFinance (safeToSpendBreakdown, buckets, bucketSpentMap)
// and, via useFormatCurrency, useHouseholdCore (householdSettings). Back every
// hook with one shared mock (mirrors SafeToSpendDetail.test.tsx).
const mockUseHousehold = vi.fn();

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const value = () => mockUseHousehold();
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

// Simplify the Drawer to a passthrough so the test focuses on the drawer's own
// content (Drawer's framer-motion/portal behavior is covered by its own tests).
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, title, children }: { isOpen: boolean; title?: string; children: ReactNode }) =>
    isOpen ? (
      <div data-testid="drawer">
        {title && <h2>{title}</h2>}
        {children}
      </div>
    ) : null,
}));

vi.mock('lucide-react', () => ({
  Wallet: () => <div data-testid="wallet" />,
  Receipt: () => <div data-testid="receipt" />,
  Clock: () => <div data-testid="clock" />,
  PiggyBank: () => <div data-testid="piggy-bank" />,
  ChevronDown: () => <div data-testid="chevron-down" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
}));

const bucket = (id: string, name: string, limit: number) => ({
  id,
  name,
  limit,
  color: 'green',
  isVariable: true,
  isCore: false,
});

const setFinance = (config: {
  safeToSpendBreakdown: unknown;
  buckets?: ReturnType<typeof bucket>[];
  bucketSpentMap?: Map<string, BucketSpent>;
  transactions?: Partial<Transaction>[];
  currentPeriodId?: string;
}) => {
  mockUseHousehold.mockReturnValue({
    safeToSpendBreakdown: config.safeToSpendBreakdown,
    buckets: config.buckets ?? [],
    bucketSpentMap: config.bucketSpentMap ?? new Map(),
    transactions: config.transactions ?? [],
    currentPeriodId: config.currentPeriodId ?? '',
    householdSettings: { currency: 'USD' },
  });
};

const tx = (over: Partial<Transaction> & { id: string; amount: number }): Transaction => ({
  merchant: 'Merchant',
  category: 'Groceries',
  date: '2026-07-10',
  status: 'verified',
  isRecurring: false,
  source: 'manual',
  autoCategorized: false,
  ...over,
});

const bill = (over: Partial<CalendarItem> & { id: string; amount: number }): CalendarItem => ({
  title: 'Bill',
  date: '2026-07-20',
  type: 'expense',
  isPaid: false,
  ...over,
});

describe('SafeToSpendBreakdownDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when the breakdown is undefined', () => {
    setFinance({ safeToSpendBreakdown: undefined });
    const { container } = render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when not open', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 0, safeToSpend: 1700, nextPaycheckDate: null,
      },
    });
    const { container } = render(<SafeToSpendBreakdownDrawer open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('mounts and shows the Safe-to-Spend total and waterfall terms', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 0, safeToSpend: 1700, nextPaycheckDate: null,
      },
    });
    render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

    expect(screen.getByTestId('drawer')).toBeInTheDocument();
    expect(screen.getByText('Checking balance')).toBeInTheDocument();
    expect(screen.getByText('$2,000.00')).toBeInTheDocument();
    // Safe to Spend total row.
    expect(screen.getByText('Safe to Spend')).toBeInTheDocument();
    // With no buckets, the total ($1,700.00) also appears on the Unallocated
    // (leftover === StS) row — assert it renders at least once.
    expect(screen.getAllByText('$1,700.00').length).toBeGreaterThanOrEqual(1);
  });

  it('always renders the Pending transactions row, showing $0.00 when pendingSpend is 0', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 0, safeToSpend: 1700, nextPaycheckDate: null,
      },
    });
    render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);
    expect(screen.getByText('Pending transactions')).toBeInTheDocument();
    // Row count parity with "Unpaid bills this period": both show $0.00 as
    // plain (non-negative-styled) text when their value is zero, never omitted.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('renders the Pending transactions row with a negative value when pendingSpend is > 0', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 75, safeToSpend: 1625, nextPaycheckDate: null,
      },
    });
    render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);
    expect(screen.getByText('Pending transactions')).toBeInTheDocument();
    expect(screen.getByText('− $75.00')).toBeInTheDocument();
  });

  it('renders one distribution row per bucket with remaining, spent-of-limit, and the Unallocated leftover', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 0, safeToSpend: 1700, nextPaycheckDate: null,
      },
      buckets: [bucket('groc', 'Groceries', 200), bucket('gas', 'Gas', 100)],
      bucketSpentMap: new Map<string, BucketSpent>([
        ['groc', { verified: 50, pending: 0 }], // remaining 150
        ['gas', { verified: 150, pending: 0 }], // remaining -50 (over budget)
      ]),
    });
    render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('$150.00')).toBeInTheDocument();
    expect(screen.getByText('$50.00 of $200.00 spent')).toBeInTheDocument();
    expect(screen.getByText('Gas')).toBeInTheDocument();
    expect(screen.getByText('-$50.00')).toBeInTheDocument();
    expect(screen.getByText('$150.00 of $100.00 spent')).toBeInTheDocument();
    expect(screen.getByText('Over budget')).toBeInTheDocument();
    // Progress bars: Groceries at 25%, Gas at 150% (ProgressBar reports the
    // true unclamped percentage via aria and clips the fill visually).
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '25');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '150');

    // Unallocated leftover = 1700 − 150 (gas over contributes 0) = 1550.
    expect(screen.getByText('Unallocated')).toBeInTheDocument();
    expect(screen.getByText('$1,550.00')).toBeInTheDocument();
  });

  it('shows the over-allocated warning when budgets exceed available cash', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 0, safeToSpend: 1000, nextPaycheckDate: null,
      },
      buckets: [bucket('rent', 'Rent', 2000)],
      bucketSpentMap: new Map<string, BucketSpent>([['rent', { verified: 0, pending: 0 }]]),
    });
    render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

    // leftover = 1000 − 2000 = -1000 → over-allocated.
    expect(screen.getByText('Over-allocated')).toBeInTheDocument();
    expect(screen.getByText(/Your budgets exceed available cash/)).toBeInTheDocument();
  });

  describe('itemized expansions', () => {
    it('expands "Unpaid bills this period" into the bills behind the total, flagging overdue carry-over', async () => {
      const user = userEvent.setup();
      setFinance({
        currentPeriodId: '2026-07-15',
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 425, pendingSpend: 0, safeToSpend: 1575,
          nextPaycheckDate: '2026-07-29',
          unpaidBillItems: [
            // Dated BEFORE the period's paycheck → carried over from the last
            // period via the overdue lookback.
            bill({ id: 'b1', title: 'Water', amount: 75, date: '2026-07-02' }),
            bill({ id: 'b2', title: 'Rent', amount: 350, date: '2026-07-20' }),
          ],
          pendingTransactions: [],
        },
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      const toggle = screen.getByRole('button', { name: /Unpaid bills this period/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Rent')).not.toBeInTheDocument();

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = screen.getByRole('button', { name: /Unpaid bills this period/ })
        .nextElementSibling as HTMLElement;
      expect(within(panel).getByText('Water')).toBeInTheDocument();
      expect(within(panel).getByText('$75.00')).toBeInTheDocument();
      expect(within(panel).getByText('Rent')).toBeInTheDocument();
      expect(within(panel).getByText('$350.00')).toBeInTheDocument();
      // Only the pre-paycheck bill is overdue.
      expect(within(panel).getAllByText('Overdue')).toHaveLength(1);
      // Closing line ties the list back to the figure it itemizes.
      expect(within(panel).getByText('2 bills still to pay')).toBeInTheDocument();
      expect(within(panel).getByText('$425.00')).toBeInTheDocument();
    });

    it('expands "Pending transactions" into every pending row', async () => {
      const user = userEvent.setup();
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 0, pendingSpend: 75, safeToSpend: 1925,
          nextPaycheckDate: null,
          unpaidBillItems: [],
          pendingTransactions: [
            tx({ id: 't1', merchant: 'Cub Foods', amount: 50, status: 'pending_review' }),
            tx({ id: 't2', merchant: 'Holiday', amount: 25, status: 'pending_review', category: 'Gas' }),
          ],
        },
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: /Pending transactions/ }));

      expect(screen.getByText('Cub Foods')).toBeInTheDocument();
      expect(screen.getByText('Holiday')).toBeInTheDocument();
      expect(screen.getByText('2 awaiting review')).toBeInTheDocument();
    });

    it('expands a bucket into the transactions making up its spend, marking pending ones', async () => {
      const user = userEvent.setup();
      setFinance({
        currentPeriodId: '2026-07-15',
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 0, pendingSpend: 0, safeToSpend: 2000,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
        buckets: [bucket('groc', 'Groceries', 200)],
        bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 40, pending: 10 }]]),
        transactions: [
          tx({ id: 't1', merchant: 'Cub Foods', amount: 40, payPeriodId: '2026-07-15' }),
          tx({ id: 't2', merchant: 'Aldi', amount: 10, status: 'pending_review', payPeriodId: '2026-07-15' }),
          // Different period — excluded from this bucket's spend, so excluded here.
          tx({ id: 't3', merchant: 'Old Trip', amount: 99, payPeriodId: '2026-07-01' }),
        ],
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: /Groceries/ }));

      expect(screen.getByText('Cub Foods')).toBeInTheDocument();
      expect(screen.getByText(/Approved$/)).toBeInTheDocument();
      expect(screen.getByText('Aldi')).toBeInTheDocument();
      expect(screen.getByText(/Pending$/)).toBeInTheDocument();
      expect(screen.queryByText('Old Trip')).not.toBeInTheDocument();
      expect(screen.getByText('2 transactions · $200.00 limit')).toBeInTheDocument();
      expect(screen.getByText('$50.00 spent')).toBeInTheDocument();
    });

    it('expands "Over-allocated" into the claims that caused the shortfall', async () => {
      const user = userEvent.setup();
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 1000, pendingSpend: 0, safeToSpend: 1000,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
        buckets: [bucket('rent', 'Rent', 2000), bucket('gas', 'Gas', 100)],
        bucketSpentMap: new Map<string, BucketSpent>([
          ['rent', { verified: 0, pending: 0 }],   // claims 2000
          ['gas', { verified: 150, pending: 0 }],  // over budget → claims nothing
        ]),
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: /Over-allocated/ }));

      // StS 1000 − claimed 2000 = −1000.
      expect(screen.getByText('Claimed by bucket limits')).toBeInTheDocument();
      expect(screen.getByText('− $2,000.00')).toBeInTheDocument();
      expect(screen.getByText('1 over-budget bucket claims nothing')).toBeInTheDocument();
      // The shortfall reads as a magnitude under its own label — never "−$1,000.00".
      const shortfall = screen.getByText('Short by').parentElement as HTMLElement;
      expect(within(shortfall).getByText('$1,000.00')).toBeInTheDocument();
      expect(screen.getByText("What's claiming it")).toBeInTheDocument();
      expect(screen.getByText('$2,000.00 limit · $0.00 spent')).toBeInTheDocument();
      expect(
        screen.getByText(/Your buckets still expect to spend \$2,000\.00 before payday/)
      ).toBeInTheDocument();
    });

    it('leaves a row with nothing to itemize inert (no toggle, no empty panel)', () => {
      setFinance({
        currentPeriodId: '2026-07-15',
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 0, pendingSpend: 0, safeToSpend: 2000,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
        buckets: [bucket('gas', 'Gas', 150)],
        bucketSpentMap: new Map<string, BucketSpent>([['gas', { verified: 0, pending: 0 }]]),
        transactions: [],
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.queryByRole('button', { name: /Unpaid bills this period/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Pending transactions/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Gas/ })).not.toBeInTheDocument();
      // …but the rows themselves still render.
      expect(screen.getByText('Unpaid bills this period')).toBeInTheDocument();
      expect(screen.getByText('Gas')).toBeInTheDocument();
    });

    it('keeps a single panel open — expanding one collapses the other', async () => {
      const user = userEvent.setup();
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 350, pendingSpend: 50, safeToSpend: 1600,
          nextPaycheckDate: null,
          unpaidBillItems: [bill({ id: 'b1', title: 'Rent', amount: 350 })],
          pendingTransactions: [tx({ id: 't1', merchant: 'Cub Foods', amount: 50, status: 'pending_review' })],
        },
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      const bills = screen.getByRole('button', { name: /Unpaid bills this period/ });
      const pending = screen.getByRole('button', { name: /Pending transactions/ });

      await user.click(bills);
      expect(screen.getByText('Rent')).toBeInTheDocument();

      await user.click(pending);
      expect(screen.getByText('Cub Foods')).toBeInTheDocument();
      expect(screen.queryByText('Rent')).not.toBeInTheDocument();
      expect(bills).toHaveAttribute('aria-expanded', 'false');

      // Tapping the open row closes it.
      await user.click(pending);
      expect(screen.queryByText('Cub Foods')).not.toBeInTheDocument();
    });
  });
});
