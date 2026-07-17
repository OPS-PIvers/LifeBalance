import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: React.ReactNode;
  activeClassName?: string;
  className?: string; // specific override
  /** Accessible name for the option button — required when the label is icon-only. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  name?: string; // for aria-label
  showBorder?: boolean;
  /** Active-text + focus tone. 'accent' (default, evergreen) or 'warm' (amber — gamification surfaces). Per-option `activeClassName` still overrides. */
  tone?: 'accent' | 'warm';
  /** Disable the whole control (dims and blocks selection/keyboard nav). */
  disabled?: boolean;
  /**
   * `md` (default) reserves the full 44px (`min-h-11`) touch target for
   * primary navigation. `sm` shrinks to `min-h-9`/tighter padding for
   * secondary in-page filters/toggles (e.g. Active/Completed, a day picker)
   * that don't need the primary-nav touch target.
   */
  size?: 'md' | 'sm';
}

const SEGMENTED_TONES = {
  accent: { activeText: 'text-accent-700 dark:text-accent-200', ring: 'focus-visible:ring-accent-500/40' },
  warm: { activeText: 'text-warm-700 dark:text-warm-300', ring: 'focus-visible:ring-warm-500/40' },
} as const;

// SegmentedControl: an inline value toggle (role=radiogroup/radio) with no
// tabpanel. Shares the pill-in-trough track + white active chrome with Tabs (the
// active string is byte-identical bar the tone-driven text color) — reach for Tabs
// instead when each option should drive a routed/tabpanel view.
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  className,
  name,
  showBorder = true,
  tone = 'accent',
  disabled = false,
  size = 'md',
}: SegmentedControlProps<T>) => {
  const toneStyles = SEGMENTED_TONES[tone];
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow-key navigation for the radiogroup: move selection (and focus) to the
  // previous/next option, wrapping around the ends.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIndex = (index + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIndex = (index - 1 + options.length) % options.length;
    }
    if (nextIndex === null) return;
    e.preventDefault();
    const nextOption = options[nextIndex];
    if (!nextOption) return;
    onChange(nextOption.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  // Overflow affordance (mirrors TabsList): a many-option control (e.g. the
  // 5-way Insights chart picker) scrolls on narrow screens, but with no
  // scrollbar (`no-scrollbar`) nothing hinted that more options exist
  // offscreen. Fade the clipped edge(s).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const updateOverflow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setOverflow(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    updateOverflow();
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateOverflow]);

  const fadeBase =
    'pointer-events-none absolute inset-y-0 w-8 rounded-xl from-brand-100 dark:from-brand-800 to-transparent transition-opacity duration-(--duration-fast) ease-(--ease-standard)';

  return (
    // Caller className lands on the wrapper (layout: margins, widths, flex-1)
    // so the edge fades always hug the trough itself.
    <div className={cn('relative', className)}>
      <div
        ref={scrollerRef}
        onScroll={updateOverflow}
        role="radiogroup"
        aria-label={name}
        aria-disabled={disabled || undefined}
        className={cn(
          "flex flex-nowrap bg-brand-100 dark:bg-brand-800 p-1 rounded-xl overflow-x-auto no-scrollbar",
          showBorder && "border border-brand-200 dark:border-brand-700",
          disabled && "opacity-50"
        )}
      >
        {options.map((option, index) => {
          const isActive = value === option.value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={option.ariaLabel}
              tabIndex={isActive ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(option.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                // flex-1 stretch when the control fits; min-width:auto +
                // whitespace-nowrap keep labels from crushing, so a genuinely
                // overflowing control scrolls instead.
                "flex-1 whitespace-nowrap rounded-sm text-sm font-bold transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 disabled:cursor-not-allowed",
                size === 'sm' ? 'min-h-9 px-2.5 py-1.5' : 'min-h-11 px-2.5 py-2',
                toneStyles.ring,
                isActive
                  ? cn("bg-white border border-brand-200 dark:bg-brand-700 dark:border-brand-600", option.activeClassName || toneStyles.activeText)
                  : "text-brand-500 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-200",
                option.className
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className={cn(fadeBase, 'left-0 bg-gradient-to-r', overflow.left ? 'opacity-100' : 'opacity-0')} />
      <div aria-hidden="true" className={cn(fadeBase, 'right-0 bg-gradient-to-l', overflow.right ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
};
