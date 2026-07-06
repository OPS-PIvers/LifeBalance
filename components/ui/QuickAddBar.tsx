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
   * When true, renders as a flush first ROW INSIDE a `SurfaceList` — no own
   * radius, no own border, no background layer of its own (the surrounding
   * `SurfaceList` supplies the solid surface + outer radius + border). The
   * host is responsible for drawing the hairline divider between this row and
   * the first list item (e.g. wrap in a `Row`-like container, or rely on
   * `SurfaceList`'s `[&>*:first-child]:border-t-0` + a `hairline-divider` on
   * the next sibling). Defaults to `false` (standalone rounded/bordered look
   * for hosts that render the bar outside any list surface).
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
 * from before. Pass `attached` to flatten the input into a flush, borderless
 * row (no radius, no border of its own, transparent background) meant to live
 * INSIDE the same `SurfaceList` as the items it feeds — as their first row,
 * not a separate band above the list.
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
  if (attached) {
    // In-card row: plain flex — the input and submit button are SIBLINGS, so
    // the placeholder can never run underneath the button (the old absolute
    // overlay clipped long placeholders against the button edge). The submit
    // is a quiet accent icon, not a filled square, so the row reads as a list
    // row rather than a widget pasted into the card.
    return (
      <form onSubmit={onSubmit} className={cn('flex flex-1 items-center min-w-0', className)}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          aria-labelledby={ariaLabelledBy}
          className="min-w-0 flex-1 pl-4 pr-2 py-3.5 bg-transparent border-0 outline-hidden focus:ring-0 placeholder:truncate placeholder:text-brand-400 dark:text-brand-50 dark:placeholder:text-brand-450 transition-colors duration-(--duration-fast) ease-(--ease-standard)"
        />
        <button
          type="submit"
          disabled={disabled}
          aria-label={submitLabel || 'Add'}
          className="flex-none flex items-center justify-center p-3 rounded-btn text-accent-600 hover:text-accent-700 hover:bg-accent-50 disabled:text-brand-300 dark:text-accent-300 dark:hover:text-accent-200 dark:hover:bg-accent-900/20 dark:disabled:text-brand-600 transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset"
        >
          {icon}
        </button>
      </form>
    );
  }

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
        className="w-full pl-4 pr-12 py-3.5 transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-hidden placeholder:text-brand-400 dark:text-brand-50 dark:placeholder:text-brand-450 border border-brand-200 rounded-btn bg-white focus:ring-2 focus:ring-accent-500/40 focus:border-accent-500 dark:bg-brand-800 dark:border-brand-600"
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
