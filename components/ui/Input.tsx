import React, { InputHTMLAttributes, forwardRef, useId, useState } from 'react';
import { cn } from '@/utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  showCount?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, id, showCount, onChange, ...props }, ref) => {
    // Generate a unique ID if none is provided
    const generatedId = useId();
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : generatedId);
    const errorId = `${inputId}-error`;

    // State for character count (only used for uncontrolled inputs)
    const [internalLength, setInternalLength] = useState(() => {
      if (props.defaultValue !== undefined) return String(props.defaultValue ?? '').length;
      return 0;
    });

    const isControlled = props.value !== undefined;
    const length = isControlled ? String(props.value ?? '').length : internalLength;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) {
        setInternalLength(e.target.value.length);
      }
      if (onChange) {
        onChange(e);
      }
    };

    const hasHeader = label || (showCount && props.maxLength);

    return (
      <div className="w-full">
        {hasHeader && (
          <div className="flex justify-between items-end mb-1.5">
            {label ? (
              <label
                htmlFor={inputId}
                className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider block"
              >
                {label}
                {props.required && <span className="text-money-neg ml-1" aria-hidden="true">*</span>}
              </label>
            ) : <span />}
            {showCount && props.maxLength && (
              <span className="text-xs text-brand-400 dark:text-brand-500 font-medium leading-none mb-0.5">
                {length}/{props.maxLength}
              </span>
            )}
          </div>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-500 pointer-events-none">
              {icon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={handleChange}
            className={cn(
              "w-full p-3 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-btn outline-hidden text-brand-900 dark:text-brand-100 focus:border-accent-500 focus:ring-2 focus:ring-accent-500/30 transition-all duration-(--duration-fast) ease-(--ease-standard) placeholder:text-brand-400 dark:placeholder:text-brand-500 disabled:opacity-50 disabled:bg-brand-50 dark:disabled:bg-brand-700/50",
              icon && "pl-10",
              error && "border-money-neg focus:border-money-neg focus:ring-money-neg/20",
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-money-neg font-medium">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
