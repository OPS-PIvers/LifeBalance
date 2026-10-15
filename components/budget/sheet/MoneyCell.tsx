import React, { useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { roundMoney } from '@/utils/money';

interface MoneyCellProps {
  /** Current amount; undefined shows an empty cell. */
  value: number | undefined;
  /** Called with the new amount (or undefined when cleared) once the user
   *  leaves the cell or presses Enter, and only when it changed. */
  onCommit: (amount: number | undefined) => void;
  /** Accessible name, e.g. "Mortgage amount". */
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Resting display: grouped, two decimals (2,851.50). */
const show = (value: number | undefined) =>
  value === undefined
    ? ''
    : roundMoney(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** While typing: the bare number, nothing to delete around it. */
const raw = (value: number | undefined) => (value === undefined ? '' : String(roundMoney(value)));

/**
 * A spreadsheet-style amount cell: type straight into it, Enter or leaving
 * the cell saves, Escape puts the old value back. Plain numbers, no currency
 * symbol inside the input, so typing is never fighting a formatter.
 */
const MoneyCell: React.FC<MoneyCellProps> = ({ value, onCommit, label, disabled, className }) => {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape blurs the cell, and blur commits — this tells that commit to skip.
  const cancelled = useRef(false);
  const text = draft ?? show(value);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    setDraft(null);
    const trimmed = draft.replace(/[$,\s]/g, '');
    if (trimmed === '') {
      if (value !== undefined) onCommit(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    const next = roundMoney(Math.abs(parsed));
    if (next !== (value === undefined ? undefined : roundMoney(value))) onCommit(next);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      disabled={disabled}
      value={text}
      placeholder="—"
      onFocus={e => {
        const input = e.currentTarget;
        setDraft(raw(value));
        // Select after React re-renders the raw text into the input.
        requestAnimationFrame(() => input.select());
      }}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
      className={cn(
        'w-24 shrink-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-right font-mono text-base sm:text-sm tabular-nums',
        'text-brand-800 dark:text-brand-100 placeholder:text-brand-300 dark:placeholder:text-brand-600',
        'hover:border-brand-200 dark:hover:border-brand-700 focus:border-accent-500 focus:bg-white dark:focus:bg-brand-800 focus:outline-none',
        'disabled:opacity-60 disabled:hover:border-transparent',
        className
      )}
    />
  );
};

export default MoneyCell;
