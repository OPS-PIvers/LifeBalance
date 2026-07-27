
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
});
