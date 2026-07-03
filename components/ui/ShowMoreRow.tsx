import React from 'react';
import { cn } from '@/utils/cn';

/**
 * The capped-list affordance: a full-width hairline row rendered as the LAST
 * child of a `SurfaceList`, reading "+ N more items" while collapsed and a
 * collapse label ("Show fewer") once expanded. Generalizes the
 * "+ N more habits" row from `DailyHabitsWidget`.
 *
 * Renders nothing when there is nothing hidden and the list isn't expanded,
 * so callers can append it unconditionally.
 */
export interface ShowMoreRowProps {
  /** How many items are currently hidden by the cap. */
  hiddenCount: number;
  /** Whether the capped list is currently expanded. */
  expanded: boolean;
  /** Toggles the expanded state. */
  onToggle: () => void;
  /** Singular noun for the hidden items (pluralized with "s"). Default "item". */
  noun?: string;
  /** Label shown while expanded. Default "Show fewer". */
  collapseLabel?: string;
  className?: string;
}

export const ShowMoreRow: React.FC<ShowMoreRowProps> = ({
  hiddenCount,
  expanded,
  onToggle,
  noun = 'item',
  collapseLabel = 'Show fewer',
  className,
}) => {
  if (hiddenCount <= 0 && !expanded) return null;

  const label = expanded
    ? collapseLabel
    : `+ ${hiddenCount} more ${hiddenCount === 1 ? noun : `${noun}s`}`;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        'block min-h-11 w-full px-4 py-3 text-center hairline-divider',
        'text-xs font-semibold text-brand-400 dark:text-brand-500 hover:text-accent-700 dark:hover:text-accent-300',
        'transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 cursor-pointer',
        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset',
        className
      )}
    >
      {label}
    </button>
  );
};
