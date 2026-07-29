import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SafeToSpendDetail } from './SafeToSpendDetail';

// SafeToSpendDetail reads useFinance (safeToSpendBreakdown) and, via
// useFormatCurrency, useHouseholdCore (householdSettings). Back every hook
// with one shared mock so both resolve consistently, mirroring the pattern
// used by CategorySpendWidget.test.tsx / UpcomingBillsWidget.test.tsx.
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

vi.mock('lucide-react', () => ({
  ChevronDown: () => <div data-testid="chevron-down" />,
  Wallet: () => <div data-testid="wallet" />,
  Receipt: () => <div data-testid="receipt" />,
  Clock: () => <div data-testid="clock" />,
  BookOpen: () => <div data-testid="book-open" />,
  // Used by the MoneyModelPrimer drawer (rendered when the primer opens).
  PiggyBank: () => <div data-testid="piggy-bank" />,
  LayoutGrid: () => <div data-testid="layout-grid" />,
  X: () => <div data-testid="x" />,
}));

describe('SafeToSpendDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setBreakdown = (overrides: Partial<{
    checkingBalance: number;
    unpaidBills: number;
    pendingSpend: number;
    safeToSpend: number;
    nextPaycheckDate: string | null;
  }> = {}) => {
    mockUseHousehold.mockReturnValue({
      safeToSpendBreakdown: {
        checkingBalance: 1000,
        unpaidBills: 200,
        pendingSpend: 50,
        safeToSpend: 750,
        nextPaycheckDate: '2026-07-15',
        ...overrides,
      },
      householdSettings: { currency: 'USD' },
    });
  };

  it('renders nothing when breakdown is undefined', () => {
    mockUseHousehold.mockReturnValue({
      safeToSpendBreakdown: undefined,
      householdSettings: { currency: 'USD' },
    });

    const { container } = render(<SafeToSpendDetail />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows no headline amount (toolbar owns the figure), with breakdown rows hidden by default', () => {
    setBreakdown();
    render(<SafeToSpendDetail />);

    // The always-visible headline row was removed (UX audit Batch 3): the
    // figure lives in TopToolbar, so this surface is only the disclosure.
    expect(screen.queryByText('Available to spend')).not.toBeInTheDocument();
    expect(screen.queryByText('$750.00')).not.toBeInTheDocument();

    // Breakdown rows and disclaimer are collapsed by default.
    expect(screen.queryByText('Checking balance')).not.toBeInTheDocument();
    expect(screen.queryByText('Unpaid bills this period')).not.toBeInTheDocument();
    expect(screen.queryByText(/Your available cash after bills due/)).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: 'How is this calculated?' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('reveals the Checking balance / Unpaid bills rows and disclaimer when toggled open', () => {
    setBreakdown();
    render(<SafeToSpendDetail />);

    const toggle = screen.getByRole('button', { name: 'How is this calculated?' });
    fireEvent.click(toggle);

    expect(screen.getByText('Checking balance')).toBeInTheDocument();
    expect(screen.getByText('Unpaid bills this period')).toBeInTheDocument();
    expect(screen.getByText(/Your available cash after bills due/)).toBeInTheDocument();

    // Toggle label + aria-expanded flip once open.
    expect(screen.getByRole('button', { name: 'Hide breakdown' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('opens the money-model primer from the disclosure', () => {
    setBreakdown();
    render(<SafeToSpendDetail />);

    // The primer trigger only appears inside the expanded breakdown.
    fireEvent.click(screen.getByRole('button', { name: 'How is this calculated?' }));

    const trigger = screen.getByRole('button', { name: /How LifeBalance thinks about money/i });
    fireEvent.click(trigger);

    // Primer drawer content is now visible (buckets-are-not-envelopes section).
    expect(screen.getByText('Buckets are a lens, not envelopes')).toBeInTheDocument();
  });

  it('always renders the Pending transactions row, showing $0.00 when pendingSpend is 0', () => {
    setBreakdown({ pendingSpend: 0 });
    render(<SafeToSpendDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'How is this calculated?' }));

    expect(screen.getByText('Checking balance')).toBeInTheDocument();
    expect(screen.getByText('Pending transactions')).toBeInTheDocument();
    // Row count parity with "Unpaid bills this period": both show $0.00 as
    // plain (non-negative-styled) text when their value is zero, never omitted.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('renders the Pending transactions row with a negative value when pendingSpend is > 0', () => {
    setBreakdown({ pendingSpend: 75 });
    render(<SafeToSpendDetail />);

    fireEvent.click(screen.getByRole('button', { name: 'How is this calculated?' }));

    expect(screen.getByText('Pending transactions')).toBeInTheDocument();
    expect(screen.getByText('- $75.00')).toBeInTheDocument();
  });
});
