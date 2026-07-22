import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface CountBadgeProps {
  /** The count to display. Renders nothing when `count <= 0`. */
  count: number;
  /** Values above this render as "<max>+". Defaults to 9. */
  max?: number;
  /**
   * Optional lucide icon rendered before the number, giving the bare numeral
   * visible meaning (e.g. `Gift` for the pending-redemption badge — matching
   * the destination Rewards surface's iconography). Keep the host control's
   * `aria-label` descriptive; the badge itself stays decorative.
   */
  icon?: LucideIcon;
  /** Extra classes for position / ring-color overrides (defaults suit a light surface). */
  className?: string;
  /**
   * `overlay` (default) is the positioned red notification pill that floats
   * over an icon. `inline` is a static neutral count pill for flowing content
   * (e.g. a tab's item count) — same shape, no alarm color, no ring.
   */
  variant?: 'overlay' | 'inline';
}

/**
 * Small positioned numeric notification badge — the "N" / "9+" pill that overlays
 * an icon (the host must be `relative`). Purely decorative (`aria-hidden`): give
 * the host control its own descriptive `aria-label` / sr-only text. Consolidates
 * the badge copy-pasted between BottomNav and TopToolbar.
 */
const CountBadge: React.FC<CountBadgeProps> = ({ count, max = 9, icon: Icon, className, variant = 'overlay' }) => {
  // `!count` also guards NaN / null / undefined defensively (e.g. loading states).
  if (!count || count <= 0) return null;
  return (
    <span
      className={cn(
        'flex items-center justify-center gap-0.5 rounded-full leading-none',
        variant === 'overlay'
          ? 'absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 bg-money-neg text-white text-[10px] font-bold ring-2 ring-white dark:ring-brand-800'
          : 'min-w-[16px] px-1.5 py-0.5 bg-brand-200 text-brand-700 dark:bg-brand-700 dark:text-brand-200 text-xs font-normal tabular-nums',
        className
      )}
      aria-hidden="true"
    >
      {Icon && <Icon size={10} strokeWidth={2.5} className="shrink-0" />}
      {count > max ? `${max}+` : count}
    </span>
  );
};

export default CountBadge;
