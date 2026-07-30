import React, { useId } from 'react';
import MemberAvatar from '@/components/ui/MemberAvatar';
import HouseholdAvatar from '@/components/ui/HouseholdAvatar';

/**
 * Badge-row "done by" avatars with flame streak rings — HABITS-PAGE ONLY.
 *
 * This replaced the row's streak pill: the exact streak number now lives in the
 * habit's detail/log view, and the row shows streak as INTENSITY around each
 * credited member's avatar. Three tiers, from the member's OWN streak (not the
 * habit's): ember at 3, flame at 7, blaze at 30, in the habit's own cadence.
 *
 * 🛡️ Nothing here is exported for reuse, and nothing should be. Flame rings are
 * decoration for the one surface where "who has momentum on this habit" is the
 * question being asked. Everywhere else — header, scoreboard, points drawer,
 * the weekly ceremony — a streak is CONTENT (a stat tile with a number) and
 * avatars are plain. Ringing avatars app-wide is how the decoration stops
 * meaning anything.
 *
 * Avatars appear only once someone is credited, so an untouched row stays clean.
 */

/** Flame outline (lucide `flame`), drawn in the ring gradient at the 12 o'clock notch. */
const FLAME_PATH =
  'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z';

type RingTier = 'ember' | 'flame' | 'blaze';

/**
 * Streak thresholds, in the habit's own cadence (days for a daily habit, ISO
 * weeks for a weekly one) — the same units `Habit.streakDays` uses.
 */
const tierFor = (streak: number): RingTier | null =>
  streak >= 30 ? 'blaze' : streak >= 7 ? 'flame' : streak >= 3 ? 'ember' : null;

/**
 * Ring gradients. `habit-gold` → `habit-streak` are existing tokens; the blaze
 * end `#d9481f` is the one invented value in this feature and lives HERE (not
 * in `@theme`) precisely because it is single-purpose decoration.
 */
const TIER: Record<RingTier, { stops: { offset: number; color: string }[]; width: number; flame: number; glow: boolean }> = {
  ember: {
    stops: [{ offset: 0, color: '#e0a32a' }, { offset: 1, color: '#d09140' }],
    width: 2,
    flame: 0.34,
    glow: false,
  },
  flame: {
    stops: [{ offset: 0, color: '#e0a32a' }, { offset: 1, color: '#ea6a26' }],
    width: 2.5,
    flame: 0.42,
    glow: false,
  },
  blaze: {
    stops: [
      { offset: 0, color: '#e0a32a' },
      { offset: 0.45, color: '#ea6a26' },
      { offset: 1, color: '#d9481f' },
    ],
    width: 3,
    flame: 0.5,
    glow: true,
  },
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
  /** Streak cadence word, for the screen-reader text. */
  streakUnit: 'day' | 'week';
  /**
   * Whether a streak may light a ring at all — POSITIVE habits only.
   *
   * 🛡️ A flame ring is a celebration, and a "streak" on a negative habit is a
   * run of the thing you're trying to stop: ringing it would congratulate three
   * days of late-night snacking. The pill this replaced was gated on
   * `isPositive` for exactly this reason, and the gate has to survive the
   * change of form. Who did it is still shown — the avatars render either way.
   */
  showStreakRings: boolean;
  /** Avatar diameter in px (the ring adds ~5px around it). */
  size?: number;
  /**
   * Household credit mode: prepend the HOUSE badge, for a completion that pays
   * the household and credits nobody.
   *
   * No flame ring — deliberately. A ring is a MEMBER's momentum, and a household
   * completion grows no personal chain; the habit's own flame is already visible
   * in the points badge. The caller gates this on the habit actually DECLARING
   * `creditMode: 'household'`, so a merely grandfathered row (unattributed for a
   * different reason) keeps its untouched look.
   */
  showHousehold?: boolean;
}

const RING_PAD = 2.5;

const FlameRingAvatar: React.FC<{
  entry: DoneByEntry;
  streakUnit: 'day' | 'week';
  showStreakRing: boolean;
  size: number;
}> = ({ entry, streakUnit, showStreakRing, size }) => {
  // Gradient ids must be unique per instance — two avatars sharing an id would
  // both paint whichever `<defs>` mounted last. Colons are stripped so the id
  // is also a legal CSS identifier.
  const gradientId = `flame-ring-${useId().replace(/:/g, '')}`;
  const tier = showStreakRing ? tierFor(entry.streak) : null;
  const spec = tier ? TIER[tier] : null;

  // The ring is decoration; this is the text that carries the same meaning.
  const did = entry.units > 1 ? `completed this ${entry.units} times` : 'completed this';
  const streakText = tier ? `, ${entry.streak} ${streakUnit}s streak` : '';
  const label = `${entry.displayName} ${did}${streakText}`;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {spec && (
        <svg
          viewBox="0 0 48 48"
          aria-hidden="true"
          focusable="false"
          className="pointer-events-none absolute overflow-visible"
          style={{
            inset: -RING_PAD,
            width: size + RING_PAD * 2,
            height: size + RING_PAD * 2,
            filter: spec.glow ? 'drop-shadow(0 0 3px rgb(234 106 38 / 0.4))' : undefined,
          }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
              {spec.stops.map(stop => (
                <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          {/* The dash gap (12 of 100) is rotated to sit at 12 o'clock, where the
              flame glyph notches into the ring. */}
          <circle
            cx="24"
            cy="24"
            r="21.5"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={spec.width}
            pathLength={100}
            strokeDasharray="88 12"
            strokeLinecap="round"
            transform="rotate(-68.4 24 24)"
          />
          <g transform={`translate(24 2.5) scale(${spec.flame}) translate(-12 -13)`}>
            <path d={FLAME_PATH} fill={`url(#${gradientId})`} />
          </g>
        </svg>
      )}
      <MemberAvatar name={entry.displayName} photoURL={entry.photoURL} color={entry.color} size={size} />
      <span className="sr-only">{label}</span>
    </span>
  );
};

const HabitDoneByAvatars: React.FC<HabitDoneByAvatarsProps> = ({
  entries,
  streakUnit,
  showStreakRings,
  size = 15,
  showHousehold = false,
}) => {
  if (entries.length === 0 && !showHousehold) return null;
  return (
    // Spaced, never overlapped: overlapping avatars would collide their flame
    // rings into an unreadable blob.
    <span className="ml-1 inline-flex items-center gap-[9px]">
      {showHousehold && (
        <span className="relative inline-flex shrink-0 items-center justify-center">
          <HouseholdAvatar size={size} />
          <span className="sr-only">Completed together — credited to the household</span>
        </span>
      )}
      {entries.map(entry => (
        <FlameRingAvatar
          key={entry.memberId}
          entry={entry}
          streakUnit={streakUnit}
          showStreakRing={showStreakRings}
          size={size}
        />
      ))}
    </span>
  );
};

export default HabitDoneByAvatars;
