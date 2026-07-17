import React from 'react';
import { cn } from '@/utils/cn';

export type EyebrowTone = 'default' | 'warm' | 'accent';

const TONE_CLASSES: Record<EyebrowTone, string> = {
  default: 'text-brand-500 dark:text-brand-400',
  warm: 'text-warm-600 dark:text-warm-300',
  accent: 'text-accent-700 dark:text-accent-300',
};

export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  /** Color variant — the only thing that varies. Size/weight/case/tracking are fixed. */
  tone?: EyebrowTone;
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
  as = 'span',
  className,
  children,
  ...props
}) => {
  const Tag = as as React.ElementType;
  return (
    <Tag
      className={cn(
        'text-xs font-semibold uppercase tracking-wider',
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
};

export default Eyebrow;
