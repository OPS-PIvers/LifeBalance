import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { format, subDays } from 'date-fns';
import PastDayLogModal from './PastDayLogModal';
import { Habit, HabitSubmission, HouseholdMember } from '@/types/schema';

// Framer-motion's AnimatePresence/portal machinery isn't needed to test the
// modal's logic — Drawer renders through a portal which testing-library sees.
vi.mock('@/services/analytics', () => ({ track: vi.fn() }));

const mockAddHabitSubmission = vi.fn().mockResolvedValue(undefined);
const mockResetHabitDay = vi.fn().mockResolvedValue(undefined);
const mockGetHabitSubmissions = vi.fn(async (): Promise<HabitSubmission[]> => []);
const mockDeleteHabitSubmission = vi.fn().mockResolvedValue(undefined);
const mockUncreditHabitCompletion = vi.fn().mockResolvedValue(undefined);
// `useHouseholdCore` is aliased to the same fn below, so the roster the
// attribution picker reads lives here too.
const mockContextValue = {
  habits: [] as Habit[],
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
  joinedAt: new Date().toISOString(),
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

describe('PastDayLogModal', () => {
  // Computed per-test (not at import time) so a midnight rollover between
  // module load and render can't desync it from the modal's own "yesterday".
  let yesterday: string;

  beforeEach(() => {
    yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    mockContextValue.habits = [baseHabit];
    mockContextValue.members = [];
    mockContextValue.currentUser = undefined;
    mockAddHabitSubmission.mockClear();
    mockResetHabitDay.mockClear();
    mockGetHabitSubmissions.mockClear();
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

  it('logs ONE unit per tap for threshold habits (Track-tab parity)', async () => {
    const user = userEvent.setup();
    mockContextValue.habits = [{ ...baseHabit, targetCount: 3 }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Log Read 30 mins/ }));

    expect(mockAddHabitSubmission).toHaveBeenCalledTimes(1);
    expect(mockAddHabitSubmission).toHaveBeenCalledWith('habit-1', 1, `${yesterday}T12:00:00`, undefined, undefined, undefined);
  });

  it('logs one count per tap for incremental habits', async () => {
    const user = userEvent.setup();
    mockContextValue.habits = [{ ...baseHabit, scoringType: 'incremental', targetCount: 5 }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Log Read 30 mins/ }));

    expect(mockAddHabitSubmission).toHaveBeenCalledWith('habit-1', 1, `${yesterday}T12:00:00`, undefined, undefined, undefined);
  });

  it('shows the day count and a clear control for a day already logged', () => {
    mockContextValue.habits = [{ ...baseHabit, completedDates: [yesterday] }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    // The row stays tappable (Track-tab parity)…
    expect(screen.getByRole('button', { name: /Log Read 30 mins again .* \(currently 1\)/ })).toBeInTheDocument();
    // …and the × clears exactly that date.
    expect(screen.getByRole('button', { name: /Clear Read 30 mins/ })).toBeInTheDocument();
  });

  it('clears the selected day via resetHabitDay', async () => {
    const user = userEvent.setup();
    mockContextValue.habits = [{ ...baseHabit, completedDates: [yesterday] }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Clear Read 30 mins/ }));

    expect(mockResetHabitDay).toHaveBeenCalledWith('habit-1', yesterday);
  });

  it('displays SIGNED points for negative habits (both storage conventions)', () => {
    mockContextValue.habits = [
      { ...baseHabit, id: 'neg-1', title: 'Missed meds', type: 'negative', basePoints: 2 },
      { ...baseHabit, id: 'neg-2', title: 'Skip workout', type: 'negative', basePoints: -2 },
    ];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    // Both render "-2 pts" — the sign comes from habit.type, never basePoints.
    expect(screen.getAllByText('-2 pts')).toHaveLength(2);
  });

  it('shows signed net points on the calendar day cell', () => {
    mockContextValue.habits = [{ ...baseHabit, completedDates: [yesterday] }];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    // Past threshold day: +10 at 1.0x. Cell aria-label carries the figure.
    expect(
      screen.getByRole('button', { name: new RegExp(`${format(subDays(new Date(), 1), 'MMMM d')}, \\+10 points`) })
    ).toBeInTheDocument();
  });

  it('does not double-submit on a rapid double-tap while a write is in flight', async () => {
    const user = userEvent.setup();
    let resolveWrite: () => void = () => {};
    mockAddHabitSubmission.mockImplementationOnce(
      () => new Promise<void>(resolve => { resolveWrite = resolve; })
    );
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    const row = screen.getByRole('button', { name: /Log Read 30 mins/ });
    // Two clicks before the first write settles — the synchronous ref guard
    // must swallow the second even though React hasn't re-rendered yet.
    await user.dblClick(row);
    resolveWrite();

    expect(mockAddHabitSubmission).toHaveBeenCalledTimes(1);
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

  it('hides archived habits from the log list while still scoring their history', () => {
    // The bug this closes: the drawer listed every habit ever created, so
    // retired presets kept offering themselves months later and the list read
    // as a stale copy of the Habits page (which hides archived habits).
    mockContextValue.habits = [
      baseHabit,
      { ...baseHabit, id: 'old-1', title: 'Get 7+ hours of sleep', archivedAt: '2026-01-05T00:00:00Z' },
    ];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('Read 30 mins')).toBeInTheDocument();
    expect(screen.queryByText('Get 7+ hours of sleep')).not.toBeInTheDocument();
  });

  it('still counts an archived habit in the calendar day cell', () => {
    // Archived is a LIST rule, not a scoring rule — dropping retired habits
    // from the calendar would silently rewrite past days' point figures.
    mockContextValue.habits = [
      { ...baseHabit, id: 'old-1', title: 'Retired', archivedAt: '2026-01-05T00:00:00Z', completedDates: [yesterday] },
    ];
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    expect(
      screen.getByRole('button', { name: new RegExp(`${format(subDays(new Date(), 1), 'MMMM d')}, \\+10 points`) })
    ).toBeInTheDocument();
  });

  it('threads the roster into the day editor so the "who did this?" control renders', async () => {
    // Proves this host wires `useHouseholdCore` independently of the History
    // tab: with two adults the row carries the picker affordance, and the tap
    // then credits the signed-in member explicitly.
    const user = userEvent.setup();
    mockContextValue.members = [adult('user-1', 'Paul'), adult('jen-uid', 'Jen')];
    mockContextValue.currentUser = adult('user-1', 'Paul');
    render(<PastDayLogModal isOpen={true} onClose={() => {}} />);

    expect(screen.getByRole('button', { name: /Who did Read 30 mins on/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Log Read 30 mins for/ }));
    expect(mockAddHabitSubmission).toHaveBeenCalledWith(
      'habit-1', 1, `${yesterday}T12:00:00`, undefined, undefined, ['user-1'],
    );
  });
});
