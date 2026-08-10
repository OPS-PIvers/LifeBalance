import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import HabitDoneByAvatars, { type DoneByEntry } from './HabitDoneByAvatars';

const entry = (overrides: Partial<DoneByEntry> = {}): DoneByEntry => ({
  memberId: 'paul-uid',
  displayName: 'Paul',
  color: '#285742',
  units: 1,
  streak: 0,
  ...overrides,
});

// The Flame glyph is the only svg this component ever renders (no household
// avatar in these tests, and MemberAvatar's fallback is plain text/img) — one
// per streak chip, so counting them is equivalent to counting chips.
const flameIcons = (container: HTMLElement): Element[] => Array.from(container.querySelectorAll('svg'));

describe('HabitDoneByAvatars', () => {
  it('renders nothing when nobody is credited (untouched rows stay clean)', () => {
    const { container } = render(<HabitDoneByAvatars entries={[]} streakUnit="day" showStreakChips />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one avatar per credited member, in the given order', () => {
    render(
      <HabitDoneByAvatars
        entries={[entry(), entry({ memberId: 'jen-uid', displayName: 'Jen', color: '#b87a29' })]}
        streakUnit="day"
        showStreakChips
      />
    );
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    expect(screen.getByText('Jen completed this')).toBeInTheDocument();
  });

  it('counts multiple completions in the screen-reader text', () => {
    render(<HabitDoneByAvatars entries={[entry({ units: 3 })]} streakUnit="day" showStreakChips />);
    expect(screen.getByText('Paul completed this 3 times')).toBeInTheDocument();
  });

  it('shows NO chip below the ember threshold', () => {
    const { container } = render(
      <HabitDoneByAvatars entries={[entry({ streak: 2 })]} streakUnit="day" showStreakChips />
    );
    expect(flameIcons(container)).toHaveLength(0);
    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
    // The avatar (who did it) still renders even though the streak isn't old enough to chip.
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
  });

  it('lights the ember chip at 3, showing the streak number and its accessible label', () => {
    const { container } = render(
      <HabitDoneByAvatars entries={[entry({ streak: 3 })]} streakUnit="day" showStreakChips />
    );
    expect(flameIcons(container)).toHaveLength(1);
    // The visible glyph+digit are decoration; this is the text that carries the same meaning.
    expect(screen.getByText('3 day streak')).toBeInTheDocument();
    expect(container.textContent).toContain('3');
  });

  it('steps up to flame at 7 and blaze at 30, each still carrying its own streak number', () => {
    const flame = render(<HabitDoneByAvatars entries={[entry({ streak: 7 })]} streakUnit="day" showStreakChips />);
    expect(flameIcons(flame.container)).toHaveLength(1);
    expect(flame.container.textContent).toContain('7');

    const blaze = render(<HabitDoneByAvatars entries={[entry({ streak: 30 })]} streakUnit="day" showStreakChips />);
    expect(flameIcons(blaze.container)).toHaveLength(1);
    expect(blaze.container.textContent).toContain('30');
  });

  it("uses the habit's own cadence word for a weekly habit", () => {
    render(<HabitDoneByAvatars entries={[entry({ streak: 4 })]} streakUnit="week" showStreakChips />);
    expect(screen.getByText('4 week streak')).toBeInTheDocument();
  });

  // 🛡️ The tiers are read in the habit's OWN cadence. A 2-week streak already
  // earns the 2× multiplier, but scored against the DAY thresholds it fell
  // below ember and rendered no chip at all — so a weekly habit paying double
  // showed nothing to explain why.
  it('chips a WEEKLY streak at its own thresholds, not the daily ones', () => {
    const { container } = render(
      <HabitDoneByAvatars entries={[entry({ streak: 2 })]} streakUnit="week" showStreakChips />
    );
    expect(flameIcons(container)).toHaveLength(1);
    expect(screen.getByText('2 week streak')).toBeInTheDocument();
  });

  it('still shows no weekly chip below its own ember threshold', () => {
    // The positive control's negative twin: 1 week is genuinely un-chipworthy
    // (it earns no multiplier), so the fix must not simply chip everything.
    const { container } = render(
      <HabitDoneByAvatars entries={[entry({ streak: 1 })]} streakUnit="week" showStreakChips />
    );
    expect(flameIcons(container)).toHaveLength(0);
    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
  });

  // A "streak" on a negative habit is a run of the thing you are trying to
  // stop; the pill this replaced was positive-only and the gate survives the
  // change of form. Who did it is still shown.
  it('never chips a NEGATIVE habit, however long the run', () => {
    const { container } = render(
      <HabitDoneByAvatars entries={[entry({ streak: 30 })]} streakUnit="day" showStreakChips={false} />
    );
    expect(flameIcons(container)).toHaveLength(0);
    expect(screen.getByText('Paul completed this')).toBeInTheDocument();
    // …and the streak is not announced either, so the chip's meaning is not
    // simply relocated into the screen-reader text.
    expect(screen.queryByText(/streak/)).not.toBeInTheDocument();
  });

  // PAIRING is the requirement that must not be gotten wrong. DOM order alone
  // (chip, then avatar, as flat siblings with one uniform gap) is not enough
  // proof — a reader can't tell a chip belongs to the avatar on ITS side
  // rather than the neighbour's unless proximity says so too. The real
  // structure is: each member gets ONE wrapper containing exactly its own
  // chip (if any) and its own avatar, nothing else.
  it('pairs each streak chip with its own member inside a shared wrapper — never a flat chip/avatar sequence', () => {
    const { container } = render(
      <HabitDoneByAvatars
        entries={[
          entry({ streak: 9 }),
          entry({ memberId: 'jen-uid', displayName: 'Jen', color: '#b87a29', streak: 4 }),
        ]}
        streakUnit="day"
        showStreakChips
      />
    );
    expect(flameIcons(container)).toHaveLength(2);
    expect(screen.getByText('9 day streak')).toBeInTheDocument();
    expect(screen.getByText('4 day streak')).toBeInTheDocument();

    // The row's direct children are per-member WRAPPERS, not flat
    // chip/avatar siblings — a regression back to flat siblings would leave
    // 4 direct children here instead of 2, and the assertions below on each
    // wrapper's own content would fail (a lone chip wrapper has no member
    // name in it).
    const row = container.firstElementChild as HTMLElement;
    const pairs = Array.from(row.children) as HTMLElement[];
    expect(pairs).toHaveLength(2);

    const [paulPair, jenPair] = pairs as [HTMLElement, HTMLElement];
    // Paul's wrapper holds exactly his own chip (one flame glyph, "9") AND
    // his own avatar ("Paul") — not Jen's.
    expect(paulPair.querySelectorAll('svg')).toHaveLength(1);
    expect(paulPair.textContent).toContain('9');
    expect(paulPair.textContent).toContain('Paul');
    expect(paulPair.textContent).not.toContain('Jen');

    expect(jenPair.querySelectorAll('svg')).toHaveLength(1);
    expect(jenPair.textContent).toContain('4');
    expect(jenPair.textContent).toContain('Jen');
    expect(jenPair.textContent).not.toContain('Paul');
  });

  // Mixed row: one member above the tier threshold, one below. The
  // below-threshold member's own wrapper must hold just their bare avatar —
  // no chip, and (per the phantom-gap rule) no empty space where one would
  // have sat — while the other member's wrapper still carries their number.
  it('a mixed row keeps each member in their own wrapper: one chip+avatar, one bare avatar', () => {
    const { container } = render(
      <HabitDoneByAvatars
        entries={[
          entry({ streak: 9 }), // above threshold — chip
          entry({ memberId: 'jen-uid', displayName: 'Jen', color: '#b87a29', streak: 1 }), // below threshold — no chip
        ]}
        streakUnit="day"
        showStreakChips
      />
    );
    expect(flameIcons(container)).toHaveLength(1);
    expect(screen.getByText('9 day streak')).toBeInTheDocument();
    expect(screen.queryByText(/^1 day streak$/)).not.toBeInTheDocument();

    const row = container.firstElementChild as HTMLElement;
    const pairs = Array.from(row.children) as HTMLElement[];
    expect(pairs).toHaveLength(2);

    const [paulPair, jenPair] = pairs as [HTMLElement, HTMLElement];
    expect(paulPair.querySelectorAll('svg')).toHaveLength(1);
    expect(paulPair.textContent).toContain('Paul');

    expect(jenPair.querySelectorAll('svg')).toHaveLength(0);
    expect(jenPair.textContent).toContain('Jen');
    expect(jenPair.textContent).not.toContain('streak');
  });
});
