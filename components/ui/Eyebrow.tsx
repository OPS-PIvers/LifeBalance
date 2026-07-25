import React from 'react';
import { cn } from '@/utils/cn';

export type EyebrowTone = 'default' | 'warm' | 'accent';

const TONE_CLASSES: Record<EyebrowTone, string> = {
  default: 'text-brand-500 dark:text-brand-400',
  warm: 'text-warm-600 dark:text-warm-300',
  accent: 'text-accent-700 dark:text-accent-300',
};

export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  /** Color variant. Weight/case/tracking are fixed. */
  tone?: EyebrowTone;
  /**
   * `xs` (default) everywhere; `xxs` ONLY for height-starved overlay chrome
   * (e.g. the landscape Eisenhower grid's axis labels). Don't reach for it to
   * make ordinary labels smaller.
   */
  size?: 'xs' | 'xxs';
  /** Element to render. Defaults to `span`. */
  as?: 'span' | 'p' | 'div' | 'h2' | 'h3' | 'h4' | 'legend';
}

/**
 * The canonical micro-caps eyebrow: one size (text-xs), weight (font-semibold),
 * case (uppercase) and tracking (tracking-wider), with color as the only
 * variant. Replaces the several different hand-spellings of this label scattered
 * across the app (varying text-xs/xxs, font-semibold/bold, and with/without
 * font-display) — see the UI 10x audit.
 *
 * This is the app's UTILITY labeling voice — it labels a **control, field, or
 * datum** (a form-field group, a stat caption, a status). Its deliberate
 * counterpart is the editorial serif {@link SectionHeading}, which names a
 * **content grouping**. Pick by register, not by habit — see DESIGN.md §3.
 */
const Eyebrow: React.FC<EyebrowProps> = ({
  tone = 'default',
  size = 'xs',
  as = 'span',
  className,
  children,
  ...props
}) => {
  const Tag = as as React.ElementType;
  // The font-size class is concatenated by hand rather than passed through
  // cn(): tailwind-merge does not recognise the custom `text-xxs` @theme token
  // as a font-size, so it treats it as a text-COLOUR utility conflicting with
  // TONE_CLASSES' `text-<colour>` and drops one of the two. They set different
  // CSS properties, so there is no real conflict. Same precedent as Badge /
  // TodoRow / EisenhowerGridView. Do NOT fold this back into cn().
  const sizeClass = size === 'xxs' ? 'text-xxs' : 'text-xs';
  return (
    <Tag
      className={`${sizeClass} ${cn(
        'font-semibold uppercase tracking-wider',
        TONE_CLASSES[tone],
        className
      )}`}
      {...props}
    >
      {children}
    </Tag>
  );
};

export default Eyebrow;
