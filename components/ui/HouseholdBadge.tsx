import React from 'react';
import { Home } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * The "Household" badge — a house glyph on a neutral brand fill, standing in
 * for `MemberAvatar` wherever a row represents points that belong to no
 * individual member (the `unattributed` term, household-points-visibility).
 *
 * Deliberately matches `MemberAvatar`'s circle, size, and white ring so a
 * Household row reads as "one more row in the same list," not a different
 * kind of thing. Kept as a LOCAL presentational component rather than a
 * `MemberAvatar` prop because `MemberAvatar.tsx` is owned by a parallel
 * change (a glyph-avatar variant for Household-credit habits) — the two
 * should be unified into one shared component in a follow-up once that lands.
 */
export interface HouseholdBadgeProps {
  /** Diameter in px — pass the same value as the `MemberAvatar`s in the same row list. */
  size: number;
  className?: string;
  'data-testid'?: string;
}

const HouseholdBadge: React.FC<HouseholdBadgeProps> = ({ size, className, 'data-testid': dataTestId }) => (
  <span
    aria-hidden="true"
    data-testid={dataTestId}
    className={cn(
      'flex items-center justify-center rounded-full ring-2 ring-white bg-brand-400 dark:bg-brand-500 shrink-0',
      className
    )}
    style={{ width: size, height: size }}
  >
    <Home size={Math.round(size * 0.52)} className="text-white" strokeWidth={2.25} aria-hidden="true" />
  </span>
);

export default HouseholdBadge;
