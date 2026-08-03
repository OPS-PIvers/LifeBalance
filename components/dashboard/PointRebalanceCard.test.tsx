import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { subDays } from 'date-fns';
import { PointRebalanceCard } from './PointRebalanceCard';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { Habit } from '@/types/schema';
import type { HabitPointAdjustmentSuggestion } from '@/services/geminiService.types';

const { updateHabitMock, mockHouseholdContext } = vi.hoisted(() => ({
  updateHabitMock: vi.fn(),
  mockHouseholdContext: {
    habits: [] as unknown[],
    householdId: 'test-household',
  },
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  const gamification = () => ({ habits: mockHouseholdContext.habits, updateHabit: updateHabitMock });
  const core = () => ({ householdId: mockHouseholdContext.householdId });
  return {
    useGamification: gamification,
    useHouseholdCore: core,
  };
});

vi.mock('@/hooks/usePowerToolsEnabled', () => ({
  usePowerToolsEnabled: () => true,
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

/** The last `count` calendar days, today first — relative to the real clock the card reads. */
const recentDates = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => getLocalDateString(subDays(new Date(), i)));

const makeHabit = (overrides: Partial<Habit>): Habit =>
  ({
    id: 'h1',
    title: 'Morning Jog',
    category: 'health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 60,
    completedDates: [],
    streakDays: 0,
    lastUpdated: getLocalDateString(),
    ...overrides,
  }) as Habit;

/** A habit done every day for two months — built in, so its reward should come down. */
const builtInHabit = (): Habit => makeHabit({ completedDates: recentDates(60) });

describe('PointRebalanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockHouseholdContext.habits = [builtInHabit()];
  });

  it('renders nothing before the analysis has run', () => {
    const { container } = render(<PointRebalanceCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no habit has enough history to judge', async () => {
    mockHouseholdContext.habits = [makeHabit({ completedDates: recentDates(5), totalCount: 5 })];
    const { container } = render(<PointRebalanceCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders the top deterministic suggestion, lowering points for a built-in habit', async () => {
    render(<PointRebalanceCard />);

    await waitFor(() => {
      expect(screen.getByText('Morning Jog')).toBeInTheDocument();
    });
    expect(screen.getByText('10 pts')).toBeInTheDocument();
    expect(screen.getByText('8 pts')).toBeInTheDocument();
    expect(screen.getByText(/become routine/)).toBeInTheDocument();
  });

  it('applies the suggestion via updateHabit and hides the card', async () => {
    const user = userEvent.setup();
    updateHabitMock.mockResolvedValue(undefined);
    render(<PointRebalanceCard />);

    await waitFor(() => expect(screen.getByText('Morning Jog')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(updateHabitMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'h1', basePoints: 8 })
      );
    });
    await waitFor(() => expect(screen.queryByText('Morning Jog')).not.toBeInTheDocument());
    expect(window.localStorage.getItem('lb_point_rebalance_last_h1')).not.toBeNull();
  });

  it('dismisses the suggestion and persists the cooldown without calling updateHabit', async () => {
    const user = userEvent.setup();
    render(<PointRebalanceCard />);

    await waitFor(() => expect(screen.getByText('Morning Jog')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Morning Jog')).not.toBeInTheDocument();
    expect(updateHabitMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('lb_point_rebalance_last_h1')).not.toBeNull();
  });

  it('reuses a still-fresh cached analysis instead of recomputing', async () => {
    const cached: HabitPointAdjustmentSuggestion = {
      habitId: 'h1',
      habitTitle: 'Morning Jog',
      currentPoints: 10,
      suggestedPoints: 9,
      reasoning: 'Cached suggestion.',
    };
    window.localStorage.setItem(
      'lb_point_rebalance_analysis_test-household',
      JSON.stringify({ generatedAt: new Date().toISOString(), suggestions: [cached] })
    );

    render(<PointRebalanceCard />);

    await waitFor(() => expect(screen.getByText('Cached suggestion.')).toBeInTheDocument());
    expect(screen.getByText('9 pts')).toBeInTheDocument();
  });

  // Regression coverage for the PR #1215 review fix: `habit.basePoints` had
  // two storage conventions for `type: 'negative'` habits (signed vs
  // magnitude-only). The rendered direction/colour must be identical either
  // way — that equivalence is the whole point of the fix.
  describe('negative-habit direction is convention-independent', () => {
    const cache = (
      habitId: string,
      suggestion: Omit<HabitPointAdjustmentSuggestion, 'habitId'>
    ) => {
      window.localStorage.setItem(
        `lb_point_rebalance_analysis_test-household`,
        JSON.stringify({
          generatedAt: new Date().toISOString(),
          suggestions: [{ habitId, ...suggestion }],
        })
      );
    };

    const negativeHabit = (basePoints: number): Habit =>
      makeHabit({ id: 'h1', title: 'Late night snack', type: 'negative', basePoints });

    it('renders a penalty easing off in the favorable (money-pos) colour under the OLD signed convention', async () => {
      mockHouseholdContext.habits = [negativeHabit(-3)];
      cache('h1', { habitTitle: 'Late night snack', currentPoints: -3, suggestedPoints: -1, reasoning: 'Slipped once — barely an issue any more, so the penalty can ease off.' });

      render(<PointRebalanceCard />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      expect(screen.getByText('-3 pts')).toBeInTheDocument();
      const suggested = screen.getByText('-1 pts');
      expect(suggested.className).toContain('text-money-pos');
    });

    it('renders the SAME favorable colour and canonical text for the identical change under the NEW magnitude-only convention', async () => {
      mockHouseholdContext.habits = [negativeHabit(3)];
      cache('h1', { habitTitle: 'Late night snack', currentPoints: 3, suggestedPoints: 1, reasoning: 'Slipped once — barely an issue any more, so the penalty can ease off.' });

      render(<PointRebalanceCard />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      // Same canonical text as the OLD-convention case above, not "3 pts" / "1 pts".
      expect(screen.getByText('-3 pts')).toBeInTheDocument();
      const suggested = screen.getByText('-1 pts');
      expect(suggested.className).toContain('text-money-pos');
    });

    it('renders a penalty getting harsher in the unfavorable (money-neg) colour under the OLD signed convention', async () => {
      mockHouseholdContext.habits = [negativeHabit(-2)];
      cache('h1', { habitTitle: 'Late night snack', currentPoints: -2, suggestedPoints: -4, reasoning: 'Still a regular slip, so it should sting a little more.' });

      render(<PointRebalanceCard />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      const suggested = screen.getByText('-4 pts');
      expect(suggested.className).toContain('text-money-neg');
    });

    it('renders the SAME unfavorable colour and canonical text for the identical harsher change under the NEW magnitude-only convention', async () => {
      mockHouseholdContext.habits = [negativeHabit(2)];
      cache('h1', { habitTitle: 'Late night snack', currentPoints: 2, suggestedPoints: 4, reasoning: 'Still a regular slip, so it should sting a little more.' });

      render(<PointRebalanceCard />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      // Same canonical text as the OLD-convention case above, not "2 pts" / "4 pts".
      expect(screen.getByText('-2 pts')).toBeInTheDocument();
      const suggested = screen.getByText('-4 pts');
      expect(suggested.className).toContain('text-money-neg');
    });
  });
});
