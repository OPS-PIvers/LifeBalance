import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Narrow context slices the Dashboard reads. Stub with minimal shapes; the
// gated widgets themselves are mocked to identifiable stubs below.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => ({
    isLoading: false,
    currentUser: { displayName: 'Test User' },
    members: [],
    pendingItemsCount: 0,
  }),
  useFinance: () => ({
    buckets: [],
    transactions: [],
    payCalendarItem: vi.fn(),
    deferCalendarItem: vi.fn(),
    deleteCalendarItem: vi.fn(),
    updateTransactionCategory: vi.fn(),
    updateTransaction: vi.fn(),
    deleteTransaction: vi.fn(),
  }),
  useGamification: () => ({ habits: [] }),
  useTodos: () => ({ updateToDo: vi.fn(), deleteToDo: vi.fn(), completeToDo: vi.fn() }),
}));

// The action queue is mixed-domain (PR4) — not under test here. Stub it empty.
vi.mock('@/hooks/useActionQueue', () => ({
  useActionQueue: () => ({ actionQueue: [] }),
}));

// Gated single-domain widgets — stub to identifiable text so the visibility
// gating is observable regardless of their self-null-on-empty-data behavior.
vi.mock('@/components/dashboard/SafeToSpendHero', () => ({
  SafeToSpendHero: () => <div>STS_HERO</div>,
}));
vi.mock('@/components/dashboard/DailyHabitsWidget', () => ({
  DailyHabitsWidget: () => <div>DAILY_HABITS</div>,
}));

// Mixed-domain / unrelated widgets (PR4 + dormant) — rendered but inert.
vi.mock('@/components/dashboard/PulseStripWidget', () => ({
  PulseStripWidget: () => null,
}));
vi.mock('@/components/dashboard/InsightWidget', () => ({
  InsightWidget: () => null,
}));
vi.mock('@/components/dashboard/ActivityFeedWidget', () => ({
  ActivityFeedWidget: () => null,
}));
vi.mock('@/components/dashboard/KidsChoresWidget', () => ({
  KidsChoresWidget: () => null,
}));
vi.mock('@/components/dashboard/ActionQueueItem', () => ({
  ActionQueueItemCard: () => null,
}));
vi.mock('@/components/budget/AccountPicker', () => ({
  AccountPicker: () => null,
}));

// Module visibility (Plan 090): mocked so each test chooses enabled modules.
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

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>
  );

const TRENDS_LABEL = 'View money trends';

describe('Dashboard module visibility (Plan 090)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('shows SafeToSpendHero, trends button, and DailyHabitsWidget when both domains are on', () => {
    renderDashboard();
    expect(screen.getByText('STS_HERO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TRENDS_LABEL })).toBeInTheDocument();
    expect(screen.getByText('DAILY_HABITS')).toBeInTheDocument();
  });

  it('hides SafeToSpendHero and the trends button when money is off', () => {
    setEnabledModules(['habits']);
    renderDashboard();
    expect(screen.queryByText('STS_HERO')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: TRENDS_LABEL })).not.toBeInTheDocument();
    // Habits widget stays.
    expect(screen.getByText('DAILY_HABITS')).toBeInTheDocument();
  });

  it('hides DailyHabitsWidget when habits is off', () => {
    setEnabledModules(['money']);
    renderDashboard();
    expect(screen.queryByText('DAILY_HABITS')).not.toBeInTheDocument();
    // Money widgets stay.
    expect(screen.getByText('STS_HERO')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TRENDS_LABEL })).toBeInTheDocument();
  });
});
