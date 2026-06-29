import React from 'react';
import { cn } from '@/utils/cn';

export interface CountBadgeProps {
  /** The count to display. Renders nothing when `count <= 0`. */
  count: number;
  /** Values above this render as "<max>+". Defaults to 9. */
  max?: number;
  /** Extra classes for position / ring-color overrides (defaults suit a light surface). */
  className?: string;
}

/**
 * Small positioned numeric notification badge — the "N" / "9+" pill that overlays
 * an icon (the host must be `relative`). Purely decorative (`aria-hidden`): give
 * the host control its own descriptive `aria-label` / sr-only text. Consolidates
 * the badge copy-pasted between BottomNav and TopToolbar.
 */
const CountBadge: React.FC<CountBadgeProps> = ({ count, max = 9, className }) => {
  // `!count` also guards NaN / null / undefined defensively (e.g. loading states).
  if (!count || count <= 0) return null;
  return (
    <span
      className={cn(
        'absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-money-neg text-white text-[10px] font-bold leading-none ring-2 ring-white dark:ring-brand-800',
        className
      )}
      aria-hidden="true"
    >
      {count > max ? `${max}+` : count}
    </span>
  );
};

export default CountBadge;
