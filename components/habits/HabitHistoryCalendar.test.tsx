import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HabitHistoryCalendar from './HabitHistoryCalendar';
import { Habit } from '@/types/schema';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  CheckCircle2: () => <span data-testid="icon-check-circle" />,
  Flame: () => <span data-testid="icon-flame" />,
  Calendar: () => <span data-testid="icon-calendar" />,
  Loader2: () => <span data-testid="icon-loader" />,
}));

// Mock the context
// Using a hoisted mock object for flexibility
const mockContextValue = {
  habits: [] as Habit[],
};

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  // HabitHistoryCalendar reads useGamification; alias every hook to one fn.
  const value = vi.fn(() => mockContextValue);
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

describe('HabitHistoryCalendar', () => {
  const mockHabits: Habit[] = [
    {
      id: 'habit-1',
      title: 'Workout',
      category: 'Health',
      basePoints: 10,
      streakDays: 5,
      completedDates: ['2024-01-15', '2024-01-16'],
      type: 'positive',
      scoringType: 'incremental',
      period: 'daily',
      targetCount: 1,
      count: 0,
      totalCount: 0,
      lastUpdated: '2024-01-15T12:00:00Z',
      weatherSensitive: false,
      createdBy: 'user-1',
    },
    {
      id: 'habit-2',
      title: 'Read',
      category: 'Growth',
      basePoints: 5,
      streakDays: 0,
      completedDates: ['2024-01-15'],
      type: 'positive',
      scoringType: 'incremental',
      period: 'daily',
      targetCount: 1,
      count: 0,
      totalCount: 0,
      lastUpdated: '2024-01-15T12:00:00Z',
      weatherSensitive: false,
      createdBy: 'user-1',
    },
  ];

  beforeEach(() => {
    // Only fake Date, leave setTimeout/interval real for userEvent
    // This prevents userEvent.click() from hanging/timing out
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

    // Reset mock data
    mockContextValue.habits = [...mockHabits];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the calendar with the current month', () => {
    render(<HabitHistoryCalendar />);
    expect(screen.getByText('January 2024')).toBeInTheDocument();
  });

  it('navigates to the previous and next month', async () => {
    const user = userEvent.setup();
    render(<HabitHistoryCalendar />);

    // Check initial state
    expect(screen.getByText('January 2024')).toBeInTheDocument();

    // Go to previous month
    const prevButton = screen.getByLabelText('Previous month');
    await user.click(prevButton);
    expect(screen.getByText('December 2023')).toBeInTheDocument();

    // Go back to January
    const nextButton = screen.getByLabelText('Next month');
    await user.click(nextButton);
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

  it('updates summary when a different date is clicked', async () => {
    const user = userEvent.setup();
    render(<HabitHistoryCalendar />);

    // Click on Jan 16 (has 1 completion: Workout)
    // Using a more robust selector than aria-label string matching if possible
    // Here we find the button by its text content (date number) and then verify properties
    const dayButton = screen.getByRole('button', { name: /Jan 16/i });
    await user.click(dayButton);

    expect(screen.getByText('January 16 Summary')).toBeInTheDocument();
    expect(screen.getByText('1 Completed')).toBeInTheDocument();
    expect(screen.getByText('Workout')).toBeInTheDocument();
    expect(screen.queryByText('Read')).not.toBeInTheDocument();
  });

  it('shows empty state for days with no completions', async () => {
    const user = userEvent.setup();
    render(<HabitHistoryCalendar />);

    // Click on Jan 10 (no completions)
    const dayButton = screen.getByRole('button', { name: /Jan 10/i });
    await user.click(dayButton);

    expect(screen.getByText('January 10 Summary')).toBeInTheDocument();
    expect(screen.getByText('0 Completed')).toBeInTheDocument();
    expect(screen.getByText('No habits completed on this day.')).toBeInTheDocument();
  });

  it('handles empty habits array gracefully', () => {
    mockContextValue.habits = [];
    render(<HabitHistoryCalendar />);

    expect(screen.getByText('January 2024')).toBeInTheDocument();
    // Verify heatmap has no highlighted days (all should be base style)
    // Checking for absence of intensity classes or presence of base classes
    const dayButtons = screen.getAllByRole('button', { name: /Jan \d+/ });
    // Sample a few buttons
    dayButtons.slice(0, 5).forEach(btn => {
       expect(btn).not.toHaveClass('bg-emerald-500');
    });
  });

  it('handles habits with no completed dates', () => {
    mockContextValue.habits = [{ ...mockHabits[0]!, completedDates: [] }];
    render(<HabitHistoryCalendar />);

    // Select today (Jan 15)
    expect(screen.getByText('January 15 Summary')).toBeInTheDocument();
    expect(screen.getByText('0 Completed')).toBeInTheDocument();
  });

  it('applies intensity classes based on completion count', () => {
    // Setup: Max completions = 2 (Workout + Read on Jan 15)
    // Jan 15: 2 completions (100% of max) -> should be darkest (emerald-500 or similar)
    // Jan 16: 1 completion (50% of max) -> should be lighter

    render(<HabitHistoryCalendar />);

    const day15 = screen.getByRole('button', { name: /Jan 15/i });
    const day16 = screen.getByRole('button', { name: /Jan 16/i });

    // Based on getIntensityClass logic in component:
    // ratio 1.0 >= 0.75 -> bg-emerald-500
    // ratio 0.5 >= 0.5 -> bg-emerald-400

    expect(day15).toHaveClass('bg-emerald-500');
    expect(day16).toHaveClass('bg-emerald-400');
  });
});
