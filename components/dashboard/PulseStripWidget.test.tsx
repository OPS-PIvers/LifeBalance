import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Habit, ModuleKey, Transaction } from '@/types/schema';
import { PulseStripWidget } from './PulseStripWidget';
import { useFinance, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';

// The widget reads transactions (money) + habits (habits) from these slices.
// `weeklyPoints` is included in the mocked value below since both slice hooks
// return the same superset object in tests, but the widget no longer reads it
// (weekly points are shown in TopToolbar instead).
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: vi.fn(),
  useGamification: vi.fn(),
  // Reached via useDashboardTransactionStats → useMerchantRules. No rules, so
  // every merchant renders as its raw descriptor (the fail-open path).
  useHouseholdCore: () => ({ householdSettings: undefined }),
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
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
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
    setEnabledModules(['money', 'habits', 'lists', 'todos', 'meals', 'shopping']);
  });

  it('renders both cells with grid-cols-2 when money + habits are on', () => {
    render(<PulseStripWidget />);
    expect(screen.queryByText('Points')).not.toBeInTheDocument();
    expect(screen.getByText('Spent')).toBeInTheDocument();
    expect(screen.getByText('Consistency')).toBeInTheDocument();
    expect(gridClass()).toContain('grid-cols-2');
  });

  it('renders only the Spent cell with grid-cols-1 when habits are off', () => {
    setEnabledModules(['money', 'lists', 'todos']);
    render(<PulseStripWidget />);
    expect(screen.getByText('Spent')).toBeInTheDocument();
    expect(screen.queryByText('Points')).not.toBeInTheDocument();
    expect(screen.queryByText('Consistency')).not.toBeInTheDocument();
    expect(gridClass()).toContain('grid-cols-1');
  });

  it('renders only Consistency with grid-cols-1 when money is off', () => {
    setEnabledModules(['habits', 'lists', 'todos']);
    render(<PulseStripWidget />);
    expect(screen.queryByText('Points')).not.toBeInTheDocument();
    expect(screen.getByText('Consistency')).toBeInTheDocument();
    expect(screen.queryByText('Spent')).not.toBeInTheDocument();
    expect(gridClass()).toContain('grid-cols-1');
  });

  it('renders nothing when both money and habits are off', () => {
    setEnabledModules(['lists', 'todos']);
    const { container } = render(<PulseStripWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('still renders when an active streak is the only habits signal (content gate keeps topStreak)', () => {
    // Weekly habit completed this ISO week: topStreak > 0 but no daily habits
    // (consistencyTotal = 0), so the Consistency cell falls back to its "no
    // habits" placeholder. The strip must stay visible rather than self-null.
    const value = {
      transactions: [] as Transaction[],
      habits: [makeHabit({ period: 'weekly', completedDates: ['2026-06-16'] })],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );
    setEnabledModules(['habits', 'lists', 'todos']);

    render(<PulseStripWidget />);
    expect(screen.getByText('Consistency')).toBeInTheDocument();
    expect(screen.getByText('no habits')).toBeInTheDocument();
  });

  it('shows inviting "habits waiting" copy (no percentage) before the first completion of the day', () => {
    // Two daily habits, neither completed today — the morning zero state.
    const value = {
      transactions: [makeTransaction()],
      habits: [
        makeHabit({ id: 'h-1', completedDates: [] }),
        makeHabit({ id: 'h-2', title: 'Stretch', completedDates: [] }),
      ],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );

    render(<PulseStripWidget />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('habits waiting')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
    expect(screen.queryByText('0/2 today')).not.toBeInTheDocument();
  });

  it('uses the singular "habit waiting" when exactly one habit is due', () => {
    const value = {
      transactions: [makeTransaction()],
      habits: [makeHabit({ completedDates: [] })],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );

    render(<PulseStripWidget />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('habit waiting')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  it('switches to the percentage once at least one habit is completed today', () => {
    const value = {
      transactions: [makeTransaction()],
      habits: [
        makeHabit({ id: 'h-1', completedDates: ['2026-06-16'] }),
        makeHabit({ id: 'h-2', title: 'Stretch', completedDates: [] }),
      ],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );

    render(<PulseStripWidget />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1/2 today')).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
  });

  it('still shows 100% when every habit is already done', () => {
    const value = {
      transactions: [makeTransaction()],
      habits: [
        makeHabit({ id: 'h-1', completedDates: ['2026-06-16'] }),
        makeHabit({ id: 'h-2', title: 'Stretch', completedDates: ['2026-06-16'] }),
      ],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );

    render(<PulseStripWidget />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('2/2 today')).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
  });

  it('stays quiet when the only enabled domain (habits) is empty, despite stale spend data', () => {
    // Money is OFF but a transaction still exists (stale). Habits ON but empty.
    // The guard must weigh only enabled-domain content, so the widget hides
    // rather than rendering a zeroed Consistency strip.
    const value = {
      transactions: [makeTransaction()],
      habits: [] as Habit[],
      weeklyPoints: 0,
    };
    vi.mocked(useFinance).mockReturnValue(value as unknown as ReturnType<typeof useFinance>);
    vi.mocked(useGamification).mockReturnValue(
      value as unknown as ReturnType<typeof useGamification>,
    );
    setEnabledModules(['habits', 'lists', 'todos']);

    const { container } = render(<PulseStripWidget />);
    expect(container).toBeEmptyDOMElement();
  });
});
