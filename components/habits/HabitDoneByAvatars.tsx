import React from 'react';
import { Flame } from 'lucide-react';
import MemberAvatar from '@/components/ui/MemberAvatar';
import HouseholdAvatar from '@/components/ui/HouseholdAvatar';
import { Badge } from '@/components/ui/Badge';

/**
 * Badge-row "done by" avatars, each paired with its OWN streak chip —
 * HABITS-PAGE ONLY.
 *
 * This replaced the row's streak pill: the exact streak number now lives in
 * the habit's detail/log view AND, per-member, right here as a small
 * "🔥 9"-style chip sitting immediately before the credited member's avatar.
 * (An earlier iteration drew the streak as a flame ring around the avatar —
 * at 15px the ring was invisible, and a larger badge rivalled the avatar in
 * size and inverted the hierarchy: the avatar answers "who did this" and has
 * to stay primary. The chip is a separate, smaller element instead.) Three
 * tiers, from the member's OWN streak (not the habit's): ember at 3, flame at
 * 7, blaze at 30, in the habit's own cadence.
 *
 * 🛡️ PAIRING: streaks are per-member — `entries` can hold more than one
 * credited member, each with their own streak. DOM order alone (chip, then
 * its avatar, as flat siblings) is NOT enough: with every gap in the row the
 * same width, a chip reads as equally likely to belong to the avatar on
 * either side of it. Each member instead gets its own wrapper `<span>` with a
 * TIGHT `gap-1` (4px) binding its chip to its own avatar, while the outer
 * row uses a wider `gap-3` (12px) to separate one member's pair from the
 * next — proximity, not just order, is what makes the pairing unmistakable:
 *   [1 pts]  [🔥 9] (J)  [🔥 4] (M)
 * Do not flatten the per-member wrapper back into loose siblings, and do not
 * let the intra-pair and inter-pair gaps collapse to the same value.
 *
 * 🛡️ Nothing here is exported for reuse, and nothing should be. The streak
 * chip is decoration for the one surface where "who has momentum on this
 * habit" is the question being asked. Everywhere else — header, scoreboard,
 * points drawer, the weekly ceremony — a streak is CONTENT (a stat tile with
 * a number) and avatars are plain. Chipping avatars app-wide is how the
 * decoration stops meaning anything.
 *
 * Avatars appear only once someone is credited, so an untouched row stays clean.
 */

type StreakTier = 'ember' | 'flame' | 'blaze';

/**
 * Streak thresholds, in the habit's own cadence (days for a daily habit, ISO
 * weeks for a weekly one) — the same units `Habit.streakDays` uses.
 */
/**
 * Chip tier for a streak, in the habit's OWN cadence.
 *
 * 🛡️ Period-aware, because the numbers are not comparable across cadences: a
 * 2-week streak already earns the 2× multiplier, but read against the daily
 * thresholds it scored below `ember` and rendered NO chip at all — so a weekly
 * habit paying double showed nothing to explain why. (A 4-week streak, the top
 * of the weekly ladder, showed the LOWEST tier for the same reason.) Each
 * cadence's first two rungs are its own multiplier tiers — daily 3/7, weekly
 * 2/4 (see getMultiplier) — and `blaze` sits well beyond the ladder as a
 * long-haul marker: ~a month of days, ~a quarter of weeks.
 *
 * This is the same defect class as the Stats tile's inlined ladder (#1237),
 * which likewise applied the daily thresholds to weekly habits.
 */
const tierFor = (streak: number, unit: 'day' | 'week'): StreakTier | null =>
  unit === 'week'
    ? streak >= 12
      ? 'blaze'
      : streak >= 4
        ? 'flame'
        : streak >= 2
          ? 'ember'
          : null
    : streak >= 30
      ? 'blaze'
      : streak >= 7
        ? 'flame'
        : streak >= 3
          ? 'ember'
          : null;

/**
 * Chip tone per tier, built ONLY from the two existing `habit-*` design
 * tokens (no raw hex — the old ring's blaze gradient invented one third
 * stop-color that lived outside `@theme`; that value doesn't carry forward).
 * Intensity steps via opacity/border, not hue: ember is a light gold tint,
 * flame a light streak-orange tint, blaze the same orange at higher
 * saturation with a solid-strength border — mirroring the old ring's
 * width progression (2 / 2.5 / 3). Both light and dark classes are spelled
 * out explicitly so the chip fully overrides `Badge`'s default (accent/green)
 * dark-mode colors rather than leaking them in — the tokens themselves are
 * theme-invariant, so light and dark values are identical.
 */
const TIER_CLASS: Record<StreakTier, string> = {
  ember:
    'bg-habit-gold/10 text-habit-gold border-habit-gold/30 dark:bg-habit-gold/10 dark:text-habit-gold dark:border-habit-gold/30',
  flame:
    'bg-habit-streak/10 text-habit-streak border-habit-streak/25 dark:bg-habit-streak/10 dark:text-habit-streak dark:border-habit-streak/25',
  blaze:
    'bg-habit-streak/20 text-habit-streak border-habit-streak/50 dark:bg-habit-streak/20 dark:text-habit-streak dark:border-habit-streak/50',
};

export interface DoneByEntry {
  memberId: string;
  displayName: string;
  /** Hex, from the shared member-color map — the fallback when there's no photo. */
  color: string;
  /** Google/Firebase profile photo, when the member has one. */
  photoURL?: string;
  /** Attributed completions in the row's current period. */
  units: number;
  /** That member's own streak, in the habit's cadence. */
  streak: number;
}

interface HabitDoneByAvatarsProps {
  entries: readonly DoneByEntry[];
  /** Streak cadence word, for the chip's accessible label. */
  streakUnit: 'day' | 'week';
  /**
   * Whether a streak may show a chip at all — POSITIVE habits only.
   *
   * 🛡️ A streak chip is a celebration, and a "streak" on a negative habit is a
   * run of the thing you're trying to stop: chipping it would congratulate
   * three days of late-night snacking. The pill this replaced was gated on
   * `isPositive` for exactly this reason, and the gate has to survive the
   * change of form. Who did it is still shown — the avatars render either way.
   */
  showStreakChips: boolean;
  /** Avatar diameter in px. */
  size?: number;
  /**
   * Household credit mode: prepend the HOUSE badge, for a completion that pays
   * the household and credits nobody.
   *
   * No streak chip — deliberately. A chip is a MEMBER's momentum, and a
   * household completion grows no personal chain; the habit's own flame is
   * already visible in the points badge. The caller gates this on the habit
   * actually DECLARING `creditMode: 'household'`, so a merely grandfathered
   * row (unattributed for a different reason) keeps its untouched look.
   */
  showHousehold?: boolean;
}

const StreakChip: React.FC<{ streak: number; unit: 'day' | 'week'; tier: StreakTier }> = ({
  streak,
  unit,
  tier,
}) => {
  // The visible glyph+digit are decoration; this sr-only text is what an
  // assistive tech user hears instead ("9 day streak" — the unit stays
  // singular, read as a compound modifier, not pluralized by count).
  const label = `${streak} ${unit} streak`;
  return (
    <Badge size="sm" className={`gap-1 shrink-0 ${TIER_CLASS[tier]}`}>
      <Flame size={12} aria-hidden="true" className="fill-current" />
      <span aria-hidden="true">{streak}</span>
      <span className="sr-only">{label}</span>
    </Badge>
  );
};

const DoneAvatar: React.FC<{ entry: DoneByEntry; size: number }> = ({ entry, size }) => {
  // The avatar itself is plain — no ring, no badge. This is the text that
  // carries "who did this" for assistive tech.
  const did = entry.units > 1 ? `completed this ${entry.units} times` : 'completed this';
  const label = `${entry.displayName} ${did}`;
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <MemberAvatar name={entry.displayName} photoURL={entry.photoURL} color={entry.color} size={size} />
      <span className="sr-only">{label}</span>
    </span>
  );
};

const HabitDoneByAvatars: React.FC<HabitDoneByAvatarsProps> = ({
  entries,
  streakUnit,
  showStreakChips,
  size = 15,
  showHousehold = false,
}) => {
  if (entries.length === 0 && !showHousehold) return null;
  return (
    // Two DIFFERENT gaps, deliberately: `gap-3` (12px) separates one member's
    // pair from the next (and from the household badge), while each pair's
    // OWN `gap-1` (4px) binds its chip tightly to its own avatar. Flat
    // siblings all sharing one gap value (the old layout) made a chip read as
    // equally likely to belong to the avatar on either side of it —
    // PROXIMITY is what makes the pairing legible, not just DOM order.
    <span className="ml-1 inline-flex items-center gap-3">
      {showHousehold && (
        <span className="relative inline-flex shrink-0 items-center justify-center">
          <HouseholdAvatar size={size} />
          <span className="sr-only">Completed together — credited to the household</span>
        </span>
      )}
      {entries.map(entry => {
        const tier = showStreakChips ? tierFor(entry.streak, streakUnit) : null;
        return (
          // One wrapper per member: chip (if any) tightly bound to ITS OWN
          // avatar — see the PAIRING note above. `gap-1` only applies BETWEEN
          // children, so a below-threshold member (avatar only, no chip)
          // gets no phantom gap where a chip would have sat.
          <span key={entry.memberId} className="inline-flex shrink-0 items-center gap-1">
            {tier && <StreakChip streak={entry.streak} unit={streakUnit} tier={tier} />}
            <DoneAvatar entry={entry} size={size} />
          </span>
        );
      })}
    </span>
  );
};

export default HabitDoneByAvatars;
