import React from 'react';
import { cn } from '@/utils/cn';

/** The classic 15.9155-radius circular arc (circumference ≈ 100, so dasharray maps 1:1 to %). */
const ARC =
  'M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831';

export interface ProgressRingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Progress percentage; clamped to 0–100 for the arc. */
  percent: number;
  /** Stroke width of both arcs. Defaults to 4. */
  strokeWidth?: number;
  /** Tailwind text-color class for the background track arc. */
  trackClassName?: string;
  /** Tailwind text-color class for the progress arc. */
  barClassName?: string;
  /** Rounded line cap on the progress arc. Defaults to true. */
  rounded?: boolean;
  /**
   * Accessible label. When set, the SVG is exposed as an `img` with this label;
   * otherwise the SVG is `aria-hidden` (use that when the value is shown as
   * adjacent text — e.g. a centered percentage).
   */
  ringLabel?: string;
  /** Optional centered content (e.g. a percentage label). */
  children?: React.ReactNode;
}

/**
 * Circular SVG progress ring (the 15.9155-radius two-path donut). Replaces the
 * hand-duplicated SVG in DailyHabitsWidget and HabitCard. Diameter is set with
 * width/height utilities via `className` (default `w-12 h-12`); colors via
 * `trackClassName` / `barClassName` (both use `currentColor`).
 */
const ProgressRing: React.FC<ProgressRingProps> = ({
  percent,
  strokeWidth = 4,
  trackClassName = 'text-brand-200 dark:text-brand-700',
  barClassName = 'text-accent-600 dark:text-accent-300',
  rounded = true,
  ringLabel,
  children,
  className,
  ...props
}) => {
  // Guard against NaN (e.g. dividing by a zero targetCount) before clamping.
  const safePercent = Number.isNaN(percent) ? 0 : percent;
  const clamped = Math.max(0, Math.min(100, safePercent));
  return (
    <div
      className={cn(
        'relative flex items-center justify-center shrink-0 w-12 h-12',
        className
      )}
      {...props}
    >
      <svg
        className="w-full h-full -rotate-90"
        viewBox="0 0 36 36"
        role={ringLabel ? 'img' : undefined}
        aria-label={ringLabel}
        aria-hidden={ringLabel ? undefined : true}
      >
        <path
          className={trackClassName}
          d={ARC}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
        />
        <path
          className={cn(
            'transition-all duration-(--duration-slow) ease-(--ease-standard)',
            barClassName
          )}
          d={ARC}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray={`${clamped}, 100`}
          strokeLinecap={rounded ? 'round' : undefined}
        />
      </svg>
      {children != null && (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
};

export default ProgressRing;
