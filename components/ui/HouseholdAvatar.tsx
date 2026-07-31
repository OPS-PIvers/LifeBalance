import React from 'react';
import { Home } from 'lucide-react';
import MemberAvatar from '@/components/ui/MemberAvatar';

/**
 * The HOUSEHOLD badge — a house glyph on a neutral brand fill.
 *
 * Household credit mode: a completion that pays the household and credits
 * nobody individually needs a badge of its own, and this is it. It is a thin
 * wrapper over {@link MemberAvatar} on purpose — the circle, the diameter and
 * the white separating ring are literally the same code every member avatar
 * uses, so a household badge sitting next to two member badges can never drift
 * out of alignment with them.
 *
 * 🛡️ NOT stacked member avatars. Those are what the picker's "Everyone" /
 * "Both of us" row draws, and that row means something different: N separate
 * completions, N member awards, the pool paid N times. This badge means ONE
 * award, to the pool, to nobody.
 *
 * The fill is `brand-600` — deliberately neutral, so it reads as "the house"
 * rather than as another person's colour from the member colour map, and
 * deliberately one of the brand steps `index.css` does NOT re-define under
 * `.dark` (400/450/500 all lighten there). A single `color` value has to carry
 * the white glyph in BOTH themes, and a step that lightens in dark mode would
 * drop white-on-fill contrast to roughly 2:1 exactly where the surface is
 * darkest.
 */
export interface HouseholdAvatarProps {
  /** Diameter in px — match the member avatars it sits beside. */
  size: number;
  /** White separating ring, ON by default (same default as MemberAvatar). */
  ring?: boolean;
  /** Accessible name; omit when adjacent text already names it. */
  alt?: string;
  title?: string;
  className?: string;
  /** Forwarded to MemberAvatar so scoreboard/drawer rows stay queryable. */
  'data-testid'?: string;
}

const HouseholdAvatar: React.FC<HouseholdAvatarProps> = ({
  size,
  ring = true,
  alt,
  title,
  className,
  'data-testid': dataTestId,
}) => (
  <MemberAvatar
    name="Household"
    color="var(--color-brand-600)"
    size={size}
    ring={ring}
    alt={alt}
    title={title}
    className={className}
    data-testid={dataTestId}
    icon={<Home size={Math.round(size * 0.55)} strokeWidth={2.4} aria-hidden="true" />}
  />
);

export default HouseholdAvatar;
