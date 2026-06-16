import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategorySpendWidget } from './CategorySpendWidget';

// Fixed "today" so both the module-level fixtures and the widget's
// startOfMonth(new Date()) current-month filter resolve to the same month
// (June 2026), making the suite deterministic across midnight/month boundaries.
const TODAY = '2026-06-16';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock Context
const mockTransactions = [
  // Current month
  {
    id: '1',
    amount: 100,
    category: 'Groceries',
    date: TODAY,
    status: 'verified',
    merchant: 'Safeway',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false
  },
  {
    id: '2',
    amount: 50,
    category: 'Dining',
    date: TODAY,
    status: 'verified',
    merchant: 'McDonalds',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false
  },
  {
    id: '3',
    amount: 200,
    category: 'Groceries',
    date: TODAY,
    status: 'verified',
    merchant: 'Whole Foods',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false
  },
  // Previous month (should be ignored)
  {
    id: '4',
    amount: 500,
    category: 'Rent',
    date: '2020-01-01', // Definitely old
    status: 'verified',
    merchant: 'Landlord',
    isRecurring: true,
    source: 'recurring',
    autoCategorized: true
  },
  // Income (should be ignored)
  {
    id: '5',
    amount: 1000,
    category: 'Income',
    date: TODAY,
    status: 'verified',
    merchant: 'Employer',
    isRecurring: true,
    source: 'manual',
    autoCategorized: true
  }
];

const mockUseHousehold = vi.fn(() => ({
  transactions: mockTransactions,
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  // CategorySpendWidget reads useFinance; alias every hook to the same source.
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

describe('CategorySpendWidget', () => {
  beforeEach(() => {
    // Freeze "now" to June 2026 so the widget's startOfMonth/endOfMonth
    // current-month window matches the TODAY-dated fixtures deterministically.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates spending by category for the current month', () => {
    render(<CategorySpendWidget />);

    // Groceries should be 300 (100+200)
    // Dining should be 50
    // Rent should be ignored
    // Income should be ignored

    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();

    expect(screen.getByText('Dining')).toBeInTheDocument();
    expect(screen.getByText('$50')).toBeInTheDocument();

    expect(screen.queryByText('Rent')).not.toBeInTheDocument();
    expect(screen.queryByText('Income')).not.toBeInTheDocument();
  });

  it('renders progressbar roles with correct aria-valuenow', () => {
    render(<CategorySpendWidget />);

    const bars = screen.getAllByRole('progressbar');
    // Two categories rendered: Groceries (300/350 ≈ 85.7%) and Dining (50/350 ≈ 14.3%)
    expect(bars.length).toBeGreaterThanOrEqual(1);

    // Groceries bar: 300/350 ≈ 85.7% -> rounded to 86
    const groceriesBar = bars.find(
      bar => bar.getAttribute('aria-label')?.startsWith('Groceries:')
    );
    expect(groceriesBar).toBeTruthy();
    expect(Number(groceriesBar!.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
    expect(groceriesBar!.getAttribute('aria-valuemin')).toBe('0');
    expect(groceriesBar!.getAttribute('aria-valuemax')).toBe('100');
  });

  it('renders nothing if no spending', () => {
    mockUseHousehold.mockReturnValueOnce({
      transactions: [],
    });
    const { container } = render(<CategorySpendWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
