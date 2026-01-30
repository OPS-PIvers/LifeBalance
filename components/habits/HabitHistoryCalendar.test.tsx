import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HabitHistoryCalendar from './HabitHistoryCalendar';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock the context
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

describe('HabitHistoryCalendar', () => {
  const mockHabits = [
    {
      id: 'habit-1',
      title: 'Workout',
      category: 'Health',
      basePoints: 10,
      streakDays: 5,
      completedDates: ['2024-01-15', '2024-01-16'],
      type: 'positive',
    },
    {
      id: 'habit-2',
      title: 'Read',
      category: 'Growth',
      basePoints: 5,
      streakDays: 0,
      completedDates: ['2024-01-15'],
      type: 'positive',
    },
  ];

  beforeEach(() => {
    // Set system time to a fixed date for consistent calendar rendering
    // Using a mid-month date to avoid potential timezone/month-boundary edge cases
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    (useHousehold as any).mockReturnValue({
      habits: mockHabits,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the calendar with the current month', () => {
    render(<HabitHistoryCalendar />);
    expect(screen.getByText('January 2024')).toBeInTheDocument();
  });

  it('navigates to the previous and next month', () => {
    render(<HabitHistoryCalendar />);

    // Check initial state
    expect(screen.getByText('January 2024')).toBeInTheDocument();

    // Go to previous month
    const prevButton = screen.getByLabelText('Previous month');
    fireEvent.click(prevButton);
    expect(screen.getByText('December 2023')).toBeInTheDocument();

    // Go back to January
    const nextButton = screen.getByLabelText('Next month');
    fireEvent.click(nextButton);
    expect(screen.getByText('January 2024')).toBeInTheDocument();
  });

  it('displays habit completions summary when a date is selected', () => {
    render(<HabitHistoryCalendar />);

    // Initial state should be selected date (today = Jan 15)
    expect(screen.getByText('January 15 Summary')).toBeInTheDocument();
    expect(screen.getByText('2 Completed')).toBeInTheDocument();
    expect(screen.getByText('Workout')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  it('updates summary when a different date is clicked', () => {
    render(<HabitHistoryCalendar />);

    // Click on Jan 16 (has 1 completion: Workout)
    const dayButton = screen.getByLabelText('Jan 16: 1 habits completed');
    fireEvent.click(dayButton);

    expect(screen.getByText('January 16 Summary')).toBeInTheDocument();
    expect(screen.getByText('1 Completed')).toBeInTheDocument();
    expect(screen.getByText('Workout')).toBeInTheDocument();
    expect(screen.queryByText('Read')).not.toBeInTheDocument();
  });

  it('shows empty state for days with no completions', () => {
    render(<HabitHistoryCalendar />);

    // Click on Jan 10 (no completions)
    const dayButton = screen.getByLabelText('Jan 10: 0 habits completed');
    fireEvent.click(dayButton);

    expect(screen.getByText('January 10 Summary')).toBeInTheDocument();
    expect(screen.getByText('0 Completed')).toBeInTheDocument();
    expect(screen.getByText('No habits completed on this day.')).toBeInTheDocument();
  });
});
