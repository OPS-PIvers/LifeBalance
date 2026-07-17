import React from 'react';
import { cn } from '@/utils/cn';

/**
 * The canonical editorial section heading — the app's SECOND labeling voice,
 * the deliberate counterpart to the uppercase micro-caps {@link Eyebrow}.
 *
 * Two registers, one rule (see DESIGN.md §3):
 * - **`SectionHeading`** (Besley serif, sentence case) names a **content
 *   grouping** — a region of a page a reader scans and navigates by ("Members",
 *   "Backups & Import", "This week"). Warm, human, editorial.
 * - **`Eyebrow`** (Schibsted Grotesk, uppercase, tracked) labels a **control,
 *   field, or datum** — a form-field group, a stat caption, a status. Quiet,
 *   functional, systematic.
 *
 * The exact type spec lives once in `sectionHeadingClasses` so the `Section`
 * primitive's own title and every standalone sub-heading render through the
 * same source of truth — this is a single system, not a parallel spelling.
 *
 * Defaults to an `<h3>` because standalone sub-headings live inside a `Section`
 * (whose title is the page's `<h2>`); pass `as` to keep the document outline
 * correct on each surface.
 */
export const sectionHeadingClasses =
  'font-display text-sm font-semibold tracking-tight text-brand-700 dark:text-brand-200';

export interface SectionHeadingProps {
  /** Heading level — keep the outline correct (a `Section` title is the `h2`). */
  as?: 'h2' | 'h3' | 'h4';
  /** Optional muted line beneath the heading (sentence case, not a metadata caption). */
  description?: React.ReactNode;
  /** Optional trailing content (an icon button, a link) aligned to the heading. */
  action?: React.ReactNode;
  /** id for the underlying heading element, for `aria-labelledby` wiring. */
  id?: string;
  /** Extra classes for the wrapper (e.g. `px-1` to match a surface's gutter). */
  className?: string;
  children: React.ReactNode;
}

const SectionHeading: React.FC<SectionHeadingProps> = ({
  as = 'h3',
  description,
  action,
  id,
  className,
  children,
}) => {
  const Tag = as as React.ElementType;
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        <Tag id={id} className={sectionHeadingClasses}>
          {children}
        </Tag>
        {description && (
          <p className="mt-0.5 text-xs font-normal text-brand-500 dark:text-brand-400">
            {description}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export default SectionHeading;
