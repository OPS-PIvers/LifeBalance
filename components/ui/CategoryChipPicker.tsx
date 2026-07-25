import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { getTodoCategoryColor } from '@/utils/todoCategoryColor';

/**
 * F-TODO-16 — reusable category chip row with an inline "+ Add" editor.
 *
 * A presentational primitive extracted from the pattern `HabitFormModal`
 * implements inline, so the three to-do surfaces (form, capture tab, list
 * filter) share ONE behaviour instead of three near-copies. It owns no domain
 * state: the vocabulary, the current selection, and the persistence callback are
 * all props, so it works identically against the real context and the Test-Mode
 * mock.
 *
 * Behaviours carried over from HabitFormModal deliberately:
 * - the inline editor has its OWN in-flight busy guard, so a double-tap on Add
 *   can never issue two writes for the same name;
 * - a case-insensitive duplicate SELECTS the existing chip instead of writing;
 * - an empty input just closes the editor (no write);
 * - `onAddCategory` errors are logged and swallowed — the mutation surfaces its
 *   own toast, so the picker must not double-report.
 *
 * Chips are colored by `getTodoCategoryColor` (stable per name) and are real
 * `<button>`s with `aria-pressed`, inside a labelled `role="group"`.
 */
export interface CategoryChipPickerProps {
  /** The household's category vocabulary. */
  categories: string[];
  /** Currently selected category, or undefined for none. */
  value: string | undefined;
  onChange: (category: string | undefined) => void;
  /** Persists a newly minted category; the picker selects it on success. */
  onAddCategory: (name: string) => Promise<void>;
  /** When true, tapping the selected chip deselects it (to-dos are optional). */
  allowClear?: boolean;
  disabled?: boolean;
  /** Optional label rendered above the chips. */
  label?: string;
}

let nextGroupId = 0;

export const CategoryChipPicker: React.FC<CategoryChipPickerProps> = ({
  categories,
  value,
  onChange,
  onAddCategory,
  allowClear = false,
  disabled = false,
  label,
}) => {
  // Stable per-instance id so the label and the chip group are associated even
  // with several pickers on one screen.
  const [groupId] = useState(() => `category-chip-picker-${nextGroupId++}`);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');
  // Own busy guard: `disabled` covers the surrounding form's save, not this
  // write. Without it a double-tap on Add (before the editor closes in the
  // `finally`) fires a redundant second write.
  const [isBusy, setIsBusy] = useState(false);

  // The selected value may be a legacy/custom category that is not (or no
  // longer) in the household vocabulary — render it as a chip anyway so the
  // current selection is always visible and de-selectable. De-duped
  // case-insensitively, first spelling wins.
  const chips: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [...categories, ...(value ? [value] : [])]) {
    const key = candidate.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    chips.push(candidate);
  }

  const isSelected = (chip: string) =>
    value !== undefined && chip.trim().toLowerCase() === value.trim().toLowerCase();

  const closeEditor = () => {
    setIsAdding(false);
    setDraft('');
  };

  const confirmAdd = async () => {
    if (disabled || isBusy) return;
    const trimmed = draft.trim();
    // Empty → just close the editor (no write).
    if (!trimmed) {
      closeEditor();
      return;
    }
    // Case-insensitive dupe of an existing chip → select it, no write.
    const existing = chips.find(c => c.trim().toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      onChange(existing);
      closeEditor();
      return;
    }
    setIsBusy(true);
    try {
      await onAddCategory(trimmed);
      onChange(trimmed);
    } catch (error) {
      console.error('[CategoryChipPicker] Add category failed:', error);
      // Error toast is owned by the mutation behind onAddCategory.
    } finally {
      setIsBusy(false);
      closeEditor();
    }
  };

  return (
    <div>
      {label && (
        <span
          id={`${groupId}-label`}
          className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase"
        >
          {label}
        </span>
      )}
      <div
        className={cn('flex flex-wrap gap-1.5', label && 'mt-2')}
        role="group"
        {...(label ? { 'aria-labelledby': `${groupId}-label` } : { 'aria-label': 'Category' })}
      >
        {chips.map(chip => {
          const selected = isSelected(chip);
          const color = getTodoCategoryColor(chip);
          return (
            <button
              key={chip}
              type="button"
              onClick={() => {
                if (selected) {
                  if (allowClear) onChange(undefined);
                  return;
                }
                onChange(chip);
              }}
              disabled={disabled}
              aria-pressed={selected}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-all disabled:opacity-50',
                selected
                  ? cn(color.bg, color.text, color.border, 'font-bold')
                  : 'bg-white dark:bg-brand-800 border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50',
              )}
            >
              {chip}
            </button>
          );
        })}
        {!isAdding && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            disabled={disabled}
            aria-label="Add a category"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand-300 dark:border-brand-600 px-3 py-1.5 text-xs text-brand-500 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-700/50 transition-all disabled:opacity-50"
          >
            + Add
          </button>
        )}
      </div>
      {isAdding && (
        <div className="flex items-center gap-1.5 mt-2">
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void confirmAdd();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeEditor();
              }
            }}
            placeholder="New category"
            aria-label="New category name"
            autoFocus
            disabled={disabled || isBusy}
            className="flex-1 min-w-0 p-2 bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-lg text-sm disabled:opacity-50"
          />
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => void confirmAdd()}
            disabled={disabled || isBusy}
            aria-label="Confirm new category"
          >
            Add
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={closeEditor}
            disabled={disabled || isBusy}
            aria-label="Cancel adding category"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
};

export default CategoryChipPicker;
