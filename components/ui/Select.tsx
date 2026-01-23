import React, { SelectHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../../utils/cn';
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
            className="text-xs font-bold text-brand-400 uppercase block mb-1"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 pointer-events-none">
              {icon}
            </div>
          )}
          <select
            id={selectId}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "w-full p-3 bg-brand-50 border border-brand-200 rounded-xl outline-none focus:border-brand-400 transition-colors disabled:opacity-70 disabled:bg-gray-100 appearance-none",
              icon ? "pl-10" : "pl-3",
              "pr-10", // Space for the chevron
              error && "border-money-neg focus:border-money-neg",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-brand-400">
            <ChevronDown size={20} />
          </div>
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-money-neg">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
