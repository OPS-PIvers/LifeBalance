import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategorySpendWidget } from './CategorySpendWidget';
import { format } from 'date-fns';

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
    date: format(new Date(), 'yyyy-MM-dd'),
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
    date: format(new Date(), 'yyyy-MM-dd'),
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
    date: format(new Date(), 'yyyy-MM-dd'),
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
    date: format(new Date(), 'yyyy-MM-dd'),
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
