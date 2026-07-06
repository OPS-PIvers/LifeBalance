import React, { SelectHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '@/utils/cn';
import { ChevronDown } from 'lucide-react';
import { FIELD_BASE, FIELD_ERROR } from '@/components/ui/fieldStyles';

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
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-450 pointer-events-none">
              {icon}
            </div>
          )}
          <select
            id={selectId}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              FIELD_BASE,
              "appearance-none",
              icon ? "pl-10" : "pl-3",
              "pr-10", // Space for the chevron
              error && FIELD_ERROR,
              className
            )}
            {...props}
          >
            {children}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-400 dark:text-brand-450">
            <ChevronDown size={20} />
          </div>
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-money-neg dark:text-money-negDark font-medium">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
