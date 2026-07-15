import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PointRebalanceCard } from './PointRebalanceCard';
import type { HabitPointAdjustmentSuggestion } from '@/services/geminiService.types';

const { analyzeHabitPointsMock, updateHabitMock, mockHouseholdContext } = vi.hoisted(() => ({
  analyzeHabitPointsMock: vi.fn(),
  updateHabitMock: vi.fn(),
  mockHouseholdContext: {
    habits: [
      { id: 'h1', title: 'Morning Jog', basePoints: 10, period: 'daily', streakDays: 2, totalCount: 3, type: 'threshold' },
    ] as Array<{ id: string; title: string; basePoints: number; [k: string]: unknown }>,
    householdId: 'test-household',
  },
}));

vi.mock('@/services/geminiService', () => ({
  analyzeHabitPoints: (...args: unknown[]) => analyzeHabitPointsMock(...args),
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

const suggestion: HabitPointAdjustmentSuggestion = {
  habitId: 'h1',
  habitTitle: 'Morning Jog',
  currentPoints: 10,
  suggestedPoints: 15,
  reasoning: 'Struggling here — bump the reward.',
};

describe('PointRebalanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockHouseholdContext.habits = [
      { id: 'h1', title: 'Morning Jog', basePoints: 10, period: 'daily', streakDays: 2, totalCount: 3, type: 'threshold' },
    ];
  });

  it('renders nothing while no analysis has resolved', () => {
    analyzeHabitPointsMock.mockResolvedValue([]);
    const { container } = render(<PointRebalanceCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the top suggestion once analysis resolves', async () => {
    analyzeHabitPointsMock.mockResolvedValue([suggestion]);
    render(<PointRebalanceCard />);

    await waitFor(() => {
      expect(screen.getByText('Morning Jog')).toBeInTheDocument();
    });
    expect(screen.getByText(/Struggling here/)).toBeInTheDocument();
    expect(analyzeHabitPointsMock).toHaveBeenCalledWith('test-household', mockHouseholdContext.habits);
  });

  it('applies the suggestion via updateHabit and hides the card', async () => {
    const user = userEvent.setup();
    analyzeHabitPointsMock.mockResolvedValue([suggestion]);
    updateHabitMock.mockResolvedValue(undefined);
    render(<PointRebalanceCard />);

    await waitFor(() => expect(screen.getByText('Morning Jog')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Apply/i }));

    await waitFor(() => {
      expect(updateHabitMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'h1', basePoints: 15 })
      );
    });
    await waitFor(() => expect(screen.queryByText('Morning Jog')).not.toBeInTheDocument());
    expect(window.localStorage.getItem('lb_point_rebalance_last_h1')).not.toBeNull();
  });

  it('dismisses the suggestion and persists the cooldown without calling updateHabit', async () => {
    const user = userEvent.setup();
    analyzeHabitPointsMock.mockResolvedValue([suggestion]);
    render(<PointRebalanceCard />);

    await waitFor(() => expect(screen.getByText('Morning Jog')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Morning Jog')).not.toBeInTheDocument();
    expect(updateHabitMock).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('lb_point_rebalance_last_h1')).not.toBeNull();
  });

  it('does not re-call the AI on a subsequent mount within the cache TTL', async () => {
    analyzeHabitPointsMock.mockResolvedValue([suggestion]);
    const { unmount } = render(<PointRebalanceCard />);
    await waitFor(() => expect(analyzeHabitPointsMock).toHaveBeenCalledTimes(1));
    unmount();

    render(<PointRebalanceCard />);
    await waitFor(() => expect(screen.getByText('Morning Jog')).toBeInTheDocument());
    expect(analyzeHabitPointsMock).toHaveBeenCalledTimes(1);
  });
});
