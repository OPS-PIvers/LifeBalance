import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import HabitHistoryCalendar from './HabitHistoryCalendar';
import { Habit, HabitSubmission, HouseholdMember } from '@/types/schema';

// Mock Lucide icons (calendar chrome + DayHabitEditor row icons)
vi.mock('lucide-react', () => ({
  ChevronLeft: () => <span data-testid="icon-chevron-left" />,
  ChevronRight: () => <span data-testid="icon-chevron-right" />,
  Snowflake: () => <span data-testid="icon-snowflake" />,
  CalendarDays: () => <span data-testid="icon-calendar-days" />,
  Plus: () => <span data-testid="icon-plus" />,
  Star: () => <span data-testid="icon-star" />,
  Users: () => <span data-testid="icon-users" />,
  X: () => <span data-testid="icon-x" />,
}));

vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

const mockAddHabitSubmission = vi.fn().mockResolvedValue(undefined);
const mockResetHabitDay = vi.fn().mockResolvedValue(undefined);
const mockGetHabitSubmissions = vi.fn(async (): Promise<HabitSubmission[]> => []);

// Mock the context — HabitHistoryCalendar + DayHabitEditor + useHabitCalendarData
// all read useGamification; alias every hook to one fn.
const mockDeleteHabitSubmission = vi.fn().mockResolvedValue(undefined);
const mockUncreditHabitCompletion = vi.fn().mockResolvedValue(undefined);
const mockContextValue = {
  habits: [] as Habit[],
  // `useHouseholdCore` is aliased to the same fn below, so the roster the
  // attribution picker reads lives here too.
  members: [] as HouseholdMember[],
  currentUser: undefined as HouseholdMember | undefined,
  addHabitSubmission: mockAddHabitSubmission,
  resetHabitDay: mockResetHabitDay,
  getHabitSubmissions: mockGetHabitSubmissions,
  deleteHabitSubmission: mockDeleteHabitSubmission,
  uncreditHabitCompletion: mockUncreditHabitCompletion,
};

const adult = (uid: string, displayName: string): HouseholdMember => ({
  uid,
  displayName,
  email: `${uid}@example.com`,
  role: 'admin',
  points: { daily: 0, weekly: 0, total: 0 },
  joinedAt: '2024-01-01T00:00:00Z',
} as HouseholdMember);

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
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
      createdBy: 'user-1',
    },
  ];

  beforeEach(() => {
    // Only fake Date, leave setTimeout/interval real for userEvent
    // This prevents userEvent.click() from hanging/timing out.
    // Jan 17 makes the fixture's Jan 15/16 completions PAST days — the grid
    // disables future days, so "today" must sit after every fixture date.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2024-01-17T12:00:00Z'));

    // Reset mock data
    mockContextValue.habits = [...mockHabits];
    mockContextValue.members = [];
    mockContextValue.currentUser = undefined;
    mockAddHabitSubmission.mockClear();
    mockResetHabitDay.mockClear();
    mockGetHabitSubmissions.mockClear();
    mockGetHabitSubmissions.mockImplementation(async () => []);
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

    expect(screen.getByText('January 2024')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Previous month'));
    expect(screen.getByText('December 2023')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Next month'));
    expect(screen.getByText('January 2024')).toBeInTheDocument();
  });

  it('shows signed net points on day cells (green positive)', () => {
    // Jan 15: Workout (+10, streak 1) + Read (+5) = +15; Jan 16: Workout with
    // a 2-day streak (< the 3-day 1.5x tier) = +10.
    render(<HabitHistoryCalendar />);

    expect(screen.getByRole('button', { name: /Jan 15: \+15 points/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jan 16: \+10 points/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jan 10: 0 points/ })).toBeInTheDocument();
  });

  it('shows NEGATIVE net points for negative habits, whichever sign basePoints was stored with', () => {
    mockContextValue.habits = [
      // HabitFormModal convention: positive basePoints + type negative
      { ...mockHabits[0]!, id: 'neg-1', title: 'Skip workout', type: 'negative', basePoints: 2, completedDates: ['2024-01-15'] },
      // HabitCreatorWizard convention: negative basePoints + type negative
      { ...mockHabits[1]!, id: 'neg-2', title: 'Late snack', type: 'negative', basePoints: -3, completedDates: ['2024-01-15'] },
    ];
    render(<HabitHistoryCalendar />);

    expect(screen.getByRole('button', { name: /Jan 15: -5 points/ })).toBeInTheDocument();
    // Row labels are signed too
    expect(screen.getByText('-2 pts')).toBeInTheDocument();
    expect(screen.getByText('-3 pts')).toBeInTheDocument();
  });

  it('prefers stored submission totals for a day over the derived attribution', async () => {
    mockContextValue.habits = [
      { ...mockHabits[0]!, hasSubmissionTracking: true, completedDates: ['2024-01-10'] },
    ];
    mockGetHabitSubmissions.mockImplementation(async () => ([
      {
        id: 's1', habitId: 'habit-1', habitTitle: 'Workout',
        timestamp: '2024-01-10T12:00:00', date: '2024-01-10',
        count: 3, pointsEarned: 30, streakDaysAtTime: 1, multiplierApplied: 1,
        createdBy: 'user-1', createdAt: '2024-01-10T12:00:00',
      },
    ]));
    render(<HabitHistoryCalendar />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Jan 10: \+30 points/ })).toBeInTheDocument();
    });
  });

  it('lets the selected day be edited: tap logs one unit for that date', async () => {
    const user = userEvent.setup();
    render(<HabitHistoryCalendar />);

    await user.click(screen.getByRole('button', { name: /Jan 16/ }));
    await user.click(screen.getByRole('button', { name: /Log Read for/ }));

    expect(mockAddHabitSubmission).toHaveBeenCalledWith(
      'habit-2', 1, '2024-01-16T12:00:00', undefined, undefined, undefined,
    );
  });

  it('threads the roster into the day editor so the "who did this?" control renders', async () => {
    // The second host, wired independently of PastDayLogModal.
    const user = userEvent.setup();
    mockContextValue.members = [adult('user-1', 'Paul'), adult('jen-uid', 'Jen')];
    mockContextValue.currentUser = adult('user-1', 'Paul');
    render(<HabitHistoryCalendar />);

    await user.click(screen.getByRole('button', { name: /Jan 16/ }));
    expect(screen.getByRole('button', { name: /Who did Read on/ })).toBeInTheDocument();
  });

  it('clears a logged day via the × control', async () => {
    const user = userEvent.setup();
    render(<HabitHistoryCalendar />);

    await user.click(screen.getByRole('button', { name: /Jan 16/ }));
    // Workout was completed on Jan 16 (derived count 1) → its row shows ×.
    await user.click(screen.getByRole('button', { name: /Clear Workout for/ }));

    expect(mockResetHabitDay).toHaveBeenCalledWith('habit-1', '2024-01-16');
  });

  it('disables future days', () => {
    render(<HabitHistoryCalendar />);
    expect(screen.getByRole('button', { name: /Jan 20/ })).toBeDisabled();
  });

  it('handles empty habits array gracefully', () => {
    mockContextValue.habits = [];
    render(<HabitHistoryCalendar />);

    expect(screen.getByText('January 2024')).toBeInTheDocument();
    expect(screen.getByText('No habits yet')).toBeInTheDocument();
  });

  it('excludes kid-assigned chores from the grid and editor', () => {
    mockContextValue.habits = [
      mockHabits[0]!,
      { ...mockHabits[1]!, id: 'chore-1', title: 'Feed the dog', assignedTo: 'kid-1', completedDates: ['2024-01-15'] },
    ];
    render(<HabitHistoryCalendar />);

    expect(screen.queryByText('Feed the dog')).not.toBeInTheDocument();
    // Net for Jan 15 counts only the parent-visible habit (+10), not the chore.
    expect(screen.getByRole('button', { name: /Jan 15: \+10 points/ })).toBeInTheDocument();
  });

  describe('frozen-day marker (Plan 25)', () => {
    it('marks a frozen day distinctly (habit-blue, no points figure) and labels it', async () => {
      mockContextValue.habits = [
        { ...mockHabits[0]!, frozenDates: ['2024-01-12'] },
        mockHabits[1]!,
      ];
      const user = userEvent.setup();
      render(<HabitHistoryCalendar />);

      const frozenDay = screen.getByRole('button', {
        name: /Jan 12: 0 points, streak protected by a freeze/i,
      });
      expect(frozenDay).toHaveClass('bg-habit-blue/15');

      // Selecting it shows the freeze note (streak kept, zero points).
      await user.click(frozenDay);
      expect(screen.getByText(/A freeze protected/)).toBeInTheDocument();
      expect(screen.getByText(/streak kept, no points earned/)).toBeInTheDocument();
    });

    it('shows no freeze note on days without frozen dates', () => {
      render(<HabitHistoryCalendar />);
      expect(screen.queryByText(/A freeze protected/)).not.toBeInTheDocument();
    });
  });
});
