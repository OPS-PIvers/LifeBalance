import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import BudgetCalendar from './BudgetCalendar';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { format, addDays } from 'date-fns';

// Mock the Household Context
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  ChevronLeft: () => <div data-testid="chevron-left" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  Plus: () => <div data-testid="plus-icon" />,
  CheckCircle2: () => <div data-testid="check-circle" />,
  Circle: () => <div data-testid="circle" />,
  Trash2: () => <div data-testid="trash-icon" />,
  Edit2: () => <div data-testid="edit-icon" />,
  X: () => <div data-testid="close-icon" />,
  Copy: () => <div data-testid="copy-icon" />,
}));

describe('BudgetCalendar', () => {
  const mockAddCalendarItem = vi.fn();
  const mockUpdateCalendarItem = vi.fn();
  const mockDeleteCalendarItem = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useHousehold as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      calendarItems: [],
      addCalendarItem: mockAddCalendarItem,
      updateCalendarItem: mockUpdateCalendarItem,
      deleteCalendarItem: mockDeleteCalendarItem,
    });
  });

  it('renders correctly', () => {
    render(<BudgetCalendar />);
    expect(screen.getByText(format(new Date(), 'MMMM yyyy'))).toBeInTheDocument();
  });

  it('opens add modal with correct date when clicking Add Event', () => {
    render(<BudgetCalendar />);

    // Default selected date should be today
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    fireEvent.click(screen.getByText('Add Event'));

    expect(screen.getByText('Add Calendar Item')).toBeInTheDocument();

    // Check if date input is pre-filled with today
    // Note: inputs don't have text content, check value
    // We need to find the input by placeholder or other means. The code has a label "Date"
    // The label is "Date" (uppercase in UI but label text is "Date")
    // Let's find by type="date"
    const dateInput = screen.getByDisplayValue(todayStr);
    expect(dateInput).toBeInTheDocument();
  });

  it('uses the selected date when adding an event', async () => {
    render(<BudgetCalendar />);

    // Select tomorrow
    const tomorrow = addDays(new Date(), 1);
    const tomorrowDay = format(tomorrow, 'd');

    // Click on tomorrow in the grid
    // This is tricky because there are multiple days. We need to find the specific day cell.
    // The day cells have text content of the day number.
    // But multiple months might be rendered? No, just one month.
    // But previous/next month days are also rendered.
    // Let's assume current month.

    // We can use `screen.getAllByText(tomorrowDay)` and filter or pick one.
    // Or we can try to be more specific.
    // The selected day has 'bg-brand-800' class.

    const dayCells = screen.getAllByText(tomorrowDay);
    // Click the first one that is likely in current month (usually index 0 or 1 depending on overlap)
    // For simplicity, let's just click the one that is NOT 'text-brand-200' if possible, or just the first one.
    fireEvent.click(dayCells[0]);

    fireEvent.click(screen.getByText('Add Event'));

    const tomorrowStr = format(tomorrow, 'yyyy-MM-dd');
    const dateInput = screen.getByDisplayValue(tomorrowStr);
    expect(dateInput).toBeInTheDocument();

    // Fill form
    fireEvent.change(screen.getByPlaceholderText('Title (e.g. Rent)'), { target: { value: 'Test Event' } });
    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '100' } });

    // Find the submit button inside the modal
    // The modal has a title "Add Calendar Item" or "Edit Event"
    screen.getByText('Add Calendar Item');

    // Within the modal, find the "Add Event" button
    // It's the submit button at the bottom
    const buttons = screen.getAllByText('Add Event');
    fireEvent.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(mockAddCalendarItem).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Test Event',
        amount: 100,
        date: tomorrowStr
      }));
    });
  });

  it('updates selected date when navigating months', () => {
    render(<BudgetCalendar />);

    // Initial date is today
    const today = new Date();

    // Click Next Month
    fireEvent.click(screen.getByTestId('chevron-right'));

    // Click Add Event
    fireEvent.click(screen.getByText('Add Event'));

    // Expect date input to be in next month
    // Note: setMonth keeps the day of month. So if today is Jan 27, next month is Feb 27.
    const nextMonth = new Date(today);
    nextMonth.setMonth(today.getMonth() + 1);
    const nextMonthStr = format(nextMonth, 'yyyy-MM-dd');

    const dateInput = screen.getByDisplayValue(nextMonthStr);
    expect(dateInput).toBeInTheDocument();
  });
});
