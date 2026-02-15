import React, { SelectHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../../utils/cn';
import { ChevronDown } from 'lucide-react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  containerClassName?: string;
  size?: 'sm' | 'md';
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, icon, id, children, containerClassName, size = 'md', ...props }, ref) => {
    const generatedId = useId();
    const selectId = id || (label ? `select-${label.toLowerCase().replace(/\s+/g, '-')}` : generatedId);
    const errorId = `${selectId}-error`;

    const sizes = {
      sm: 'py-2 px-3 text-sm',
      md: 'p-3',
    };

    return (
      <div className={cn("w-full", containerClassName)}>
        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1.5"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              {icon}
            </div>
          )}
          <select
            id={selectId}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={cn(
              "w-full bg-white border border-slate-200 rounded-xl outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all shadow-sm disabled:opacity-50 disabled:bg-slate-50 appearance-none text-slate-900",
              sizes[size],
              icon ? "pl-10" : "pl-3",
              "pr-10", // Space for the chevron
              error && "border-rose-500 focus:border-rose-500 focus:ring-rose-500/10",
              className
            )}
            {...props}
          >
            {children}
          </select>
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
            <ChevronDown size={20} />
          </div>
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-rose-500 font-medium">{error}</p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
