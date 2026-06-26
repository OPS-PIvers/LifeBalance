import React, { SelectHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '@/utils/cn';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, icon, id, children, ...props }, ref) => {
    const generatedId = useId();
    const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, '-')}` : generatedId);
    const errorId = `${selectId}-error`;

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider block mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-500 pointer-events-none">
              {icon}
            </div>
          )}
          <select
            id={selectId}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "w-full p-3 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-btn outline-hidden focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50 disabled:bg-brand-50 dark:disabled:bg-brand-700/50 appearance-none text-brand-900 dark:text-brand-100",
              icon ? "pl-10" : "pl-3",
              "pr-10", // Space for the chevron
              error && "border-money-neg focus:border-money-neg focus:ring-money-neg/20",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-400 dark:text-brand-500">
            <ChevronDown size={20} />
          </div>
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-money-neg font-medium">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
