import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import SafeToSpendBreakdownDrawer from './SafeToSpendBreakdownDrawer';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';

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
}) => {
  mockUseHousehold.mockReturnValue({
    safeToSpendBreakdown: config.safeToSpendBreakdown,
    buckets: config.buckets ?? [],
    bucketSpentMap: config.bucketSpentMap ?? new Map(),
    householdSettings: { currency: 'USD' },
  });
};

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

  it('hides the Pending transactions row when pendingSpend is 0', () => {
    setFinance({
      safeToSpendBreakdown: {
        checkingBalance: 2000, unpaidBills: 300, pendingSpend: 0, safeToSpend: 1700, nextPaycheckDate: null,
      },
    });
    render(<SafeToSpendBreakdownDrawer open={true} onClose={() => {}} />);
    expect(screen.queryByText('Pending transactions')).not.toBeInTheDocument();
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
});
