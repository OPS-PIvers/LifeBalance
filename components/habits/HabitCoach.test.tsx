import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { HabitCoach } from './HabitCoach';
import { HabitPatternInsight } from '@/services/geminiService';

// Hoisted mocks to avoid TDZ issues
const { analyzeHabitPatternsMock, mockHouseholdContext } = vi.hoisted(() => ({
  analyzeHabitPatternsMock: vi.fn(),
  mockHouseholdContext: {
    habits: [{ id: 'h1', title: 'Morning Jog', completedDates: ['2023-01-01'] }],
    householdId: 'test-household',
  }
}));

vi.mock('@/services/geminiService', () => ({
  analyzeHabitPatterns: (...args: unknown[]) => analyzeHabitPatternsMock(...args),
}));

vi.mock('@/contexts/FirebaseHouseholdContext', () => {
  // HabitCoach reads useGamification + useHouseholdCore; alias all hooks.
  const value = () => mockHouseholdContext;
  return {
    useHousehold: value,
    useFinance: value,
    useGamification: value,
    useHouseholdCore: value,
    useMeals: value,
    useTodos: value,
  };
});

vi.mock('react-hot-toast', () => ({
  default: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock icons
vi.mock('lucide-react', () => ({
  Sparkles: () => <div data-testid="icon-sparkles" />,
  Trophy: () => <div data-testid="icon-trophy" />,
  TrendingUp: () => <div data-testid="icon-trending" />,
  AlertCircle: () => <div data-testid="icon-alert" />,
  RefreshCw: () => <div data-testid="icon-refresh" />,
  Lightbulb: () => <div data-testid="icon-lightbulb" />,
}));

const defaultHabits = [{ id: 'h1', title: 'Morning Jog', completedDates: ['2023-01-01'] }];

describe('HabitCoach', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHouseholdContext.habits = defaultHabits; // Reset habits
  });

  it('renders empty state when no habits exist', () => {
    mockHouseholdContext.habits = [];
    render(<HabitCoach />);
    expect(screen.getByText('No Habits Yet')).toBeInTheDocument();
  });

  it('renders initial CTA when habits exist', () => {
    render(<HabitCoach />);
    expect(screen.getByText('Unlock Your Habit Potential')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analyze My Habits/i })).toBeInTheDocument();
  });

  it('calls analyzeHabitPatterns and displays insights', async () => {
    const user = userEvent.setup();
    const mockInsights: HabitPatternInsight[] = [
      {
        type: 'praise',
        title: 'Great Streak!',
        description: 'You are doing well.',
        relatedHabitId: 'h1'
      }
    ];
    analyzeHabitPatternsMock.mockResolvedValue(mockInsights);

    render(<HabitCoach />);

    await user.click(screen.getByRole('button', { name: /Analyze My Habits/i }));

    await waitFor(() => {
        expect(screen.getByText('Great Streak!')).toBeInTheDocument();
    });

    expect(screen.getByText('You are doing well.')).toBeInTheDocument();
    // Verify it called with the habits in context
    expect(analyzeHabitPatternsMock).toHaveBeenCalledWith('test-household', mockHouseholdContext.habits);
  });

  it('handles analysis error', async () => {
    const user = userEvent.setup();
    analyzeHabitPatternsMock.mockRejectedValue(new Error('API Error'));
    const toast = (await import('react-hot-toast')).default;

    render(<HabitCoach />);

    await user.click(screen.getByRole('button', { name: /Analyze My Habits/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('API Error');
    });
  });
});
