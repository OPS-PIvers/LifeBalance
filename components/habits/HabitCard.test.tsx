import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import HabitCard from './HabitCard';
import { Habit } from '../../types/schema';

// Hoisted mocks
const { mockHouseholdContext, useFreezeBankTokenMock, toggleHabitMock, deleteHabitMock } = vi.hoisted(() => ({
  mockHouseholdContext: {
    householdId: 'test-household',
    activeChallenge: null,
    freezeBank: { tokens: 3 },
  } as { householdId: string; activeChallenge: null; freezeBank: { tokens: number } },
  useFreezeBankTokenMock: vi.fn(),
  toggleHabitMock: vi.fn(),
  deleteHabitMock: vi.fn(),
}));

vi.mock('../../contexts/FirebaseHouseholdContext', () => ({
  useHousehold: () => ({
    ...mockHouseholdContext,
    toggleHabit: toggleHabitMock,
    deleteHabit: deleteHabitMock,
    resetHabit: vi.fn(),
    useFreezeBankToken: useFreezeBankTokenMock,
  }),
}));

vi.mock('../modals/HabitFormModal', () => ({
  default: () => <div data-testid="habit-form-modal" />,
}));

vi.mock('../modals/HabitSubmissionLogModal', () => ({
  default: () => <div data-testid="submission-log-modal" />,
}));

// Mock icons
vi.mock('lucide-react', () => ({
  X: () => <div data-testid="icon-x" />,
  Flame: () => <div data-testid="icon-flame" />,
  MoreVertical: () => <div data-testid="icon-more" />,
  Edit2: () => <div data-testid="icon-edit" />,
  Trash2: () => <div data-testid="icon-trash" />,
  Target: () => <div data-testid="icon-target" />,
  Calendar: () => <div data-testid="icon-calendar" />,
  Snowflake: () => <div data-testid="icon-snowflake" />,
}));

vi.mock('date-fns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('date-fns')>();
  return {
    ...actual,
    format: (date: Date | number, fmt: string) => {
      // Return fixed string for "yesterday" logic check in component
      // component calls: format(subDays(new Date(), 1), 'yyyy-MM-dd')
      // We can just control what `subDays` returns or just intercept format if we want.
      // But simpler is to allow format to work, and control the input date.
      // However, component uses `new Date()` internally.
      // So we DO need system time mocking OR we mock date-fns to return fixed string.
      // Let's mock subDays to return a known date object, or format to return '2024-02-09' when passed a specific date.
      // Actually, if we remove fake timers, `new Date()` is real.
      // So `subDays(new Date(), 1)` will be yesterday real time.
      // That's hard to test against fixed `completedDates`.
      //
      // Solution: Keep fake timers but fix userEvent setup.
      // Or: Mock `date-fns` `subDays` to ALWAYS return a specific date that we consider "yesterday".
      return actual.format(date, fmt);
    },
    subDays: (date: Date | number, amount: number) => {
        // If the component calls subDays(new Date(), 1), we want it to return '2024-02-09' equivalent.
        // But `new Date()` inside component is unmocked if we remove useFakeTimers.
        // So we can just make subDays return a fixed "yesterday" regardless of input,
        // IF we assume it's only called for that purpose in this component context?
        // Risky.
        //
        // Better: Mock `format` to return '2024-02-09' when it sees the "yesterday" object?
        // No.
        //
        // Let's go back to basics. Vitest + userEvent + FakeTimers works if configured right.
        // The issue might be `vi.setSystemTime` vs `useFakeTimers`.
        // If we ONLY set system time but don't enable full fake timers (loops/intervals), userEvent works.
        return actual.subDays(date, amount);
    }
  };
});

describe('HabitCard - Streak Repair', () => {
  const today = new Date('2024-02-10T12:00:00Z');
  const yesterdayStr = '2024-02-09';

  beforeEach(() => {
    vi.clearAllMocks();
    // Only mock system time, do NOT use full fake timers (which breaks userEvent delay/debounce)
    vi.useFakeTimers({
        shouldAdvanceTime: true,
        toFake: ['Date'] // Only fake Date constructor
    });
    vi.setSystemTime(today);

    // Default context state
    mockHouseholdContext.freezeBank = { tokens: 3 };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupUser() {
    // No special config needed if we only fake 'Date'
    return userEvent.setup();
  }

  const baseHabit: Habit = {
    id: 'h1',
    title: 'Test Habit',
    category: 'Test',
    type: 'positive',
    basePoints: 10,
    scoringType: 'threshold',
    period: 'daily',
    targetCount: 1,
    count: 0,
    totalCount: 0,
    completedDates: ['2024-02-07'], // Older completion
    streakDays: 0,
    lastUpdated: '2024-02-10T00:00:00Z',
    createdBy: 'user1',
    weatherSensitive: false,
  };

  const openMenu = async (user: ReturnType<typeof setupUser>) => {
    const menuButton = screen.getByLabelText('Habit options menu');
    await user.click(menuButton);
  };

  it('shows Repair Streak option when eligible', async () => {
    const user = setupUser();
    render(<HabitCard habit={baseHabit} />);

    await openMenu(user);

    expect(screen.getByText(/Repair Streak \(3\)/)).toBeInTheDocument();
  });

  it('calls useFreezeBankToken when Repair Streak is clicked', async () => {
    const user = setupUser();
    render(<HabitCard habit={baseHabit} />);

    await openMenu(user);
    await user.click(screen.getByText(/Repair Streak/));

    expect(useFreezeBankTokenMock).toHaveBeenCalledWith('h1', yesterdayStr);
  });

  it('does NOT show Repair Streak if user has 0 tokens', async () => {
    const user = setupUser();
    mockHouseholdContext.freezeBank = { tokens: 0 };
    render(<HabitCard habit={baseHabit} />);

    await openMenu(user);

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak if habit was completed yesterday', async () => {
    const user = setupUser();
    const habitCompletedYesterday = {
      ...baseHabit,
      completedDates: [yesterdayStr],
    };
    render(<HabitCard habit={habitCompletedYesterday} />);

    await openMenu(user);

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak for negative habits', async () => {
    const user = setupUser();
    const negativeHabit: Habit = {
      ...baseHabit,
      type: 'negative',
    };
    render(<HabitCard habit={negativeHabit} />);

    await openMenu(user);

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });

  it('does NOT show Repair Streak for weekly habits', async () => {
    const user = setupUser();
    const weeklyHabit: Habit = {
      ...baseHabit,
      period: 'weekly',
    };
    render(<HabitCard habit={weeklyHabit} />);

    await openMenu(user);

    expect(screen.queryByText(/Repair Streak/)).not.toBeInTheDocument();
  });
});
