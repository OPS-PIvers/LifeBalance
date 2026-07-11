import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format, subDays } from 'date-fns';
import PastDayLogModal from './PastDayLogModal';
import { Habit } from '@/types/schema';

// Framer-motion's AnimatePresence/portal machinery isn't needed to test the
// modal's logic — Drawer renders through a portal which testing-library sees.
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

const mockAddHabitSubmission = vi.fn().mockResolvedValue(undefined);
const mockContextValue = {
  habits: [] as Habit[],
  addHabitSubmission: mockAddHabitSubmission,
};

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

const baseHabit: Habit = {
  id: 'habit-1',
  title: 'Read 30 mins',
  category: 'Growth',
  basePoints: 10,
  streakDays: 0,
  completedDates: [],
  type: 'positive',
  scoringType: 'threshold',
  period: 'daily',
  targetCount: 1,
  count: 0,
  totalCount: 0,
  lastUpdated: new Date().toISOString(),
  createdBy: 'user-1',
};

const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');

describe('PastDayLogModal', () => {
  beforeEach(() => {
    mockContextValue.habits = [baseHabit];
    mockAddHabitSubmission.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the drawer with the calendar and habit list', () => {
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Log a past day')).toBeInTheDocument();
    expect(screen.getByText('Read 30 mins')).toBeInTheDocument();
    // Defaults to yesterday
    expect(screen.getByText(format(subDays(new Date(), 1), 'EEEE, MMMM d'))).toBeInTheDocument();
  });

  it('logs a threshold habit for the selected past day with the full target count', async () => {
    const user = userEvent.setup();
    mockContextValue.habits = [{ ...baseHabit, targetCount: 3 }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Log Read 30 mins/ }));

    expect(mockAddHabitSubmission).toHaveBeenCalledTimes(1);
    expect(mockAddHabitSubmission).toHaveBeenCalledWith('habit-1', 3, `${yesterday}T12:00:00`);
  });

  it('logs one count per tap for incremental habits', async () => {
    const user = userEvent.setup();
    mockContextValue.habits = [{ ...baseHabit, scoringType: 'incremental', targetCount: 5 }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Log Read 30 mins/ }));

    expect(mockAddHabitSubmission).toHaveBeenCalledWith('habit-1', 1, `${yesterday}T12:00:00`);
  });

  it('locks a threshold habit already completed on the selected day', () => {
    mockContextValue.habits = [{ ...baseHabit, completedDates: [yesterday] }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    const row = screen.getByRole('button', { name: /already logged/ });
    expect(row).toBeDisabled();
    expect(screen.getByText('Logged')).toBeInTheDocument();
  });

  it('keeps an incremental habit tappable after completion', () => {
    mockContextValue.habits = [
      { ...baseHabit, scoringType: 'incremental', completedDates: [yesterday] },
    ];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    const row = screen.getByRole('button', { name: /Log Read 30 mins/ });
    expect(row).not.toBeDisabled();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('disables future days in the calendar', () => {
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);
    const tomorrow = subDays(new Date(), -1);
    // Only assert when tomorrow is still in the displayed month grid.
    const btn = screen.queryByRole('button', { name: format(tomorrow, 'MMMM d') });
    if (btn) expect(btn).toBeDisabled();
  });

  it('excludes kid-assigned chores like the Track tab does', () => {
    mockContextValue.habits = [
      baseHabit,
      { ...baseHabit, id: 'chore-1', title: 'Feed the dog', assignedTo: 'kid-1' },
    ];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('Read 30 mins')).toBeInTheDocument();
    expect(screen.queryByText('Feed the dog')).not.toBeInTheDocument();
  });
});
