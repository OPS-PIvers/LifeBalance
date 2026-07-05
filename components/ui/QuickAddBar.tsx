import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface QuickAddBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  placeholder: string;
  inputRef?: React.Ref<HTMLInputElement>;
  'aria-label'?: string;
  /** Forwarded to the underlying input (hyphenated JSX attrs aren't type-checked for forwarding). */
  'aria-labelledby'?: string;
  /** Disable the submit button (e.g. when the value is empty). */
  disabled?: boolean;
  /** Applied to the <form> wrapper. */
  className?: string;
  /** Submit icon. Defaults to a Plus glyph. */
  icon?: React.ReactNode;
  /** aria-label for the submit button. */
  submitLabel?: string;
  /**
   * When true, renders as a flush first-row of the list it feeds instead of a
   * standalone bordered/rounded input — drop the host's own detached
   * bordered/blurred band and render this directly atop a `SurfaceList` (or
   * similar) so the add bar reads as the list's first row, not a separate
   * toolbar. Defaults to `false` (unchanged standalone look).
   */
  attached?: boolean;
}

/**
 * Presentational quick-add bar: a `<form>` wrapping a styled text input with
 * an absolutely-positioned round accent submit button overlaid at the right
 * edge. Holds no state and no submit logic — the host owns the value state,
 * the submit handler, the input ref, and the disabled rule. Shared by the
 * to-do quick-add bar and the shopping-list smart-add bar so the visual shell
 * stays in lockstep.
 *
 * Default (`attached=false`) is a standalone rounded/bordered input, unchanged
 * from before. Pass `attached` to flatten the input into a flush top row (no
 * radius, no own border) for hosts that want it to sit directly on top of a
 * list surface instead of inside a separately-bordered/blurred band.
 */
export const QuickAddBar: React.FC<QuickAddBarProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder,
  inputRef,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  disabled,
  className,
  icon = <Plus size={20} />,
  submitLabel,
  attached = false,
}) => {
  return (
    <form onSubmit={onSubmit} className={cn('relative flex-1', className)}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        aria-labelledby={ariaLabelledBy}
        className={cn(
          'w-full pl-4 pr-12 py-3 bg-white transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-hidden placeholder:text-brand-400 dark:bg-brand-800 dark:text-brand-50 dark:placeholder:text-brand-500',
          attached
            ? 'border-0 border-b border-brand-200 dark:border-brand-700 focus:ring-0 focus:border-accent-500'
            : 'border border-brand-200 rounded-btn focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 dark:border-brand-600'
        )}
      />
      <Button
        type="submit"
        variant="primary"
        size="icon"
        disabled={disabled}
        aria-label={submitLabel || 'Add'}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5"
      >
        {icon}
      </Button>
    </form>
  );
};

export default QuickAddBar;
