import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Habit, ModuleKey, Transaction } from '@/types/schema';
import { PulseStripWidget } from './PulseStripWidget';
import { useFinance, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';

// The widget reads transactions (money) + habits/weeklyPoints (habits) from
// these slices. Both slice hooks return the same superset object in tests.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
  useGamification: vi.fn(),
}));

// Currency formatter — keep it deterministic and dependency-free.
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (amount: number) => `$${amount}`,
}));

// Module visibility (Plan 090): mocked so each test chooses which domains are on.
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('plan') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('plan') && enabled.includes(tab),
  });
};

// A daily, parent-owned, completed-today habit so the consistency metric and the
// "nothing to balance" guard are both non-zero (habits domain has content).
const makeHabit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'h-1',
    title: 'Read',
    category: 'General',
    type: 'positive',
    period: 'daily',
    basePoints: 10,
    scoringType: 'threshold',
    targetCount: 1,
    count: 1,
    totalCount: 1,
    completedDates: [],
    streakDays: 0,
    lastUpdated: '2026-06-16T00:00:00.000Z',
    weatherSensitive: false,
    ...overrides,
  } as unknown as Habit);

// A verified, non-income transaction dated this week so the spend metric is
// non-zero (money domain has content).
const makeTransaction = (overrides: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    amount: 50,
    merchant: 'Store',
    category: 'Groceries',
    date: '2026-06-16',
    status: 'verified',
    isRecurring: false,
    source: 'manual',
    autoCategorized: false,
    ...overrides,
  } as unknown as Transaction);

const setData = () => {
  const value = {
    transactions: [makeTransaction()],
    habits: [makeHabit()],
    weeklyPoints: 120,
  };
  vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
  vi.mocked(useGamification).mockReturnValue(
    value as unknown as ReturnType<typeof useGamification>,
  );
};

/** Returns the className of the inner grid (the band that holds the cells). */
const gridClass = (): string => {
  const grid = document.querySelector('div.grid');
  return grid?.className ?? '';
};

describe('PulseStripWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Pin "today" so date-based metrics are stable.
    vi.useFakeTimers({ now: new Date('2026-06-16T12:00:00') });
    setData();
    setEnabledModules(['money', 'habits', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('renders all three cells with grid-cols-3 when money + habits are on', () => {
    render(<PulseStripWidget />);
    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('Spent')).toBeInTheDocument();
    expect(screen.getByText('Consistency')).toBeInTheDocument();
    expect(gridClass()).toContain('grid-cols-3');
  });

  it('renders only the Spent cell with grid-cols-1 when habits are off', () => {
    setEnabledModules(['money', 'plan', 'todos']);
    render(<PulseStripWidget />);
    expect(screen.getByText('Spent')).toBeInTheDocument();
    expect(screen.queryByText('Points')).not.toBeInTheDocument();
    expect(screen.queryByText('Consistency')).not.toBeInTheDocument();
    expect(gridClass()).toContain('grid-cols-1');
  });

  it('renders Points + Consistency with grid-cols-2 when money is off', () => {
    setEnabledModules(['habits', 'plan', 'todos']);
    render(<PulseStripWidget />);
    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('Consistency')).toBeInTheDocument();
    expect(screen.queryByText('Spent')).not.toBeInTheDocument();
    expect(gridClass()).toContain('grid-cols-2');
  });

  it('renders nothing when both money and habits are off', () => {
    setEnabledModules(['plan', 'todos']);
    const { container } = render(<PulseStripWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the static "earned" label under Points even when a streak is active (no flame line)', () => {
    // A daily habit completed today would previously have rendered the flame
    // sub-line; DailyHabitsWidget now owns the streak signal on Home.
    const value = {
      transactions: [makeTransaction()],
      habits: [makeHabit({ completedDates: ['2026-06-16'], streakDays: 1 })],
      weeklyPoints: 120,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );

    render(<PulseStripWidget />);
    expect(screen.getByText('earned')).toBeInTheDocument();
    expect(screen.queryByText(/best active streak/)).not.toBeInTheDocument();
  });

  it('still renders when an active streak is the only habits signal (content gate keeps topStreak)', () => {
    // Weekly habit completed this ISO week: topStreak > 0 but weeklyPoints = 0
    // and no daily habits (consistencyTotal = 0). The strip must stay visible.
    const value = {
      transactions: [] as Transaction[],
      habits: [makeHabit({ period: 'weekly', completedDates: ['2026-06-16'] })],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );
    setEnabledModules(['habits', 'plan', 'todos']);

    render(<PulseStripWidget />);
    expect(screen.getByText('Points')).toBeInTheDocument();
    expect(screen.getByText('earned')).toBeInTheDocument();
  });

  it('stays quiet when the only enabled domain (habits) is empty, despite stale spend data', () => {
    // Money is OFF but a transaction still exists (stale). Habits ON but empty.
    // The guard must weigh only enabled-domain content, so the widget hides
    // rather than rendering a zeroed Points/Consistency strip.
    const value = {
      transactions: [makeTransaction()],
      habits: [] as Habit[],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );
    setEnabledModules(['habits', 'plan', 'todos']);

    const { container } = render(<PulseStripWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
