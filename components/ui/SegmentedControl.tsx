import React, { useRef } from 'react';
import { cn } from '../../utils/cn';

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
        "flex bg-slate-100/50 dark:bg-slate-700/50 backdrop-blur-sm p-1 rounded-xl",
        showBorder && "ring-1 ring-black/5 dark:ring-white/10",
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
              "flex-1 py-2 rounded-lg text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
              isActive
                ? cn("bg-white shadow-sm ring-1 ring-black/5 dark:bg-slate-800 dark:ring-white/10", option.activeClassName || "text-slate-900 dark:text-slate-100")
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
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
