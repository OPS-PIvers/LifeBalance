import React, { useRef } from 'react';
import { cn } from '@/utils/cn';

export interface SegmentedControlOption<T extends string> {
  value: T;
  label: React.ReactNode;
  activeClassName?: string;
  className?: string; // specific override
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  name?: string; // for aria-label
  showBorder?: boolean;
}

export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  className,
  name,
  showBorder = true,
}: SegmentedControlProps<T>) => {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow-key navigation for the radiogroup: move selection (and focus) to the
  // previous/next option, wrapping around the ends.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
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
      className={cn(
        "flex bg-brand-100 dark:bg-brand-800 p-1 rounded-xl",
        showBorder && "border border-brand-200 dark:border-brand-700",
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
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "flex-1 py-2 rounded-sm text-sm font-bold transition-all duration-(--duration-fast) ease-(--ease-standard) focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40",
              isActive
                ? cn("bg-white border border-brand-200 dark:bg-brand-700 dark:border-brand-600", option.activeClassName || "text-accent-700 dark:text-accent-200")
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
