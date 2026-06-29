import React from 'react';
import { cn } from '@/utils/cn';

export interface ProgressBarProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'role'> {
  /** Current value. */
  value: number;
  /** Maximum the bar represents. Defaults to 100 — i.e. pass a percentage as `value`. */
  max?: number;
  /** Tailwind classes for the fill (typically a background color). */
  barClassName?: string;
  /** Accessible label for the bar. Falls back to "<rounded>%". */
  ariaLabel?: string;
}

/**
 * Linear progress bar. The track is this element (`role="progressbar"` with the
 * aria-value* attributes); the fill is its single child, whose width reflects
 * `value / max`. Replaces the hand-rolled track + fill + aria markup that was
 * duplicated across the budget / dashboard / habits widgets.
 *
 * The track owns height / background / margins via `className`; the fill owns its
 * color via `barClassName`. The track is always `overflow-hidden rounded-full`,
 * so a value above `max` is clamped visually without clamping the reported aria
 * value (preserving prior overspent-bucket behavior).
 */
const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  barClassName,
  ariaLabel,
  className,
  ...props
}) => {
  // Guard against NaN (e.g. division-by-zero upstream) and negatives. The upper
  // bound is intentionally NOT clamped so overspent buckets can report >100%.
  const safeValue = Number.isNaN(value) ? 0 : value;
  const safeMax = Number.isNaN(max) ? 100 : max;
  const pct = safeMax > 0 ? (safeValue / safeMax) * 100 : 0;
  const rounded = Math.max(0, Math.round(pct));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={rounded}
      aria-label={ariaLabel ?? `${rounded}%`}
      className={cn('w-full overflow-hidden rounded-full', className)}
      {...props}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-(--duration-slow) ease-(--ease-standard)',
          barClassName
        )}
        style={{ width: `${Math.max(0, pct)}%` }}
      />
    </div>
  );
};

export default ProgressBar;
