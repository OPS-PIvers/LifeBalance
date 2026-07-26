import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import BottomNav from './BottomNav';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import type { ModuleKey } from '@/types/schema';

// Finance slice — BottomNav only reads `transactions` for the Money badge.
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useFinance: () => ({ transactions: [] as unknown[] }),
}));

// Keep the lazy CaptureModal + preload off the test path.
vi.mock('@/utils/preloadOnIdle', () => ({
  preloadOnIdle: () => () => {},
}));
vi.mock('@/components/ui/LazyMount', () => ({
  LazyMount: () => null,
}));
vi.mock('@/components/modals/CaptureModal', () => ({
  default: () => null,
}));

// Module visibility (Plan 090): mocked so each test can choose which modules
// are enabled.
vi.mock('@/hooks/useModuleVisibility', () => ({
  useModuleVisibility: vi.fn(),
}));

/**
 * Configure the mocked hook so only `enabled` modules are on. Home defaults to
 * visible (matching every existing test's assumption); pass `homeVisible:
 * false` to cover the 2F.2 case where the member has hidden it.
 */
const setEnabledModules = (enabled: ModuleKey[], homeVisible = true) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    // Plan footer needs the master toggle + at least one sub-tab; derive it.
    isPlanVisible:
      enabled.includes('lists') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    // A sub-tab is only reachable when the Plan master AND the sub-tab are on.
    isPlanTabVisible: (tab) => enabled.includes('lists') && enabled.includes(tab),
    isHomeVisible: homeVisible,
  });
};

const renderNav = () =>
  render(
    <MemoryRouter>
      <BottomNav />
    </MemoryRouter>
  );

const FAB_LABEL = 'Capture transaction, task, or item';

describe('BottomNav', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping']);
  });

  it('shows the capture FAB when all modules are enabled', () => {
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
  });

  it('shows the FAB via the Lists path when Lists + a sub-tab (todos) are on but money is off', () => {
    setEnabledModules(['lists', 'todos']);
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
  });

  it('shows the FAB via the money path when only money is enabled', () => {
    setEnabledModules(['money']);
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
  });

  it('hides the FAB when sub-tab flags are on but Lists is off (destinations unreachable)', () => {
    // todos + shopping flags on, but Lists master off → their capture
    // destinations are hidden, so no capture type is actually reachable.
    setEnabledModules(['habits', 'todos', 'shopping']);
    renderNav();
    expect(screen.queryByRole('button', { name: FAB_LABEL })).not.toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('hides the FAB when money, todos, and shopping are all disabled', () => {
    // Only Habits left — no capture type would be available.
    setEnabledModules(['habits']);
    renderNav();
    expect(screen.queryByRole('button', { name: FAB_LABEL })).not.toBeInTheDocument();
    // Nav itself still renders (Home anchors the left group).
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  // 2F.1: the footer label follows the renamed 'lists' ModuleKey; the route
  // has been /lists all along.
  it("labels the Lists nav item 'Lists', never 'Plan'", () => {
    renderNav();
    expect(screen.getByText('Lists')).toBeInTheDocument();
    expect(screen.queryByText('Plan')).not.toBeInTheDocument();
  });

  // 2F.1 collapse cascade: isModuleEnabled / isPlanVisible go false once every
  // leaf of a page is hidden, so the page's nav item disappears with it.
  it('drops a page from the nav when it has no reachable view', () => {
    setEnabledModules(['money']);
    renderNav();
    expect(screen.getByText('Money')).toBeInTheDocument();
    expect(screen.queryByText('Lists')).not.toBeInTheDocument();
    expect(screen.queryByText('Habits')).not.toBeInTheDocument();
  });

  // 2F.2: Home becomes toggleable — a member can hide it like any other page.
  it('drops Home from the nav once the member hides it, leaving the other pages', () => {
    setEnabledModules(['habits', 'money', 'lists', 'todos', 'meals', 'shopping'], false);
    renderNav();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.getByText('Habits')).toBeInTheDocument();
    expect(screen.getByText('Money')).toBeInTheDocument();
    expect(screen.getByText('Lists')).toBeInTheDocument();
  });

  // Home being hideable (2F.2) means a member can now hide EVERY page at once
  // (Home via `hiddenKeys`, the rest via household `moduleVisibility`) — the
  // footer must not go empty; it falls back to a direct Settings link.
  it('falls back to a Settings link when every other nav item is hidden', () => {
    setEnabledModules([], false);
    renderNav();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
    expect(screen.queryByText('Habits')).not.toBeInTheDocument();
    expect(screen.queryByText('Money')).not.toBeInTheDocument();
    expect(screen.queryByText('Lists')).not.toBeInTheDocument();
    const settingsLink = screen.getByText('Settings').closest('a');
    expect(settingsLink).toHaveAttribute('href', '/settings');
    // No capture destination is reachable either, so the FAB stays hidden.
    expect(screen.queryByRole('button', { name: FAB_LABEL })).not.toBeInTheDocument();
  });
});
