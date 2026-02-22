import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategorySpendWidget } from './CategorySpendWidget';
import { format, subMonths } from 'date-fns';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock Context
const now = new Date();
const currentMonthDate = format(now, 'yyyy-MM-dd');
const lastMonthDate = format(subMonths(now, 1), 'yyyy-MM-dd');

const mockTransactions = [
  // Current month: Total 350 (Groceries 300 + Dining 50)
  {
    id: '1',
    amount: 100,
    category: 'Groceries',
    date: currentMonthDate,
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
    date: currentMonthDate,
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
    date: currentMonthDate,
    status: 'verified',
    merchant: 'Whole Foods',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false
  },
  // Last month: Total 200 (Groceries 150 + Dining 50)
  {
    id: '4',
    amount: 150,
    category: 'Groceries',
    date: lastMonthDate,
    status: 'verified',
    merchant: 'Safeway',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false
  },
  {
    id: '5',
    amount: 50,
    category: 'Dining',
    date: lastMonthDate,
    status: 'verified',
    merchant: 'Chipotle',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false
  },
  // Income (should be ignored)
  {
    id: '6',
    amount: 1000,
    category: 'Income',
    date: currentMonthDate,
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

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockUseHousehold(),
}));

describe('CategorySpendWidget', () => {
  it('aggregates spending by category for the current month', () => {
    render(<CategorySpendWidget />);

    // Groceries should be 300 (100+200)
    // Dining should be 50
    // Total: 350
    expect(screen.getByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('$300')).toBeInTheDocument();

    expect(screen.getByText('Dining')).toBeInTheDocument();
    expect(screen.getByText('$50')).toBeInTheDocument();
  });

  it('displays total spending and trend', () => {
    render(<CategorySpendWidget />);

    // Current Total: 350
    // Last Month: 200
    // Diff: 150
    // % Change: (150 / 200) * 100 = 75%

    expect(screen.getByText('$350')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('renders nothing if no spending', () => {
    mockUseHousehold.mockReturnValueOnce({
      transactions: [],
    });
    const { container } = render(<CategorySpendWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
