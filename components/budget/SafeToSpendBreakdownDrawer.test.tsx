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
  // The over-allocation lead-in's mark, and `Button`'s loading spinner.
  AlertCircle: () => <div data-testid="alert-circle" />,
  Loader2: () => <div data-testid="loader" />,
  // Reached only through the nested RebalanceBucketsDrawer → BucketPlanEditor.
  AlertTriangle: () => <div data-testid="alert-triangle" />,
  RotateCcw: () => <div data-testid="rotate-ccw" />,
  Sparkles: () => <div data-testid="sparkles" />,
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
    // Read only by the nested RebalanceBucketsDrawer, which shares this mock.
    bucketHistory: [],
    setBucketLimits: vi.fn(async () => {}),
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

  // PR B2 — the alarm threshold reconciliation. The LEDGER is truthful at one
  // cent; the ALARM (lead-in + CTA + red treatment) shares the header mark's
  // $10 floor. The below-floor case is the one most likely to regress back into
  // either extreme: shouting at $3, or "fixing" it by declaring $9.99 fine.
  describe('over-allocation lead-in and Rebalance CTA', () => {
    const overClaimBy = (shortfall: number) => ({
      safeToSpendBreakdown: {
        checkingBalance: 1000, unpaidBills: 0, pendingSpend: 0, safeToSpend: 1000,
        nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
      },
      buckets: [bucket('rent', 'Rent', 1000 + shortfall)],
      bucketSpentMap: new Map<string, BucketSpent>([['rent', { verified: 0, pending: 0 }]]),
    });

    it('leads with the shortfall and offers "Rebalance buckets" at the $10 floor', () => {
      setFinance(overClaimBy(10));
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      const leadIn = screen.getByTestId('sts-over-allocation-leadin');
      expect(leadIn).toHaveTextContent('Budgets over-allocated by $10.00');
      expect(leadIn).toHaveTextContent(
        'Your buckets still expect to spend $1,010.00, but only $1,000.00 is free.'
      );
      expect(screen.getByRole('button', { name: 'Rebalance buckets' })).toBeInTheDocument();
      expect(screen.getByText('Your budgets exceed available cash — trim a bucket.')).toBeInTheDocument();
    });

    it('leads with the shortfall well above the floor too', () => {
      setFinance(overClaimBy(250));
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.getByTestId('sts-over-allocation-leadin')).toHaveTextContent(
        'Budgets over-allocated by $250.00'
      );
      expect(screen.getByRole('button', { name: 'Rebalance buckets' })).toBeInTheDocument();
    });

    it('stays SILENT below the floor — no lead-in, no CTA, no red caption', () => {
      // $9.99 short: one cent under OVER_ALLOCATION_MIN_SHORTFALL, so the
      // header shows no amber mark and this drawer must not shout either.
      setFinance(overClaimBy(9.99));
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.queryByTestId('sts-over-allocation-leadin')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Rebalance buckets' })).not.toBeInTheDocument();
      expect(screen.queryByText(/Your budgets exceed available cash/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Bills and pending spend have outrun/)).not.toBeInTheDocument();
    });

    it('…but STILL reports that sub-floor shortfall in the ledger — quiet is not "it balances"', async () => {
      const user = userEvent.setup();
      setFinance(overClaimBy(9.99));
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      // The closing row still names the state and shows the true negative.
      const row = screen.getByRole('button', { name: /Over-allocated/ });
      expect(row).toBeInTheDocument();
      expect(within(row).getByText('-$9.99')).toBeInTheDocument();
      // Never "Unallocated", and never a flattering $0.00.
      expect(screen.queryByText('Unallocated')).not.toBeInTheDocument();

      await user.click(row);
      const shortfall = screen.getByText('Short by').parentElement as HTMLElement;
      expect(within(shortfall).getByText('$9.99')).toBeInTheDocument();
      expect(
        screen.getByText(/Your buckets still expect to spend \$1,009\.99 before payday/)
      ).toBeInTheDocument();
    });

    it('shows no lead-in at all when the budgets fit', () => {
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 1000, unpaidBills: 0, pendingSpend: 0, safeToSpend: 1000,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
        buckets: [bucket('rent', 'Rent', 400)],
        bucketSpentMap: new Map<string, BucketSpent>([['rent', { verified: 0, pending: 0 }]]),
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.queryByTestId('sts-over-allocation-leadin')).not.toBeInTheDocument();
      expect(screen.getByText('Unallocated')).toBeInTheDocument();
    });

    it('blames the bills in the lead-in when Safe-to-Spend itself is negative, and offers no editor with no buckets', () => {
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 500, unpaidBills: 600, pendingSpend: 0, safeToSpend: -100,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      const leadIn = screen.getByTestId('sts-over-allocation-leadin');
      expect(leadIn).toHaveTextContent(
        'Bills and pending transactions have already outrun your balance by $100.00.'
      );
      expect(leadIn).not.toHaveTextContent('Your buckets still expect to spend');
      // Nothing to trim → no dead-end button into an empty editor.
      expect(screen.queryByRole('button', { name: 'Rebalance buckets' })).not.toBeInTheDocument();
    });

    it('keeps the lead-in but withholds the CTA when the pool is negative, even with buckets claiming', () => {
      // Trimming bucket LIMITS cannot raise Safe-to-Spend — buckets are not in
      // its formula at all — so with a negative pool the button would promise a
      // fix it structurally cannot deliver. The explanation stays; only the
      // button goes.
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 500, unpaidBills: 600, pendingSpend: 0, safeToSpend: -100,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
        buckets: [bucket('groc', 'Groceries', 200)],
        bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 0, pending: 0 }]]),
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.getByTestId('sts-over-allocation-leadin')).toHaveTextContent(
        'Bills and pending transactions have already outrun your balance by $100.00.'
      );
      expect(screen.queryByRole('button', { name: 'Rebalance buckets' })).not.toBeInTheDocument();
      // The remedy that DOES work is still on the surface.
      expect(
        screen.getByText('Bills and pending spend have outrun your balance.')
      ).toBeInTheDocument();
    });

    it('opens the rebalance editor when the CTA is tapped', async () => {
      const user = userEvent.setup();
      setFinance(overClaimBy(250));
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.queryByTestId('rebalance-meter')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Rebalance buckets' }));

      // The nested drawer is React.lazy behind LazyMount, so it genuinely
      // resolves a chunk before it can render — findBy is a real wait here.
      expect(await screen.findByTestId('rebalance-meter')).toBeInTheDocument();
      expect(screen.getByLabelText('Rent budget for this period')).toBeInTheDocument();
    });
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
      // Reach the panel through `aria-controls` rather than DOM position — that
      // both survives markup changes and asserts the a11y wiring is real.
      const panelId = toggle.getAttribute('aria-controls') as string;
      const panel = document.getElementById(panelId) as HTMLElement;
      expect(panel).not.toBeNull();
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

    it('blames bills, not buckets, when Safe-to-Spend itself is negative', async () => {
      const user = userEvent.setup();
      // leftover = safeToSpend − claimed, so a negative pool forces
      // over-allocation on its own — with NO buckets at all, `claimed` is $0.00
      // and any bucket-blaming copy would be talking about nothing.
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 500, unpaidBills: 600, pendingSpend: 0, safeToSpend: -100,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: /Over-allocated/ }));

      expect(
        screen.getByText(/Bills and pending transactions already exceed your balance by \$100\.00/)
      ).toBeInTheDocument();
      expect(screen.getByText(/No bucket limit is claiming this money/)).toBeInTheDocument();
      // Never "only -$100.00 is left", and never a trim-a-bucket instruction
      // when there is no bucket to trim.
      expect(screen.queryByText(/is left after bills and pending/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Your budgets exceed available cash/)).not.toBeInTheDocument();
      expect(screen.getByText('Bills and pending spend have outrun your balance.')).toBeInTheDocument();
    });

    it('names both causes when the pool is negative AND buckets still claim', async () => {
      const user = userEvent.setup();
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 500, unpaidBills: 600, pendingSpend: 0, safeToSpend: -100,
          nextPaycheckDate: null, unpaidBillItems: [], pendingTransactions: [],
        },
        buckets: [bucket('groc', 'Groceries', 200)],
        bucketSpentMap: new Map<string, BucketSpent>([['groc', { verified: 0, pending: 0 }]]),
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: /Over-allocated/ }));

      expect(
        screen.getByText(
          /already exceed your balance by \$100\.00, and your buckets expect to spend \$200\.00 on top of that/
        )
      ).toBeInTheDocument();
    });

    it('only points aria-controls at a panel that exists', async () => {
      const user = userEvent.setup();
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 350, pendingSpend: 0, safeToSpend: 1650,
          nextPaycheckDate: null,
          unpaidBillItems: [bill({ id: 'b1', title: 'Rent', amount: 350 })],
          pendingTransactions: [],
        },
      });
      render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      // Collapsed: no dangling reference to a panel that isn't rendered.
      const toggle = screen.getByRole('button', { name: /Unpaid bills this period/ });
      expect(toggle).not.toHaveAttribute('aria-controls');

      await user.click(toggle);
      const panelId = toggle.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      expect(document.getElementById(panelId as string)).not.toBeNull();
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

    it('reopens collapsed — the drawer stays mounted (LazyMount), so panel state must not survive a close', async () => {
      const user = userEvent.setup();
      setFinance({
        safeToSpendBreakdown: {
          checkingBalance: 2000, unpaidBills: 350, pendingSpend: 0, safeToSpend: 1650,
          nextPaycheckDate: null,
          unpaidBillItems: [bill({ id: 'b1', title: 'Rent', amount: 350 })],
          pendingTransactions: [],
        },
      });
      const { rerender } = render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      await user.click(screen.getByRole('button', { name: /Unpaid bills this period/ }));
      expect(screen.getByText('Rent')).toBeInTheDocument();

      // Close and reopen WITHOUT unmounting, exactly as LazyMount does.
      rerender(<SafeToSpendBreakdownDrawer open={false} onClose={() => {}} />);
      rerender(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);

      expect(screen.queryByText('Rent')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Unpaid bills this period/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    });
  });
});
