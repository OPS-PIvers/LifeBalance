import React from 'react';
import { cn } from '@/utils/cn';

export type EmptyStateVariant = 'plain' | 'surface' | 'dashed';
export type EmptyStateTone = 'default' | 'danger';

/**
 * Wrapper treatments:
 * - `plain`   — no surface of its own; use inside an existing surface (e.g. a Drawer body).
 * - `surface` — solid grouped surface (matches `SurfaceList`); use standalone on the page bg.
 * - `dashed`  — dashed outline "add something here" block.
 */
const WRAPPERS: Record<EmptyStateVariant, string> = {
  plain: 'py-12 px-4',
  surface: 'surface-section py-12 px-6',
  dashed:
    'border-2 border-dashed border-brand-200 dark:border-brand-700 rounded-card bg-white/50 dark:bg-brand-800/40 py-14 px-6',
};

/** Icon-badge color by tone. `danger` styles this as an error / empty-error state. */
const ICON_BADGE_TONES: Record<EmptyStateTone, string> = {
  default: 'bg-brand-100 dark:bg-brand-700/50 text-brand-400 dark:text-brand-500',
  danger: 'bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark',
};

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /**
   * Icon node (e.g. a lucide icon) rendered inside a tinted circular badge.
   * The badge normalizes the icon to a consistent 28px regardless of the size
   * the caller passes, so empty states across the app read at the same scale.
   * Omit for a text-only state.
   */
  icon?: React.ReactNode;
  /** The headline. */
  title: React.ReactNode;
  /** Optional supporting copy beneath the title. */
  description?: React.ReactNode;
  /** Optional call-to-action, typically a `<Button>`. */
  action?: React.ReactNode;
  /** Surface treatment. Defaults to `plain` (no surface of its own). */
  variant?: EmptyStateVariant;
  /** Icon-badge tone. `danger` styles it as an error / empty-error state. */
  tone?: EmptyStateTone;
}

/**
 * Canonical empty-state block: a tinted icon badge, a display title, muted
 * supporting copy, and an optional CTA. Replaces the icon-circle + title +
 * subtext markup that was hand-rolled across ~17 files (see UI unification audit).
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'plain',
  tone = 'default',
  className,
  ...props
}) => (
  <div
    className={cn(
      'flex flex-col items-center justify-center text-center',
      WRAPPERS[variant],
      className
    )}
    {...props}
  >
    {icon && (
      <div
        className={cn(
          // Clamp the icon to a uniform 28px so a 20px and a 28px caller icon
          // don't read at different scales inside the same fixed 64px badge.
          // Descendant selector (not direct-child) so a wrapped icon still clamps.
          'w-16 h-16 rounded-full flex items-center justify-center mb-4 [&_svg]:size-7',
          ICON_BADGE_TONES[tone]
        )}
      >
        {icon}
      </div>
    )}
    <h3 className="font-display text-lg font-semibold text-brand-900 dark:text-brand-100">
      {title}
    </h3>
    {description && (
      <p className="text-sm text-brand-500 dark:text-brand-400 mt-1 max-w-xs">
        {description}
      </p>
    )}
    {action && <div className="mt-5">{action}</div>}
  </div>
);

export default EmptyState;
