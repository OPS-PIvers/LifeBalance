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
      // Accessibility section) to match the Switch rows above it, which get
      // their 44px target from a `h-11 w-11` wrapping label instead.
      expect(bobLanding.className).toContain('rounded-btn');
      expect(bobLanding.className).toContain('focus:ring-2');
      expect(bobLanding.className).toContain('min-h-11');
    });

    // CRIT-03: the old matrix cell clamped this select to `max-w-28`, which at
    // 375px measured 55-61px wide — "Home" rendered as "Ho…" and every longer
    // option was equally unreadable. `w-full` (from the Select primitive's
    // FIELD_BASE) with no max-width clamp is what makes the value legible.
    it('lets the landing-screen picker span the full content width (no max-width clamp)', () => {
      render(
        <MemberVisibilityMatrix
          members={[alice, bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      const bobLanding = screen.getByRole('combobox', { name: 'Landing screen for Bob' });
      expect(bobLanding.className).toContain('w-full');
      expect(bobLanding.className).not.toMatch(/\bmax-w-/);
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

  /**
   * CRIT-03 — the 4-column table became one stacked section per member. These
   * pin the two things the reflow could plausibly have broken: that BOTH
   * visibility layers survived, and that the permission model didn't move.
   */
  describe('stacked per-member layout (CRIT-03)', () => {
    const carol: HouseholdMember = {
      uid: 'm-carol',
      displayName: 'Carol',
      role: 'member',
      points,
      hiddenKeys: [],
    };

    it('renders the household layer exactly ONCE, however many members there are', () => {
      // FOUR members — the case that broke the table outright. The household
      // switches must not multiply with them: they are one shared field
      // (`Household.moduleVisibility`), not a per-member choice.
      render(
        <MemberVisibilityMatrix
          members={[alice, bob, carol, kid]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      expect(screen.getAllByRole('checkbox', { name: 'Toggle Habits for the household' })).toHaveLength(1);
      expect(screen.getAllByRole('checkbox', { name: 'Toggle Budget for the household' })).toHaveLength(1);
      expect(screen.getAllByRole('checkbox', { name: 'Toggle Lists for the household' })).toHaveLength(1);
      // Lists' three sub-tabs keep their OWN household toggles — each is
      // independently gated, unlike Habits'/Money's leaves.
      expect(screen.getAllByRole('checkbox', { name: 'Toggle To-Dos for the household' })).toHaveLength(1);
      expect(screen.getAllByRole('checkbox', { name: 'Toggle Meals for the household' })).toHaveLength(1);
      expect(screen.getAllByRole('checkbox', { name: 'Toggle Shopping for the household' })).toHaveLength(1);
    });

    it('gives each of four members their own switches and their own landing-screen picker', () => {
      render(
        <MemberVisibilityMatrix
          members={[alice, bob, carol, kid]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      for (const name of ['Alice', 'Bob', 'Carol', 'Kiddo']) {
        expect(screen.getByRole('checkbox', { name: `Show Home for ${name}` })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: `Show Overview for ${name}` })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: `Landing screen for ${name}` })).toBeInTheDocument();
      }
    });

    it('a non-admin (own column only) still gets their own editor AND the any-member household switches', () => {
      // Settings passes `[currentUser]` for a non-admin. The household layer
      // was never admin-only and must not regress to it, so a lone non-admin
      // still sees — and can flip — the household switches.
      const onToggleModule = vi.fn();
      render(
        <MemberVisibilityMatrix
          members={[bob]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={onToggleModule}
          onUpdateMember={vi.fn()}
        />
      );

      expect(screen.getByRole('checkbox', { name: 'Show Overview for Bob' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Landing screen for Bob' })).toBeInTheDocument();
      // Nobody else's controls leaked in.
      expect(screen.queryByRole('checkbox', { name: 'Show Overview for Alice' })).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Landing screen for Alice' })).not.toBeInTheDocument();

      const householdMoney = screen.getByRole('checkbox', { name: 'Toggle Budget for the household' });
      expect(householdMoney).not.toBeDisabled();
      householdMoney.click();
      expect(onToggleModule).toHaveBeenCalledWith('money', false);
    });

    it('captions a locked row so the reason survives the two layers being split apart', () => {
      // In the table, "greyed row" was legible because the section header
      // carrying the household switch sat directly above it. Stacked, the
      // household switch is a screen away, so each locked row says why.
      render(
        <MemberVisibilityMatrix
          members={[alice]}
          settings={{ moduleVisibility: { money: false } }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      // Money has 7 leaves, every one of them locked for the one member shown.
      expect(screen.getAllByText('Off for the household')).toHaveLength(7);
      expect(screen.getByRole('checkbox', { name: 'Show Overview for Alice' })).toBeDisabled();
    });

    it("wires a locked row's caption to the switch via aria-describedby, and omits it when unlocked", () => {
      // The caption used to be only a visual sibling of the switch — a
      // screen-reader user tabbing to it heard just "checkbox, dimmed" with
      // no explanation. Pin that the disabled switch's aria-describedby
      // resolves to an element containing the caption text, and that an
      // unlocked switch (no caption rendered) carries no aria-describedby.
      render(
        <MemberVisibilityMatrix
          members={[alice]}
          settings={{ moduleVisibility: { money: false } }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      const lockedOverview = screen.getByRole('checkbox', { name: 'Show Overview for Alice' });
      const describedbyId = lockedOverview.getAttribute('aria-describedby');
      expect(describedbyId).toBeTruthy();
      expect(document.getElementById(describedbyId as string)).toHaveTextContent(
        'Off for the household'
      );

      // Track (Habits) is untouched by the money:false household toggle, so
      // its switch stays unlocked and must not carry aria-describedby.
      const unlockedTrack = screen.getByRole('checkbox', { name: 'Show Track for Alice' });
      expect(unlockedTrack).not.toHaveAttribute('aria-describedby');
    });

    it('names each member section with the editorial serif heading, not an uppercase eyebrow', () => {
      // DESIGN.md §3's decision test: a member's block and the view groups
      // inside it are CONTENT groupings, so they take `SectionHeading`
      // (font-display, sentence case) — `Eyebrow` micro-caps label controls.
      render(
        <MemberVisibilityMatrix
          members={[alice]}
          settings={{ moduleVisibility: undefined }}
          onToggleModule={vi.fn()}
          onUpdateMember={vi.fn()}
        />
      );

      const memberHeading = screen.getByRole('heading', { name: /Alice/ });
      expect(memberHeading.className).toContain('font-display');
      expect(memberHeading.className).not.toContain('uppercase');

      const groupHeading = screen.getByRole('heading', { name: 'Budget' });
      expect(groupHeading.className).toContain('font-display');
      expect(groupHeading.className).not.toContain('uppercase');
    });
  });
});
