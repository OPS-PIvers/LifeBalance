import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import HabitCard from './HabitCard';
import { Habit } from '../../types/schema';

// Mock context
const { mockHouseholdContext } = vi.hoisted(() => ({
  mockHouseholdContext: {
    toggleHabit: vi.fn(),
    deleteHabit: vi.fn(),
    resetHabit: vi.fn(),
    activeChallenge: null,
    freezeBank: { tokens: 3 },
    useFreezeBankToken: vi.fn(),
  }
}));

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => mockHouseholdContext,
}));

// Mock child modals
vi.mock('../modals/HabitFormModal', () => ({
  default: () => <div data-testid="habit-form-modal" />
}));

vi.mock('../modals/HabitSubmissionLogModal', () => ({
  default: () => <div data-testid="habit-submission-log-modal" />
}));

// Mock Drawer
vi.mock('../ui/Drawer', () => ({
  Drawer: ({ isOpen, children, title }: { isOpen: boolean; children: React.ReactNode; title: string }) => isOpen ? (
    <div data-testid="mobile-drawer">
      <h1>{title}</h1>
      {children}
    </div>
  ) : null
}));

// Mock Lucide icons
vi.mock('lucide-react', () => ({
  X: () => <span data-testid="icon-x" />,
  Flame: () => <span data-testid="icon-flame" />,
  MoreVertical: () => <span data-testid="icon-more-vertical" />,
  Edit2: () => <span data-testid="icon-edit" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Target: () => <span data-testid="icon-target" />,
  Calendar: () => <span data-testid="icon-calendar" />,
  Wrench: () => <span data-testid="icon-wrench" />,
  Snowflake: () => <span data-testid="icon-snowflake" />,
  Copy: () => <span data-testid="icon-copy" />,
}));

// Mock date-fns with controlled dates
vi.mock('date-fns', async () => {
  const actual = await vi.importActual<typeof import('date-fns')>('date-fns');
  return {
    ...actual,
    format: (date: Date | number, formatStr: string) => {
      // Use real format for most cases, but control for testing
      return actual.format(date, formatStr);
    },
    subDays: (_date: Date | number, _days: number) => {
      // Return a fixed "yesterday" date for testing
      return new Date('2024-02-09T12:00:00Z');
    },
  };
});

const mockHabit: Habit = {
  id: 'h1',
  title: 'Test Habit',
  category: 'Health',
  type: 'positive',
  period: 'daily',
  targetCount: 1,
  count: 0,
  streakDays: 0,
  basePoints: 10,
  completedDates: [],
  lastUpdated: '2023-01-01',
  scoringType: 'threshold',
  weatherSensitive: false,
  totalCount: 0
};

const setupMatchMedia = (isDesktop: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: query === '(min-width: 640px)' ? isDesktop : false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // Deprecated
      removeListener: vi.fn(), // Deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

describe('HabitCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true); // Default to Desktop
  });

  it('renders dropdown menu on desktop', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    // Click menu trigger
    await user.click(screen.getByLabelText('Habit options menu'));

    // Check for dropdown content (using role="menu")
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // Verify Drawer is NOT present
    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument();
  });

  it('renders drawer menu on mobile', async () => {
    setupMatchMedia(false); // Mock Mobile

    const user = userEvent.setup();
    render(<HabitCard habit={mockHabit} />);

    // Click menu trigger
    await user.click(screen.getByLabelText('Habit options menu'));

    // Check for Drawer content
    expect(screen.getByTestId('mobile-drawer')).toBeInTheDocument();

    // Verify Dropdown is NOT present
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('HabitCard - Streak Repair', () => {
  const yesterdayStr = '2024-02-09';

  beforeEach(() => {
    vi.clearAllMocks();
    setupMatchMedia(true); // Desktop for easier testing
    mockHouseholdContext.freezeBank = { tokens: 3 };
  });

  const baseHabit: Habit = {
    id: 'h1',
    title: 'Test Habit',
    category: 'Health',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: ['2024-02-07'], // Older completion, not yesterday
    streakDays: 0,
    lastUpdated: '2024-02-10T00:00:00Z',
    weatherSensitive: false,
  };

  it('shows Repair Streak option when eligible (desktop)', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={baseHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.getByText(/Repair Streak \(3\)/)).toBeInTheDocument();
  });

  it('shows Repair Streak option when eligible (mobile)', async () => {
    setupMatchMedia(false);
    const user = userEvent.setup();
    render(<HabitCard habit={baseHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.getByText(/Repair Streak \(3\)/)).toBeInTheDocument();
  });

  it('calls useFreezeBankToken when Repair Streak is clicked (desktop)', async () => {
    const user = userEvent.setup();
    render(<HabitCard habit={baseHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));
    await user.click(screen.getByText(/Repair Streak/));

    expect(mockHouseholdContext.useFreezeBankToken).toHaveBeenCalledWith('h1', yesterdayStr);
  });

  it('calls useFreezeBankToken when Repair Streak is clicked (mobile)', async () => {
    setupMatchMedia(false);
    const user = userEvent.setup();
    render(<HabitCard habit={baseHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));
    await user.click(screen.getByText(/Repair Streak/));

    expect(mockHouseholdContext.useFreezeBankToken).toHaveBeenCalledWith('h1', yesterdayStr);
  });

  it('does NOT show Repair Streak if user has 0 tokens', async () => {
    mockHouseholdContext.freezeBank = { tokens: 0 };
    const user = userEvent.setup();
    render(<HabitCard habit={baseHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak if habit was completed yesterday', async () => {
    const habitCompletedYesterday = {
      ...baseHabit,
      completedDates: [yesterdayStr],
    };
    const user = userEvent.setup();
    render(<HabitCard habit={habitCompletedYesterday} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak for negative habits', async () => {
    const negativeHabit: Habit = {
      ...baseHabit,
      type: 'negative',
    };
    const user = userEvent.setup();
    render(<HabitCard habit={negativeHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak for weekly habits', async () => {
    const weeklyHabit: Habit = {
      ...baseHabit,
      period: 'weekly',
    };
    const user = userEvent.setup();
    render(<HabitCard habit={weeklyHabit} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak if habit has an active streak', async () => {
    const habitWithStreak: Habit = {
      ...baseHabit,
      streakDays: 5,
      completedDates: ['2024-02-08', '2024-02-09'], // Has recent completions
    };
    const user = userEvent.setup();
    render(<HabitCard habit={habitWithStreak} />);

    await user.click(screen.getByLabelText('Habit options menu'));

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });
});
