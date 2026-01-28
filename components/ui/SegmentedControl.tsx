import React from 'react';
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
  return (
    <div
      role="group"
      aria-label={name}
      className={cn(
        "flex bg-slate-100/50 backdrop-blur-sm p-1 rounded-xl",
        showBorder && "ring-1 ring-black/5",
        className
      )}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={isActive}
            className={cn(
              "flex-1 py-2 rounded-lg text-sm font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
              isActive
                ? cn("bg-white shadow-sm ring-1 ring-black/5", option.activeClassName || "text-slate-900")
                : "text-slate-500 hover:text-slate-700",
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
