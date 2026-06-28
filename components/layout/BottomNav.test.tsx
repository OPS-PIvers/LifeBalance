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

/** Configure the mocked hook so only `enabled` modules are on. */
const setEnabledModules = (enabled: ModuleKey[]) => {
  vi.mocked(useModuleVisibility).mockReturnValue({
    isModuleEnabled: (key: ModuleKey) => enabled.includes(key),
    // Plan footer needs the master toggle + at least one sub-tab; derive it.
    isPlanVisible:
      enabled.includes('plan') &&
      (enabled.includes('todos') || enabled.includes('meals') || enabled.includes('shopping')),
    // A sub-tab is only reachable when the Plan master AND the sub-tab are on.
    isPlanTabVisible: (tab) => enabled.includes('plan') && enabled.includes(tab),
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
    setEnabledModules(['habits', 'money', 'plan', 'todos', 'meals', 'shopping']);
  });

  it('shows the capture FAB when all modules are enabled', () => {
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
  });

  it('shows the FAB via the Plan path when Plan + a sub-tab (todos) are on but money is off', () => {
    setEnabledModules(['plan', 'todos']);
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
  });

  it('shows the FAB via the money path when only money is enabled', () => {
    setEnabledModules(['money']);
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
  });

  it('hides the FAB when sub-tab flags are on but Plan is off (destinations unreachable)', () => {
    // todos + shopping flags on, but Plan master off → their capture
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
});
