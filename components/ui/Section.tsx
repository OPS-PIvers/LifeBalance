import React from 'react';
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
      <div className="flex items-end justify-between px-1 mb-2">
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
