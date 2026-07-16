import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { UpcomingBillsWidget } from './UpcomingBillsWidget';
import { BrowserRouter } from 'react-router-dom';
import { expandCalendarItems } from '@/utils/calendarRecurrence';

vi.mock('@/utils/calendarRecurrence', () => ({
  expandCalendarItems: vi.fn(),
}));

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  // UpcomingBillsWidget reads useFinance; alias every hook to the same value.
  const value = () => ({
    calendarItems: [] as unknown[], // Mocked per test but default to empty
  });
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
    // The widget now consumes the shared memoized expansion hook; delegate to the
    // mocked expandCalendarItems so tests keep driving output via its return value.
    useExpandedCalendarItems: (start: Date, end: Date) => expandCalendarItems([], start, end),
  };
});

describe('UpcomingBillsWidget', () => {
  const mockOnPay = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when there are no upcoming bills', () => {
    (expandCalendarItems as Mock).mockReturnValue([]);

    const { container } = render(
      <BrowserRouter>
        <UpcomingBillsWidget onPay={mockOnPay} />
      </BrowserRouter>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders upcoming bills correctly', () => {
    const mockBills = [
      {
        id: '1',
        title: 'Rent',
        amount: 1200,
        date: '2025-05-25', // Future date
        type: 'expense',
        isPaid: false,
      },
      {
        id: '2',
        title: 'Netflix',
        amount: 15,
        date: '2025-05-26', // Future date
        type: 'expense',
        isPaid: false,
      },
    ];

    (expandCalendarItems as Mock).mockReturnValue(mockBills);

    render(
      <BrowserRouter>
        <UpcomingBillsWidget onPay={mockOnPay} />
      </BrowserRouter>
    );

    expect(screen.getByText('Upcoming bills')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('$1,200.00')).toBeInTheDocument();
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByText('$15.00')).toBeInTheDocument();
  });

  it('calls onPay when pay button is clicked', () => {
    const mockBills = [
      {
        id: '1',
        title: 'Rent',
        amount: 1200,
        date: '2025-05-25',
        type: 'expense',
        isPaid: false,
      },
    ];

    (expandCalendarItems as Mock).mockReturnValue(mockBills);

    render(
      <BrowserRouter>
        <UpcomingBillsWidget onPay={mockOnPay} />
      </BrowserRouter>
    );

    const payButton = screen.getByRole('button', { name: /Pay Rent/i });
    fireEvent.click(payButton);

    // The budgeted amount rides along to seed the pay sheet's editable field.
    expect(mockOnPay).toHaveBeenCalledWith('1', 1200);
  });

  it('filters out paid items and income', () => {
     const mockItems = [
      {
        id: '1',
        title: 'Rent',
        amount: 1200,
        date: '2025-05-25',
        type: 'expense',
        isPaid: true, // Should be filtered
      },
      {
        id: '2',
        title: 'Salary',
        amount: 5000,
        date: '2025-05-26',
        type: 'income', // Should be filtered
        isPaid: false,
      },
       {
        id: '3',
        title: 'Water',
        amount: 50,
        date: '2025-05-27',
        type: 'expense', // Should be kept
        isPaid: false,
      },
    ];

    (expandCalendarItems as Mock).mockReturnValue(mockItems);

    render(
      <BrowserRouter>
        <UpcomingBillsWidget onPay={mockOnPay} />
      </BrowserRouter>
    );

    expect(screen.queryByText('Rent')).not.toBeInTheDocument();
    expect(screen.queryByText('Salary')).not.toBeInTheDocument();
    expect(screen.getByText('Water')).toBeInTheDocument();
  });
});
