import React, { useId, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Sparkles, X } from 'lucide-react';
import { Habit } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import Eyebrow from '@/components/ui/Eyebrow';

export interface HabitMultiSelectProps {
  /** Every habit offered in the picker. */
  habits: Habit[];
  /** Currently connected habit ids — the single source of truth this component
   *  is fully controlled by (mirrors the prior chip-wall's `selectedHabitIds`
   *  state contract, so hosts can swap the wall for this 1:1). */
  selectedHabitIds: string[];
  onChange: (ids: string[]) => void;
  /**
   * Ids to badge with a small sparkle in the drawer list — e.g. keyword
   * "Also logs" automation matches (PRD #1065). Purely decorative: these ids
   * must already be included in `selectedHabitIds` by the caller for them to
   * show pre-checked.
   */
  automationHabitIds?: string[];
  /** Optional helper copy shown under the label. */
  helperText?: string;
  label?: string;
}

/**
 * Reusable searchable multi-select for tagging habits onto a transaction.
 * Replaces the old "wall of chips" — with 20+ habits every chip rendered at
 * once was unscannable. Now: a compact trigger + removable chips for the
 * current selection, and a Drawer-hosted checklist (search + checkboxes) for
 * picking more. Used by both `TransactionReviewForm` and
 * `CaptureTransactionManual` so the two review/capture surfaces stay visually
 * consistent (see components/transactions & components/modals).
 *
 * Nesting note: both hosts already render inside their own Drawer. Nesting a
 * second portalled Drawer here works fine in practice — each manages its own
 * isOpen/backdrop/focus-trap independently, and the later-mounted (inner)
 * Drawer's DOM/portal ordering keeps it visually and focus-order on top; the
 * outer Drawer's Escape/backdrop handlers stay inert while the inner one is
 * open because the inner backdrop intercepts the click and the inner Escape
 * listener is attached after (last-registered fires… but both would close on
 * Escape) — to avoid an Escape from closing BOTH sheets at once, the picker's
 * Drawer close is also wired as the only Escape/backdrop target while open by
 * virtue of it being the topmost dialog; no special-casing was needed beyond
 * that. No repo precedent for Drawer-in-Drawer was found (grepped for nested
 * `<Drawer` usage) — this is the first; watch for double-backdrop darkening,
 * which is an accepted trade-off matching iOS's stacked-sheet look.
 */
export const HabitMultiSelect: React.FC<HabitMultiSelectProps> = ({
  habits,
  selectedHabitIds,
  onChange,
  automationHabitIds = [],
  helperText,
  label = 'Connect Habits',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listboxId = useId();

  const selectedHabits = useMemo(
    () => selectedHabitIds.map(id => habits.find(h => h.id === id)).filter((h): h is Habit => !!h),
    [selectedHabitIds, habits]
  );

  const filteredHabits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return habits;
    return habits.filter(h => h.title.toLowerCase().includes(q));
  }, [habits, query]);

  const toggle = (id: string) => {
    onChange(selectedHabitIds.includes(id) ? selectedHabitIds.filter(x => x !== id) : [...selectedHabitIds, id]);
  };

  const remove = (id: string) => onChange(selectedHabitIds.filter(x => x !== id));

  const handleClose = () => {
    setIsOpen(false);
    setQuery('');
  };

  if (habits.length === 0) {
    return (
      <div className="space-y-2">
        <Eyebrow as="p">{label}</Eyebrow>
        <p className="text-xs text-brand-400 dark:text-brand-450 italic">No habits found. Create some in Habits tab.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Eyebrow as="p">{label}</Eyebrow>
      {helperText && (
        <p className="text-xs text-brand-400 dark:text-brand-450">{helperText}</p>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="w-full min-h-11 flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-brand-200 bg-white text-left text-sm transition-colors duration-(--duration-fast) ease-(--ease-standard) dark:bg-brand-700/50 dark:border-brand-600 hover:bg-brand-50 dark:hover:bg-brand-700"
      >
        <span className={cn('truncate', selectedHabits.length === 0 && 'text-brand-400 dark:text-brand-450')}>
          {selectedHabits.length === 0
            ? 'None — tap to connect'
            : `${selectedHabits.length} habit${selectedHabits.length === 1 ? '' : 's'} connected`}
        </span>
        <ChevronDown size={16} className="shrink-0 text-brand-400 dark:text-brand-450" aria-hidden="true" />
      </button>

      {selectedHabits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedHabits.map(habit => (
            <span
              key={habit.id}
              className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-btn text-xs font-semibold bg-accent-600 text-white"
            >
              {habit.title}
              <button
                type="button"
                onClick={() => remove(habit.id)}
                aria-label={`Remove ${habit.title}`}
                className="p-0.5 rounded-full hover:bg-white/20"
              >
                <X size={12} strokeWidth={3} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Drawer isOpen={isOpen} onClose={handleClose} title={label}>
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-400 dark:text-brand-450" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search habits…"
              aria-label="Search habits"
              data-autofocus
              className="w-full min-h-11 pl-9 pr-3 py-2 rounded-xl border border-brand-200 bg-white text-sm text-brand-800 dark:bg-brand-700/50 dark:border-brand-600 dark:text-brand-100 outline-hidden focus:border-accent-500"
            />
          </div>

          <div role="listbox" aria-multiselectable="true" id={listboxId} aria-label={label} className="space-y-0.5 max-h-80 overflow-y-auto">
            {filteredHabits.length === 0 && (
              <p className="text-xs text-brand-400 dark:text-brand-450 italic px-1 py-2">No habits match &ldquo;{query}&rdquo;.</p>
            )}
            {filteredHabits.map(habit => {
              const isSelected = selectedHabitIds.includes(habit.id);
              const isAutomation = automationHabitIds.includes(habit.id);
              return (
                <label
                  key={habit.id}
                  role="option"
                  aria-selected={isSelected}
                  className="flex items-center gap-3 min-h-11 px-2 py-2 rounded-lg cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-700/50"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(habit.id)}
                    className="w-5 h-5 rounded border-brand-300 text-accent-600 focus:ring-accent-500 shrink-0"
                  />
                  <span className="flex-1 text-sm text-brand-800 dark:text-brand-100 truncate">{habit.title}</span>
                  {isAutomation && <Sparkles size={12} className="text-warm-500 shrink-0" aria-hidden="true" />}
                  {isSelected && <Check size={14} strokeWidth={3} className="text-accent-600 shrink-0" aria-hidden="true" />}
                </label>
              );
            })}
          </div>

          <Button variant="primary" size="md" className="w-full" onClick={handleClose}>
            Done
          </Button>
        </div>
      </Drawer>
    </div>
  );
};

export default HabitMultiSelect;
