import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Grouped-flat surface primitives — the canonical way to organize list content
 * in the redesigned app (iOS Settings / Things / Copilot Money language).
 *
 * Instead of a pile of floating glass cards, content is organized into calm
 * SECTIONS on a solid background. Rows inside a section are separated by 1px
 * HAIRLINE dividers, not by gaps between elevated cards. Hierarchy comes from
 * type + spacing + the two accents — never from blur/shadow.
 *
 * Usage:
 *   <Section title="Recent activity">
 *     <SurfaceList>
 *       <Row>…</Row>
 *       <Row>…</Row>
 *     </SurfaceList>
 *   </Section>
 *
 * `SurfaceList` owns the solid surface + hairline border + radius; `Row` is a
 * single padded row that draws a hairline above itself (the first row's divider
 * is suppressed automatically). `Section` adds an optional editorial header
 * above the surface.
 */

export interface SectionProps
  extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  /** Optional small editorial section header rendered above the surface. */
  title?: React.ReactNode;
  /** Optional trailing content for the header row (e.g. an action link). */
  action?: React.ReactNode;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({
  title,
  action,
  children,
  className,
  ...props
}) => (
  <section className={cn('w-full', className)} {...props}>
    {(title || action) && (
      <div className="flex items-end justify-between px-1 mb-1.5">
        {title ? (
          <h2 className="font-display text-sm font-semibold tracking-tight text-brand-700 dark:text-brand-200">
            {title}
          </h2>
        ) : (
          <span />
        )}
        {action}
      </div>
    )}
    {children}
  </section>
);

export interface SurfaceListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Solid grouped surface that hosts hairline-separated rows. Use with `Row`
 * children, which draw their own top hairline (the first is suppressed via the
 * `[&>*:first-child]` reset so the surface's own border is the only top edge).
 */
export const SurfaceList: React.FC<SurfaceListProps> = ({
  children,
  className,
  ...props
}) => (
  <div
    className={cn(
      'surface-section overflow-hidden [&>*:first-child]:border-t-0',
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Render as a button-like interactive row with a hover/press affordance. */
  interactive?: boolean;
  /** Tighten the default vertical padding for dense lists. */
  dense?: boolean;
}

/**
 * A single hairline-separated row inside a `SurfaceList`. Draws a 1px divider
 * above itself; the first row in a list has it suppressed by the parent.
 */
export const Row: React.FC<RowProps> = ({
  children,
  className,
  interactive = false,
  dense = false,
  ...props
}) => (
  <div
    className={cn(
      'flex items-center gap-3 px-4 hairline-divider',
      dense ? 'py-2.5' : 'py-3.5',
      interactive &&
        'transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 cursor-pointer',
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export interface DisclosureRowProps {
  /** Optional leading icon slot (typically a lucide icon element). */
  icon?: React.ReactNode;
  /** Row title — required. */
  title: React.ReactNode;
  /** Optional small muted line rendered under the title. */
  subtitle?: React.ReactNode;
  /** Optional trailing muted text/badge, rendered before the chevron. */
  value?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  /** Tighten the default vertical padding for dense lists. */
  dense?: boolean;
  /** Red title/icon treatment for destructive drill-ins (e.g. "Delete…"). */
  destructive?: boolean;
  className?: string;
  disabled?: boolean;
}

/**
 * An interactive row for use inside a `SurfaceList` — the replacement for
 * every hand-rolled accordion header. Renders a real `<button>` filling the
 * row (semantics/focus/keyboard activation come free) with a leading icon
 * slot, title + optional subtitle, a trailing muted value slot, and a
 * trailing chevron that hints the row drills into a `Drawer` or navigates.
 *
 * Use this instead of an inline-expanding accordion — content either becomes
 * a flat always-visible `Section` or opens in a `Drawer` bottom sheet.
 */
export const DisclosureRow: React.FC<DisclosureRowProps> = ({
  icon,
  title,
  subtitle,
  value,
  onClick,
  dense = false,
  destructive = false,
  className,
  disabled = false,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex w-full items-center gap-3 px-4 text-left hairline-divider',
      'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
      dense ? 'py-2.5' : 'py-3.5',
      'hover:bg-brand-50 dark:hover:bg-brand-700/40',
      'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset',
      'disabled:opacity-50 disabled:pointer-events-none',
      className
    )}
  >
    {icon && (
      <span
        className={cn(
          'shrink-0 text-brand-500 dark:text-brand-400',
          destructive && 'text-money-neg dark:text-money-neg'
        )}
      >
        {icon}
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span
        className={cn(
          'block truncate text-sm font-medium text-brand-900 dark:text-brand-50',
          destructive && 'text-money-neg dark:text-money-neg'
        )}
      >
        {title}
      </span>
      {subtitle && (
        <span className="block truncate text-xs text-brand-500 dark:text-brand-400">
          {subtitle}
        </span>
      )}
    </span>
    {value !== undefined && (
      <span className="shrink-0 text-sm text-brand-500 dark:text-brand-400">{value}</span>
    )}
    <ChevronRight
      size={18}
      className="shrink-0 text-brand-300 dark:text-brand-600"
      aria-hidden="true"
    />
  </button>
);

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Override the default value styling (e.g. to color-code positive/negative). */
  valueClassName?: string;
}

/**
 * A single typography-only stat: a big tabular-nums figure with a small
 * muted label underneath. Use inside `StatGroup`. No background/border —
 * hierarchy comes from type + spacing, matching the rest of the system.
 */
export const Stat: React.FC<StatProps> = ({ label, value, valueClassName }) => (
  <div className="flex flex-col gap-0.5">
    <span
      className={cn(
        'font-mono tabular-nums text-lg font-semibold text-brand-900 dark:text-brand-50',
        valueClassName
      )}
    >
      {value}
    </span>
    <span className="text-xs text-brand-500 dark:text-brand-400">{label}</span>
  </div>
);

export interface StatGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * A flex row of `Stat`s replacing "boxed stat tiles in a card" — no
 * background/border, just whitespace between figures. Wraps on tiny screens.
 */
export const StatGroup: React.FC<StatGroupProps> = ({ children, className, ...props }) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-x-8 gap-y-3', className)} {...props}>
    {children}
  </div>
);
