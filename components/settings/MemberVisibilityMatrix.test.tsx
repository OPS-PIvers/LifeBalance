import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberVisibilityMatrix } from './MemberVisibilityMatrix';
import type { HouseholdMember } from '@/types/schema';

/**
 * Component coverage for the 2F.3 admin matrix (utils/moduleVisibility.ts's
 * `getVisibilityMatrixSections`/`isMatrixRowLocked` already have pure unit
 * tests; before this file NOTHING rendered `MemberVisibilityMatrix` itself).
 *
 * Non-admin exclusion is deliberately NOT tested here — this component has no
 * role gate of its own (`Settings.tsx` decides whether to render it at all);
 * that assertion lives in pages/Settings.test.tsx, rendered as a real
 * non-admin, alongside the rest of the admin-only gating.
 */

const points = { daily: 0, weekly: 0, total: 0 };

// Two members with DISTINCT `hiddenKeys` so per-member independence is
// actually observable (unlike the three Test-Mode seed members, which used to
// all resolve to the same default set).
const alice: HouseholdMember = {
  uid: 'm-alice',
  displayName: 'Alice',
  role: 'admin',
  points,
  hiddenKeys: ['trends'],
};

const bob: HouseholdMember = {
  uid: 'm-bob',
  displayName: 'Bob',
  role: 'member',
  points,
  hiddenKeys: [],
};

describe('MemberVisibilityMatrix', () => {
  it("reflects each member's own hiddenKeys independently", () => {
    render(
      <MemberVisibilityMatrix
        members={[alice, bob]}
        settings={{ moduleVisibility: undefined }}
        onToggleModule={vi.fn()}
        onUpdateMember={vi.fn()}
      />
    );

    // Alice hid 'trends' — her cell for the Trends row is off.
    expect(screen.getByRole('checkbox', { name: 'Show Trends for Alice' })).not.toBeChecked();
    // Bob's hiddenKeys is an explicit empty list — his cell stays on.
    expect(screen.getByRole('checkbox', { name: 'Show Trends for Bob' })).toBeChecked();

    // A row neither of them hid renders on for both, confirming the two
    // switches aren't just both reading one shared value.
    expect(screen.getByRole('checkbox', { name: 'Show Overview for Alice' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show Overview for Bob' })).toBeChecked();
  });

  it('locks every member cell in a row whose household module is off, regardless of their hiddenKeys', () => {
    render(
      <MemberVisibilityMatrix
        members={[alice, bob]}
        settings={{ moduleVisibility: { money: false } }}
        onToggleModule={vi.fn()}
        onUpdateMember={vi.fn()}
      />
    );

    // Money is off at the household level, so every Money leaf row —
    // including 'Overview', which neither member hid individually — renders
    // every member's switch unchecked AND disabled.
    const aliceOverview = screen.getByRole('checkbox', { name: 'Show Overview for Alice' });
    const bobOverview = screen.getByRole('checkbox', { name: 'Show Overview for Bob' });
    expect(aliceOverview).not.toBeChecked();
    expect(aliceOverview).toBeDisabled();
    expect(bobOverview).not.toBeChecked();
    expect(bobOverview).toBeDisabled();

    // A row outside the disabled section is unaffected.
    expect(screen.getByRole('checkbox', { name: 'Show Track for Alice' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Show Track for Alice' })).not.toBeDisabled();
  });

  it('calls onUpdateMember with that member\'s toggled hiddenKeys list, not the other member\'s', () => {
    const onUpdateMember = vi.fn();
    render(
      <MemberVisibilityMatrix
        members={[alice, bob]}
        settings={{ moduleVisibility: undefined }}
        onToggleModule={vi.fn()}
        onUpdateMember={onUpdateMember}
      />
    );

    screen.getByRole('checkbox', { name: 'Show Overview for Bob' }).click();

    expect(onUpdateMember).toHaveBeenCalledTimes(1);
    expect(onUpdateMember).toHaveBeenCalledWith('m-bob', { hiddenKeys: ['overview'] });
  });
});
