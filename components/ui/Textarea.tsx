import React, {
  TextareaHTMLAttributes,
  forwardRef,
  useId,
  useState,
} from 'react';
import { cn } from '@/utils/cn';
import { FIELD_BASE, FIELD_ERROR } from '@/components/ui/fieldStyles';

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  /** Show a live character count (requires `maxLength`). */
  showCount?: boolean;
}

/**
 * Multi-line text field that shares Input's exact field recipe (FIELD_BASE), so
 * textareas match inputs' surface, border, focus ring, and disabled treatment.
 * Fills the gap that previously forced every multi-line field to be hand-rolled.
 */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, showCount, onChange, ...props }, ref) => {
    const generatedId = useId();
    const textareaId =
      id ||
      (label
        ? `textarea-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId}`
        : generatedId);
    const errorId = `${textareaId}-error`;

    const [internalLength, setInternalLength] = useState(() => {
      if (props.defaultValue !== undefined)
        return String(props.defaultValue ?? '').length;
      return 0;
    });

    const isControlled = props.value !== undefined;
    const length = isControlled
      ? String(props.value ?? '').length
      : internalLength;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!isControlled) {
        setInternalLength(e.target.value.length);
      }
      onChange?.(e);
    };

    const hasHeader = label || (showCount && props.maxLength);

    return (
      <div className="w-full">
        {hasHeader && (
          <div className="flex justify-between items-end mb-1.5">
            {label ? (
              <label
                htmlFor={textareaId}
                className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider block"
              >
                {label}
                {props.required && (
                  <span className="text-money-neg ml-1" aria-hidden="true">
                    *
                  </span>
                )}
              </label>
            ) : (
              <span />
            )}
            {showCount && props.maxLength && (
              <span className="text-xs text-brand-400 dark:text-brand-500 font-medium leading-none mb-0.5">
                {length}/{props.maxLength}
              </span>
            )}
          </div>
        )}
        <textarea
          id={textareaId}
          ref={ref}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          onChange={handleChange}
          className={cn(FIELD_BASE, 'resize-y min-h-20', error && FIELD_ERROR, className)}
          {...props}
        />
        {error && (
          <p id={errorId} className="mt-1 text-sm text-money-neg font-medium">
            {error}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';

export default Textarea;
