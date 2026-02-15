import React, { InputHTMLAttributes, forwardRef, useId, useState } from 'react';
import { cn } from '../../utils/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  showCount?: boolean;
  containerClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, icon, id, showCount, onChange, containerClassName, ...props }, ref) => {
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
      <div className={cn("w-full", containerClassName)}>
        {hasHeader && (
          <div className="flex justify-between items-end mb-1.5">
            {label ? (
              <label
                htmlFor={inputId}
                className="text-xs font-semibold text-slate-500 uppercase tracking-wider block"
              >
                {label}
                {props.required && <span className="text-rose-500 ml-1" aria-hidden="true">*</span>}
              </label>
            ) : <span />}
            {showCount && props.maxLength && (
              <span className="text-xs text-slate-400 font-medium leading-none mb-0.5">
                {length}/{props.maxLength}
              </span>
            )}
          </div>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
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
              "w-full p-3 bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-xl outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 transition-all shadow-sm placeholder:text-slate-400 disabled:opacity-50 disabled:bg-slate-50",
              icon && "pl-10",
              error && "border-rose-500 focus:border-rose-500 focus:ring-rose-500/10",
              className
            )}
            {...props}
          />
        </div>
        {error && (
          <p id={errorId} className="mt-1 text-sm text-rose-500 font-medium">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
