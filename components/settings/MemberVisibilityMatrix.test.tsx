import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

// A managed kid profile — no login, so this matrix is the ONLY place anyone
// can hide their Home or set their landing screen.
const kid: HouseholdMember = {
  uid: 'm-kid',
  displayName: 'Kiddo',
  role: 'member',
  isManaged: true,
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

  // The gap this file exists to close (found independently by two
  // integration reviewers): 2F.1 reserved 'home' as a VisibilityKey, 2F.2
  // exposed a toggle for it in MyViewSettings, but this matrix — derived
  // purely from NAV_PAGES — structurally could not surface a Home row, so
  // nobody could hide a managed kid's Home or set their landing screen.
  describe('Home row + landing-screen picker (fix for the missing row)', () => {
    it('exposes a Home toggle an admin can use to hide Home for another member', () => {
      render(
        <MemberVisibilityMatrix
          members={[alice, bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      expect(screen.getByRole('checkbox', { name: 'Show Home for Alice' })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Show Home for Bob' })).toBeChecked();
    });

    it('calls onUpdateMember with hiddenKeys including "home" when an admin hides Home for another member', () => {
      const onUpdateMember = vi.fn();
      render(
        <MemberVisibilityMatrix
          members={[alice, bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={onUpdateMember}
        />
      );

      screen.getByRole('checkbox', { name: 'Show Home for Bob' }).click();

      expect(onUpdateMember).toHaveBeenCalledWith('m-bob', { hiddenKeys: ['home'] });
    });

    it('the Home row exposes no household toggle — Home has no household layer', () => {
      render(
        <MemberVisibilityMatrix
          members={[alice, bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      // Every OTHER section header carries a household switch (e.g. Habits,
      // Money, Lists) — Home must not, since it isn't a `ModuleKey` and isn't
      // in `NAV_PAGES`. Asserting there's no "Toggle Home for the household"
      // switch anywhere pins that it's absent, not merely disabled.
      expect(
        screen.queryByRole('checkbox', { name: 'Toggle Home for the household' })
      ).not.toBeInTheDocument();
      // Sanity check the query itself would find a real section's household
      // switch, so an absent-Home assertion isn't just a typo'd name.
      expect(
        screen.getByRole('checkbox', { name: 'Toggle Habits for the household' })
      ).toBeInTheDocument();
    });

    it("lets an admin set another member's landing screen, offering only that member's reachable destinations", () => {
      const onUpdateMember = vi.fn();
      render(
        <MemberVisibilityMatrix
          // Alice hid Trends (a Money leaf), which doesn't remove Money
          // entirely — the landing-screen picker should still offer Money.
          members={[alice, bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={onUpdateMember}
        />
      );

      const bobLanding = screen.getByRole('combobox', {
        name: 'Landing screen for Bob',
      }) as HTMLSelectElement;
      fireEvent.change(bobLanding, { target: { value: 'money' } });

      expect(onUpdateMember).toHaveBeenCalledWith('m-bob', { homeScreen: 'money' });
    });

    it('renders the landing-screen picker as the Select primitive with a >=44px touch target', () => {
      render(
        <MemberVisibilityMatrix
          members={[alice, bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      const bobLanding = screen.getByRole('combobox', { name: 'Landing screen for Bob' });
      // `rounded-btn` + `focus:ring-2 focus:ring-accent-500/40` come from the
      // Select primitive's shared FIELD_BASE recipe (components/ui/fieldStyles.ts)
      // — a hand-rolled <select> wouldn't carry them. `min-h-11` is this call
      // site's override that keeps the touch target >=44px (DESIGN.md's
      // Accessibility section) to match the Switch cells beside it, which get
      // their 44px target from a `h-11 w-11` wrapping label instead.
      expect(bobLanding.className).toContain('rounded-btn');
      expect(bobLanding.className).toContain('focus:ring-2');
      expect(bobLanding.className).toContain('min-h-11');
    });

    it("a managed kid's row supports both hiding Home and setting a landing screen — the only way, since kids have no login", () => {
      const onUpdateMember = vi.fn();
      render(
        <MemberVisibilityMatrix
          members={[alice, kid]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={onUpdateMember}
        />
      );

      screen.getByRole('checkbox', { name: 'Show Home for Kiddo' }).click();
      expect(onUpdateMember).toHaveBeenCalledWith('m-kid', { hiddenKeys: ['home'] });

      const kidLanding = screen.getByRole('combobox', {
        name: 'Landing screen for Kiddo',
      }) as HTMLSelectElement;
      fireEvent.change(kidLanding, { target: { value: 'habits' } });
      expect(onUpdateMember).toHaveBeenCalledWith('m-kid', { homeScreen: 'habits' });
    });
  });
});
