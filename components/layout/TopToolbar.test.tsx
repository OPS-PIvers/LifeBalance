import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Narrow context slices TopToolbar reads. Stub each with the minimal shape.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ safeToSpend: 1234 }),
  useGamification: () => ({ dailyPoints: 10, weeklyPoints: 50 }),
  useHouseholdCore: () => ({ household: { pendingRedemptions: [] } }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { displayName: 'Test User', photoURL: null } }),
}));
vi.mock('@/hooks/useKidModeEnabled', () => ({
  useKidModeEnabled: () => false,
}));
vi.mock('@/hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `$${n}`,
}));

// Keep the lazy FeedbackModal + preload off the test path.
vi.mock('@/utils/preloadOnIdle', () => ({
  preloadOnIdle: () => () => {},
}));
vi.mock('@/components/ui/LazyMount', () => ({
  LazyMount: () => null,
}));
vi.mock('@/components/modals/FeedbackModal', () => ({
  default: () => null,
}));
// ProfileMenu pulls in heavy deps; the toolbar visibility logic doesn't need it.
vi.mock('./ProfileMenu', () => ({
  default: () => null,
}));

// Module visibility (Plan 090): mocked so each test chooses enabled modules.
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/** Configure the mocked hook so only `enabled` modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    isPlanVisible:
      enabled.includes('plan') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    isPlanTabVisible: (tab) => enabled.includes('plan') && enabled.includes(tab),
  });
};

const renderToolbar = () =>
  render(
    <MemoryRouter>
      <TopToolbar />
    </MemoryRouter>
  );

const STS_LABEL = 'View Safe to Spend details';
const REWARDS_LABEL = 'View Rewards and Points breakdown';
const FEEDBACK_LABEL = 'Send Feedback';
const PROFILE_LABEL = 'Open Profile Menu';

describe('TopToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('shows Safe-to-Spend and the points/Rewards cluster when both domains are on', () => {
    renderToolbar();
    expect(screen.getByRole('button', { name: STS_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: REWARDS_LABEL })).toBeInTheDocument();
  });

  it('hides Safe-to-Spend when money is off (keeps points/Rewards)', () => {
    setEnabledModules(['habits']);
    renderToolbar();
    expect(screen.queryByRole('button', { name: STS_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: REWARDS_LABEL })).toBeInTheDocument();
  });

  it('hides the points/Rewards cluster when habits is off (keeps Safe-to-Spend)', () => {
    setEnabledModules(['money']);
    renderToolbar();
    expect(screen.queryByRole('button', { name: REWARDS_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: STS_LABEL })).toBeInTheDocument();
  });

  it('shows only Feedback + Profile when both money and habits are off', () => {
    setEnabledModules([]);
    renderToolbar();
    expect(screen.queryByRole('button', { name: STS_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: REWARDS_LABEL })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: FEEDBACK_LABEL })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: PROFILE_LABEL })).toBeInTheDocument();
  });
});
