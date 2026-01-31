import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HabitHistoryCalendar from './HabitHistoryCalendar';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';

// Mock dependencies
vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  ChevronLeft: () => <div data-testid="chevron-left" />,
  ChevronRight: () => <div data-testid="chevron-right" />,
  CheckCircle2: () => <div data-testid="check-circle" />,
  Flame: () => <div data-testid="flame" />,
  Calendar: () => <div data-testid="calendar-icon" />,
}));

describe('HabitHistoryCalendar', () => {
  const mockHabits = [
    {
      id: '1',
      title: 'Workout',
      category: 'Health',
      type: 'positive',
      basePoints: 10,
      completedDates: ['2024-01-15'], // Mid-month to be safe
      streakDays: 5,
      scoringType: 'threshold',
      period: 'daily',
      targetCount: 1,
      count: 1,
      totalCount: 10,
      lastUpdated: '2024-01-15',
      weatherSensitive: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    // Set system time to mid-Jan 2024 to match completedDates and avoid month overflow issues
    vi.setSystemTime(new Date(2024, 0, 15)); // Jan 15, 2024

    vi.mocked(useHousehold).mockReturnValue({
      habits: mockHabits,
    } as unknown as ReturnType<typeof useHousehold>);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the calendar grid', () => {
    render(<HabitHistoryCalendar />);
    expect(screen.getByText('January 2024')).toBeInTheDocument();
    // Check for days (1 to 31)
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('updates selection on date click', () => {
    render(<HabitHistoryCalendar />);

    // Initial state: Today (Jan 15) is selected by default
    // Since we mocked time to Jan 15, Jan 15 is selected.
    expect(screen.getByText('January 15 Summary')).toBeInTheDocument();
    expect(screen.getByText('1 Completed')).toBeInTheDocument();

    // Click on Jan 10
    const day10 = screen.getByText('10');
    fireEvent.click(day10);

    expect(screen.getByText('January 10 Summary')).toBeInTheDocument();
    expect(screen.queryByText('1 Completed')).not.toBeInTheDocument(); // No habits on Jan 10
  });

  it('displays habits for the selected date', () => {
    render(<HabitHistoryCalendar />);
    // Jan 15 has 'Workout'
    expect(screen.getByText('Workout')).toBeInTheDocument();
  });
});
