import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText('$300.00')).toBeInTheDocument();

    expect(screen.getByText('Dining')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();

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

  it('expands a row to list its month transactions, and collapses it again', () => {
    render(<CategorySpendWidget />);

    const groceriesToggle = screen
      .getAllByRole('button')
      .find(btn => btn.textContent?.includes('Groceries'))!;
    expect(groceriesToggle).toBeTruthy();
    expect(groceriesToggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed: no transaction detail visible.
    expect(screen.queryByText('Safeway')).not.toBeInTheDocument();

    fireEvent.click(groceriesToggle);
    expect(groceriesToggle).toHaveAttribute('aria-expanded', 'true');
    // Expanded: the group's transactions show merchant, date, and cents.
    expect(screen.getByText('Safeway')).toBeInTheDocument();
    expect(screen.getByText('Whole Foods')).toBeInTheDocument();
    expect(screen.getAllByText('Jun 16').length).toBe(2);
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('$200.00')).toBeInTheDocument();
    // Other groups' transactions are not listed.
    expect(screen.queryByText('McDonalds')).not.toBeInTheDocument();

    fireEvent.click(groceriesToggle);
    expect(groceriesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Safeway')).not.toBeInTheDocument();
  });

  it('only one row is expanded at a time', () => {
    render(<CategorySpendWidget />);

    const buttons = screen.getAllByRole('button');
    const groceriesToggle = buttons.find(btn => btn.textContent?.includes('Groceries'))!;
    const diningToggle = buttons.find(btn => btn.textContent?.includes('Dining'))!;

    fireEvent.click(groceriesToggle);
    expect(screen.getByText('Safeway')).toBeInTheDocument();

    fireEvent.click(diningToggle);
    expect(screen.getByText('McDonalds')).toBeInTheDocument();
    expect(screen.queryByText('Safeway')).not.toBeInTheDocument();
    expect(groceriesToggle).toHaveAttribute('aria-expanded', 'false');
    expect(diningToggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders nothing if no spending', () => {
    mockUseHousehold.mockReturnValueOnce({
      transactions: [],
    });
    const { container } = render(<CategorySpendWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
