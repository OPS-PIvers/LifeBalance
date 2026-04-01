import React, { TextareaHTMLAttributes, forwardRef, useId, useState } from 'react';
import { cn } from '../../utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  showCount?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, showCount, onChange, ...props }, ref) => {
    // Generate a unique ID if none is provided
    const generatedId = useId();
    const textareaId = id || (label ? `textarea-${label.toLowerCase().replace(/\s+/g, '-')}` : generatedId);
    const errorId = `${textareaId}-error`;

    // State for character count (only used for uncontrolled textareas)
    const [internalLength, setInternalLength] = useState(() => {
      if (props.defaultValue !== undefined) return String(props.defaultValue ?? '').length;
      return 0;
    });

    const isControlled = props.value !== undefined;
    const length = isControlled ? String(props.value ?? '').length : internalLength;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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
                htmlFor={textareaId}
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
          <textarea
            id={textareaId}
            ref={ref}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            onChange={handleChange}
            className={cn(
              "w-full p-3 bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-xl outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/20 transition-all shadow-sm placeholder:text-slate-400 disabled:opacity-50 disabled:bg-slate-50 resize-y",
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

Textarea.displayName = "Textarea";

export default Textarea;
