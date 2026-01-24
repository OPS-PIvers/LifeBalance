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
    type: 'expense'
  },
  {
    id: '2',
    amount: 50,
    category: 'Dining',
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'verified',
    type: 'expense'
  },
  {
    id: '3',
    amount: 200,
    category: 'Groceries',
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'verified',
    type: 'expense'
  },
  // Previous month (should be ignored)
  {
    id: '4',
    amount: 500,
    category: 'Rent',
    date: '2020-01-01', // Definitely old
    status: 'verified',
    type: 'expense'
  },
  // Income (should be ignored)
  {
    id: '5',
    amount: 1000,
    category: 'Income',
    date: format(new Date(), 'yyyy-MM-dd'),
    status: 'verified',
    type: 'income'
  }
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUseHousehold = vi.fn(() => ({
  transactions: mockTransactions,
}));

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockUseHousehold(),
}));

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

  it('renders nothing if no spending', () => {
    mockUseHousehold.mockReturnValueOnce({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transactions: [] as any,
    });
    const { container } = render(<CategorySpendWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
