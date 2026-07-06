import React, { InputHTMLAttributes, forwardRef, useId, useState } from 'react';
import { cn } from '@/utils/cn';
import { FIELD_BASE, FIELD_ERROR } from '@/components/ui/fieldStyles';

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
                {props.required && <span className="text-money-neg dark:text-money-negDark ml-1" aria-hidden="true">*</span>}
              </label>
            ) : <span />}
            {showCount && props.maxLength && (
              <span className="text-xs text-brand-400 dark:text-brand-450 font-medium leading-none mb-0.5">
                {length}/{props.maxLength}
              </span>
            )}
          </div>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-450 pointer-events-none">
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
              FIELD_BASE,
              icon && "pl-10",
              error && FIELD_ERROR,
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-money-neg dark:text-money-negDark font-medium">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
