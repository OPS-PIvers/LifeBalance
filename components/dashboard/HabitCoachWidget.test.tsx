import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Habit, HabitInsightsDoc } from '@/types/schema';
import { HabitCoachWidget } from './HabitCoachWidget';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';

vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useGamification: vi.fn(),
}));

const makeHabit = (overrides: Partial<Habit> = {}): Habit => ({
  id: 'h-1',
  title: 'Read 30 mins',
  type: 'positive',
  scoringMode: 'threshold',
  targetCount: 1,
  points: 10,
  period: 'daily',
  streakDays: 0,
  completedDates: [],
  archived: false,
  ...overrides,
} as Habit);

const setGamification = (opts: {
  habits: Habit[];
  habitPatterns: HabitInsightsDoc | null;
  isGeneratingHabitPatterns?: boolean;
  refreshHabitPatterns?: () => Promise<void>;
}) => {
  vi.mocked(useGamification).mockReturnValue({
    habits: opts.habits,
    habitPatterns: opts.habitPatterns,
    isGeneratingHabitPatterns: opts.isGeneratingHabitPatterns ?? false,
    refreshHabitPatterns: opts.refreshHabitPatterns ?? vi.fn(),
  } as unknown as ReturnType<typeof useGamification>);
};

describe('HabitCoachWidget (F-DASH-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when there are no habits', () => {
    setGamification({ habits: [], habitPatterns: null });
    const { container } = render(<HabitCoachWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an empty-state prompt with an Analyze button before first generation', () => {
    setGamification({ habits: [makeHabit()], habitPatterns: null });
    render(<HabitCoachWidget />);
    expect(screen.getByText(/Get a coaching read/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Analyze/i })).toBeInTheDocument();
  });

  it('renders each pattern insight with its title and description', () => {
    setGamification({
      habits: [makeHabit()],
      habitPatterns: {
        generatedAt: '2026-07-14T00:00:00.000Z',
        patterns: [
          { title: 'On Fire!', description: 'Great streak this week.', type: 'praise' },
          { title: 'Weekend Slump Detected', description: 'You tend to skip on weekends.', type: 'suggestion' },
        ],
      },
    });
    render(<HabitCoachWidget />);
    expect(screen.getByText('On Fire!')).toBeInTheDocument();
    expect(screen.getByText('Great streak this week.')).toBeInTheDocument();
    expect(screen.getByText('Weekend Slump Detected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/i })).toBeInTheDocument();
  });

  it('shows a loading state and disables the button while generating', () => {
    setGamification({
      habits: [makeHabit()],
      habitPatterns: null,
      isGeneratingHabitPatterns: true,
    });
    render(<HabitCoachWidget />);
    expect(screen.getByRole('button', { name: /Analyzing…/i })).toBeDisabled();
  });

  it('calls refreshHabitPatterns when the action button is clicked', () => {
    const refreshHabitPatterns = vi.fn();
    setGamification({ habits: [makeHabit()], habitPatterns: null, refreshHabitPatterns });
    render(<HabitCoachWidget />);
    fireEvent.click(screen.getByRole('button', { name: /Analyze/i }));
    expect(refreshHabitPatterns).toHaveBeenCalledTimes(1);
  });
});
