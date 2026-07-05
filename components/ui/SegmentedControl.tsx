import React, { useRef } from 'react';
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

  return (
    <div
      role="radiogroup"
      aria-label={name}
      aria-disabled={disabled || undefined}
      className={cn(
        "flex bg-brand-100 dark:bg-brand-800 p-1 rounded-xl",
        showBorder && "border border-brand-200 dark:border-brand-700",
        disabled && "opacity-50",
        className
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
              "flex-1 rounded-sm text-sm font-bold transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 disabled:cursor-not-allowed",
              size === 'sm' ? 'min-h-9 py-1.5' : 'min-h-11 py-2',
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
  );
};
