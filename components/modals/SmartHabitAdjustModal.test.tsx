
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { subDays } from 'date-fns';
import SmartHabitAdjustModal from './SmartHabitAdjustModal';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { getLocalDateString } from '@/utils/dateHelpers';
import type { Habit } from '@/types/schema';

// Mock dependencies
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
  useHouseholdCore: vi.fn(),
}));

/** The last `count` calendar days, today first — relative to the real clock the modal reads. */
const recentDates = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => getLocalDateString(subDays(new Date(), i)));

const makeHabit = (overrides: Partial<Habit>): Habit =>
  ({
    id: '1',
    title: 'Run',
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

/** Done every day for two months — built in, so the deterministic rule lowers its reward. */
const builtInHabit = (): Habit => makeHabit({ completedDates: recentDates(60) });

describe('SmartHabitAdjustModal', () => {
  const mockOnClose = vi.fn();
  const mockUpdateHabit = vi.fn();

  const setHabits = (habits: Habit[]) => {
    (useGamification as Mock).mockReturnValue({ habits, updateHabit: mockUpdateHabit });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setHabits([builtInHabit()]);
    (useHouseholdCore as Mock).mockReturnValue({
      householdId: 'test-household',
    });
  });

  it('does not render when closed', () => {
    render(<SmartHabitAdjustModal isOpen={false} onClose={mockOnClose} />);
    expect(screen.queryByText('Smart Adjustments')).not.toBeInTheDocument();
  });

  it('renders the deterministic suggestion for a built-in habit', async () => {
    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Smart Adjustments')).toBeInTheDocument();
    });

    expect(screen.getByText('Run')).toBeInTheDocument();
    expect(screen.getByText('8 pts')).toBeInTheDocument();
    expect(screen.getByText(/become routine/)).toBeInTheDocument();
  });

  it('renders the empty state when no habit has enough history to judge', async () => {
    setHabits([makeHabit({ completedDates: recentDates(5), totalCount: 5 })]);

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('No adjustments needed!')).toBeInTheDocument();
    });
  });

  it('calls updateHabit when accepting suggestion', async () => {
    const habit = builtInHabit();
    setHabits([habit]);

    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Run')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Accept Change'));

    await waitFor(() => {
      expect(mockUpdateHabit).toHaveBeenCalledWith({
        ...habit,
        basePoints: 8,
      });
    });
  });

  it('removes suggestion when ignored', async () => {
    render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Run')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Ignore'));

    await waitFor(() => {
      expect(screen.queryByText('Run')).not.toBeInTheDocument();
    });
    expect(mockUpdateHabit).not.toHaveBeenCalled();
  });

  // Regression coverage for the PR #1215 review fix: `habit.basePoints` had
  // two storage conventions for `type: 'negative'` habits (signed vs
  // magnitude-only). The rendered numbers/colour must be identical either
  // way, and unambiguously signed (never a bare "3 pts" that could mean a
  // reward OR a penalty).
  describe('negative-habit direction is convention-independent', () => {
    /** A daily incremental penalty triggered once in the last 60 days — the "penalty can ease off" case. */
    const rarelyTriggeredPenalty = (basePoints: number): Habit =>
      makeHabit({
        id: '1',
        title: 'Late night snack',
        type: 'negative',
        scoringType: 'incremental',
        basePoints,
        completedDates: [getLocalDateString(subDays(new Date(), 45))],
      });

    it('renders "-3 pts -> -1 pts" in the favorable (money-pos) colour under the OLD signed convention', async () => {
      setHabits([rarelyTriggeredPenalty(-3)]);

      render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      expect(screen.getByText('-3 pts')).toBeInTheDocument();
      const suggested = screen.getByText('-1 pts');
      expect(suggested.className).toContain('text-money-pos');
    });

    it('renders the SAME canonical text and favorable colour under the NEW magnitude-only convention', async () => {
      setHabits([rarelyTriggeredPenalty(3)]);

      render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      // Same canonical text as the OLD-convention case above, not "3 pts" / "1 pts".
      expect(screen.getByText('-3 pts')).toBeInTheDocument();
      const suggested = screen.getByText('-1 pts');
      expect(suggested.className).toContain('text-money-pos');
    });

    it('still writes the RAW (convention-preserving) value through updateHabit, not the display value', async () => {
      const habit = rarelyTriggeredPenalty(3); // NEW convention: positive magnitude
      setHabits([habit]);

      render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

      await waitFor(() => expect(screen.getByText('Late night snack')).toBeInTheDocument());
      fireEvent.click(screen.getByTitle('Accept Change'));

      await waitFor(() => {
        // basePoints: 1, NOT -1 — the write must stay in the habit's stored
        // (positive-magnitude) convention; only the display is re-signed.
        expect(mockUpdateHabit).toHaveBeenCalledWith({ ...habit, basePoints: 1 });
      });
    });

    it('a reward habit still shows plain (unsigned) numbers, unaffected by this fix', async () => {
      setHabits([builtInHabit()]);

      render(<SmartHabitAdjustModal isOpen={true} onClose={mockOnClose} />);

      await waitFor(() => expect(screen.getByText('Run')).toBeInTheDocument());
      expect(screen.getByText('10 pts')).toBeInTheDocument();
      const suggested = screen.getByText('8 pts');
      expect(suggested.className).toContain('text-money-neg');
    });
  });
});
