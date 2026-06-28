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
    isPlanTabVisible: () => true,
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

  it('shows the FAB when only one capture module (todos) is enabled', () => {
    setEnabledModules(['todos']);
    renderNav();
    expect(screen.getByRole('button', { name: FAB_LABEL })).toBeInTheDocument();
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
