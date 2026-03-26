import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategorySpendWidget } from './CategorySpendWidget';
import { format, subMonths } from 'date-fns';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Setup fixed dates for consistent testing
const fixedDate = new Date('2026-03-25T12:00:00Z');
const currentMonthDate = format(fixedDate, 'yyyy-MM-dd');
const lastMonthDate = format(subMonths(fixedDate, 1), 'yyyy-MM-dd');

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('shows "No prior data" when there is current spending but no prior month spending', () => {
    mockUseHousehold.mockReturnValueOnce({
      transactions: [
        {
          id: 'current-only-1',
          amount: 100,
          category: 'Groceries',
          date: currentMonthDate,
          status: 'verified',
          merchant: 'Store',
          isRecurring: false,
          source: 'manual',
          autoCategorized: false,
        },
      ],
    });
    render(<CategorySpendWidget />);
    // Current total should be shown
    expect(screen.getAllByText('$100')[0]).toBeInTheDocument();
    // Trend pill should indicate there is no prior data to compare against
    expect(screen.getByText('No prior data')).toBeInTheDocument();
  });

  it('shows a neutral 0% trend when current and last month spending are equal', () => {
    mockUseHousehold.mockReturnValueOnce({
      transactions: [
        // Current month
        {
          id: 'equal-current-1',
          amount: 200,
          category: 'Groceries',
          date: currentMonthDate,
          status: 'verified',
          merchant: 'Store',
          isRecurring: false,
          source: 'manual',
          autoCategorized: false,
        },
        // Last month with same total
        {
          id: 'equal-last-1',
          amount: 200,
          category: 'Groceries',
          date: lastMonthDate,
          status: 'verified',
          merchant: 'Store',
          isRecurring: false,
          source: 'manual',
          autoCategorized: false,
        },
      ],
    });
    render(<CategorySpendWidget />);
    expect(screen.getAllByText('$200')[0]).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });
});
