import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Inline tap-to-expand section for lower-frequency content.
 *
 * The header is a real `<button>` (aria-expanded / aria-controls) styled like a
 * `Section` title with a trailing chevron that rotates when open — the same
 * affordance used for "show the work" style breakdowns. Content is simply
 * conditionally mounted (no height animation) with the standard
 * `animate-in fade-in slide-in-from-top-2` entrance.
 *
 * Supports both uncontrolled (`defaultOpen`) and controlled (`open` +
 * `onOpenChange`) usage. An optional `action` slot renders OUTSIDE the toggle
 * button so e.g. an "Add" button stays tappable without toggling the section.
 */
export interface CollapsibleSectionProps {
  /** Section header title — matches `Section`'s title typography. */
  title: React.ReactNode;
  /** Optional small muted line rendered under the title (always visible). */
  subtitle?: React.ReactNode;
  /**
   * Optional small muted trailing text shown only while collapsed
   * (e.g. an item count) so the hidden content stays glanceable.
   */
  summary?: React.ReactNode;
  /** Initial open state for uncontrolled usage. Defaults to false. */
  defaultOpen?: boolean;
  /** Controlled open state — when provided, the component defers to it. */
  open?: boolean;
  /** Called with the next open state on every toggle. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional trailing slot rendered OUTSIDE the toggle button, so interacting
   * with it never toggles the section.
   */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  subtitle,
  summary,
  defaultOpen = false,
  open,
  onOpenChange,
  action,
  children,
  className,
}) => {
  const contentId = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section className={cn('w-full', className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className={cn(
            'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 px-1 text-left',
            'rounded-card focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40'
          )}
        >
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold tracking-tight text-brand-700 dark:text-brand-200">
              {title}
            </span>
            {subtitle && (
              <span className="block truncate text-xs text-brand-500 dark:text-brand-400">
                {subtitle}
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {!isOpen && summary !== undefined && (
              <span className="text-xs text-brand-500 dark:text-brand-400">{summary}</span>
            )}
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={cn(
                'shrink-0 text-brand-400 dark:text-brand-500 transition-transform duration-(--duration-base) ease-(--ease-standard)',
                isOpen && 'rotate-180'
              )}
            />
          </span>
        </button>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {isOpen && (
        <div
          id={contentId}
          className="mt-2 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)"
        >
          {children}
        </div>
      )}
    </section>
  );
};
