import React from 'react';
import { cn } from '@/utils/cn';

export interface PageHeaderProps {
  /** Page title, rendered in the editorial display face. */
  title: React.ReactNode;
  /** Optional one-line subtitle beneath the title. */
  subtitle?: React.ReactNode;
  /** Optional right-aligned actions slot (a button, an overflow menu, etc.). */
  actions?: React.ReactNode;
  /** Vertical alignment of the actions slot against the title block. Defaults to `start`. */
  align?: 'start' | 'end';
  /** id for the underlying `<h1>`, for `aria-labelledby` wiring. */
  titleId?: string;
  /** Extra classes for the wrapper (e.g. to tweak the gutter on a specific page). */
  className?: string;
}

/**
 * Canonical page masthead: the editorial display title, an optional muted
 * subtitle, and an optional right-aligned actions slot, on the standard
 * `px-5 pt-8 pb-6` rhythm. Replaces the per-page hand-rolled header markup so
 * every route shares one title size, weight, gutter, and top inset (see the UI
 * 10x audit — page headers were spelled several different ways and three pages
 * had none at all). Pages adopt it in a later batch.
 */
const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  align = 'start',
  titleId,
  className,
}) => (
  <header
    className={cn(
      'px-5 pt-8 pb-6 flex justify-between gap-3',
      align === 'end' ? 'items-end' : 'items-start',
      className
    )}
  >
    <div className="min-w-0">
      <h1
        id={titleId}
        className="font-display text-3xl font-semibold tracking-tight text-brand-900 dark:text-brand-50"
      >
        {title}
      </h1>
      {subtitle && (
        <p className="mt-1 text-sm text-brand-500 dark:text-brand-400 font-medium">
          {subtitle}
        </p>
      )}
    </div>
    {actions && <div className="shrink-0">{actions}</div>}
  </header>
);

export default PageHeader;
