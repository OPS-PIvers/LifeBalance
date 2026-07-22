import React, { useState } from 'react';
import { Sparkles, X, Plus, ListChecks, ChevronDown } from 'lucide-react';
import Input from '@/components/ui/Input';
import { HabitLocationTrigger, ToDo } from '@/types/schema';
import { normalizeKeyword } from '@/utils/habitKeywordMatch';
import HabitLocationsEditor from '@/components/habits/HabitLocationsEditor';

/**
 * Habit Automations (PRD #1065) — the shared editor for a habit's automation
 * triggers, extracted from CustomHabitForm so BOTH the "Your Custom Habits"
 * editor (HabitCreatorWizard → CustomHabitForm) and the everyday habit-card
 * edit surface (HabitFormModal) present the same controls for EVERY habit
 * (preset or custom).
 *
 * It edits two trigger types (transaction keywords, saved geolocations) and
 * lists linked to-dos read-only (the link is authored on the to-do's "Counts
 * toward habit" picker). It is a controlled component: the parent owns the
 * `keywords`/`locations` arrays and rebuilds `Habit.triggers` from them at save
 * time (always including the `triggers` key when editing so a full clear routes
 * through updateHabit's deleteField() presence semantics).
 */
interface HabitAutomationsSectionProps {
  keywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
  locations: HabitLocationTrigger[];
  onLocationsChange: (locations: HabitLocationTrigger[]) => void;
  /** To-dos linked to this habit (read-only listing). */
  linkedTodos?: ToDo[];
  /**
   * When true, render the whole section behind a collapsed disclosure toggle so
   * it doesn't clutter a dense surface (HabitFormModal). Default false keeps the
   * always-expanded presentation used inside the dedicated wizard editor.
   */
  collapsible?: boolean;
}

const HabitAutomationsSection: React.FC<HabitAutomationsSectionProps> = ({
  keywords,
  onKeywordsChange,
  locations,
  onLocationsChange,
  linkedTodos = [],
  collapsible = false,
}) => {
  const [keywordDraft, setKeywordDraft] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const addKeyword = () => {
    const normalized = normalizeKeyword(keywordDraft);
    if (!normalized) return;
    if (keywords.includes(normalized)) {
      setKeywordDraft('');
      return;
    }
    onKeywordsChange([...keywords, normalized]);
    setKeywordDraft('');
  };

  const removeKeyword = (keyword: string) => {
    onKeywordsChange(keywords.filter(k => k !== keyword));
  };

  const heading = (
    <h3
      id="habit-automations-heading"
      className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase flex items-center gap-1.5"
    >
      <Sparkles size={13} className="text-warm-500" aria-hidden="true" />
      Automations
    </h3>
  );

  const body = (
    <div className="space-y-3">
      <div className="rounded-card border border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-700/30 p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-brand-700 dark:text-brand-200">
            Transaction keywords
          </p>
          <p className="text-xs text-brand-400 dark:text-brand-450 mt-1">
            When an approved transaction mentions one of these, this habit is offered
            to log automatically. Single words match whole words (“target” matches
            “TARGET T-1234”, not “targeted”); add a space for an exact phrase
            (“whole foods”).
          </p>
        </div>

        {keywords.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {keywords.map(keyword => (
              <span
                key={keyword}
                className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-btn text-xs font-semibold bg-white border border-brand-200 text-brand-700 dark:bg-brand-700/60 dark:border-brand-600 dark:text-brand-200"
              >
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(keyword)}
                  aria-label={`Remove keyword ${keyword}`}
                  className="p-0.5 rounded-full text-brand-400 hover:text-money-neg hover:bg-brand-100 dark:hover:bg-brand-600 transition-colors"
                >
                  <X size={12} strokeWidth={3} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Add a keyword"
              type="text"
              value={keywordDraft}
              onChange={e => setKeywordDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addKeyword();
                }
              }}
              placeholder="e.g. target, whole foods"
            />
          </div>
          <button
            type="button"
            onClick={addKeyword}
            disabled={!normalizeKeyword(keywordDraft)}
            aria-label="Add keyword"
            className="mb-0.5 shrink-0 h-11 px-3 rounded-card border border-accent-200 bg-accent-50 text-accent-700 font-semibold text-sm inline-flex items-center gap-1 hover:bg-accent-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-accent-700 dark:bg-accent-800/30 dark:text-accent-200 transition-colors"
          >
            <Plus size={16} strokeWidth={3} />
            Add
          </button>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-brand-700 dark:text-brand-200 mb-1.5">
          Saved locations
        </p>
        <HabitLocationsEditor
          locations={locations}
          onChange={onLocationsChange}
        />
      </div>

      {linkedTodos.length > 0 ? (
        <div className="rounded-card border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-xxs font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-450">
            Linked to-dos
          </p>
          <ul>
            {linkedTodos.map(todo => (
              <li
                key={todo.id}
                className="flex items-center gap-2.5 px-4 py-2.5 border-t border-brand-100 dark:border-brand-700/60 first:border-t-0"
              >
                <ListChecks size={16} className="shrink-0 text-warm-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-brand-700 dark:text-brand-200">
                  {todo.text}
                </span>
                {todo.isCompleted && (
                  <span className="shrink-0 text-xxs font-semibold uppercase tracking-wider text-money-pos dark:text-money-posDark">
                    Done
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="px-4 py-2.5 border-t border-brand-100 dark:border-brand-700/60 text-xs text-brand-400 dark:text-brand-450">
            Completing one of these logs this habit for you.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-brand-200 dark:border-brand-700 bg-brand-50/60 dark:bg-brand-700/30 p-4 text-center">
          <p className="text-sm font-semibold text-brand-700 dark:text-brand-200">
            Log this habit automatically
          </p>
          <p className="text-xs text-brand-400 dark:text-brand-450 mt-1">
            Link a to-do to this habit (from the to-do&rsquo;s &ldquo;Counts
            toward habit&rdquo; picker) and completing it fires this habit for you.
          </p>
        </div>
      )}
    </div>
  );

  if (collapsible) {
    const configuredCount = keywords.length + locations.length;
    return (
      <section aria-labelledby="habit-automations-heading" className="pt-1">
        <button
          type="button"
          onClick={() => setIsOpen(o => !o)}
          aria-expanded={isOpen}
          className="w-full flex items-center justify-between gap-2 py-1 text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-card"
        >
          <span className="flex items-center gap-2">
            {heading}
            {configuredCount > 0 && (
              <span className="text-xxs font-semibold text-warm-700 dark:text-warm-300 bg-warm-100 dark:bg-warm-900/40 rounded-full px-1.5 py-0.5">
                {configuredCount}
              </span>
            )}
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-brand-400 transition-transform duration-(--duration-fast) ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
        {isOpen && <div className="mt-3">{body}</div>}
      </section>
    );
  }

  return (
    <section aria-labelledby="habit-automations-heading" className="pt-1 space-y-3">
      {heading}
      {body}
    </section>
  );
};

export default HabitAutomationsSection;
