import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WeeklyRecap } from '@/types/schema';

const mockCore: { recaps: WeeklyRecap[] } = { recaps: [] };
vi.mock('@/contexts/FirebaseHouseholdContext', () => ({
  useHouseholdCore: () => mockCore,
}));

// Strip framer-motion/portal — same approach WeeklyRecapDrawer.test.tsx takes.
vi.mock('@/components/ui/Drawer', () => ({
  Drawer: ({ isOpen, title, children }: { isOpen: boolean; title?: string; children: React.ReactNode }) =>
    isOpen ? (
      <div data-testid="drawer">
        <h2>{title}</h2>
        {children}
      </div>
    ) : null,
}));

import { RecapArchiveDrawer } from './RecapArchiveDrawer';

// Anchors "today" for pastClosedWeeks — the Monday opening 2026-W28, so the
// most recent CLOSED week is 2026-W27 (Mon 2026-06-29 → Sun 2026-07-05),
// matching the rest of this PR's fixtures.
const TODAY = new Date('2026-07-06T09:00:00');

describe('RecapArchiveDrawer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: TODAY });
    mockCore.recaps = [];
  });

  it('renders nothing when closed', () => {
    render(
      <RecapArchiveDrawer isOpen={false} onClose={vi.fn()} onSelectWeek={vi.fn()} pendingWeek={null} />
    );
    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
  });

  it('lists the most recent closed weeks, newest first', () => {
    render(
      <RecapArchiveDrawer isOpen onClose={vi.fn()} onSelectWeek={vi.fn()} pendingWeek={null} />
    );
    const rows = screen.getAllByRole('button', { name: /^Open weekly recap for/ });
    // Newest-first: the most recently closed week (2026-W27, "Week of Jun 29")
    // must be the FIRST row, not buried in the list.
    expect(rows[0]).toHaveAccessibleName('Open weekly recap for 2026-W27');
    expect(screen.getByText('Week of Jun 29')).toBeInTheDocument();
    // The week immediately before it is second.
    expect(rows[1]).toHaveAccessibleName('Open weekly recap for 2026-W26');
  });

  it('calls onSelectWeek with the tapped row’s isoWeek', () => {
    const onSelectWeek = vi.fn();
    render(
      <RecapArchiveDrawer isOpen onClose={vi.fn()} onSelectWeek={onSelectWeek} pendingWeek={null} />
    );
    fireEvent.click(screen.getByLabelText('Open weekly recap for 2026-W27'));
    expect(onSelectWeek).toHaveBeenCalledWith('2026-W27');
  });

  it('shows a pending row as disabled instead of going silently inert', () => {
    render(
      <RecapArchiveDrawer isOpen onClose={vi.fn()} onSelectWeek={vi.fn()} pendingWeek="2026-W27" />
    );
    expect(screen.getByLabelText('Open weekly recap for 2026-W27')).toBeDisabled();
    expect(screen.getByLabelText('Open weekly recap for 2026-W26')).not.toBeDisabled();
  });
});
