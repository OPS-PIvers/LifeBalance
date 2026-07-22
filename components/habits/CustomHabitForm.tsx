import React, { useState } from 'react';
import { Trash2, Sparkles, X, Plus, ListChecks } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Habit, EffortLevel, HabitLocationTrigger, ToDo } from '@/types/schema';
import { normalizeKeyword } from '@/utils/habitKeywordMatch';
import {
  EFFORT_POINTS,
  EFFORT_LABELS,
  EFFORT_COLORS,
  NEGATIVE_CATEGORY,
} from '@/data/presetHabits';
import HabitLocationsEditor from '@/components/habits/HabitLocationsEditor';

// Categories for custom habit creation
const CUSTOM_CATEGORIES = ['Health', 'Meal Planning', 'Household', 'Financial Planning', 'Self-Discipline', NEGATIVE_CATEGORY];

// All effort levels in order
const EFFORT_LEVELS: EffortLevel[] = ['easy', 'medium', 'hard', 'very_hard'];

export interface CustomHabitFormData {
  title: string;
  category: string;
  type: 'positive' | 'negative';
  effortLevel: EffortLevel;
  scoringType: 'incremental' | 'threshold';
  period: 'daily' | 'weekly';
  targetCount: string;
  /** Habit Automations (PRD #1065): transaction-keyword triggers. Single words
   *  match whole-word; entries with a space match as an exact phrase. Empty on
   *  a habit with no keyword automation. */
  keywords: string[];
  /** Habit Automations (PRD #1065) — saved geolocation triggers being edited
   *  in this form session (merged back with any other trigger type on save). */
  locations: HabitLocationTrigger[];
}

interface CustomHabitFormProps {
  formData: CustomHabitFormData;
  onFormChange: (data: Partial<CustomHabitFormData>) => void;
  editingHabit: Habit | null;
  onDelete?: (habit: Habit) => void;
  /**
   * Habit Automations (PRD #1065): the to-dos linked to this habit (read-only).
   * The link is AUTHORED on the to-do ("Counts toward habit" picker); the habit
   * editor only lists them so all automations are visible in one place.
   */
  linkedTodos?: ToDo[];
}

const CustomHabitForm: React.FC<CustomHabitFormProps> = ({
  formData,
  onFormChange,
  editingHabit,
  onDelete,
  linkedTodos = [],
}) => {
  const [keywordDraft, setKeywordDraft] = useState('');

  const addKeyword = () => {
    const normalized = normalizeKeyword(keywordDraft);
    if (!normalized) return;
    if (formData.keywords.includes(normalized)) {
      setKeywordDraft('');
      return;
    }
    onFormChange({ keywords: [...formData.keywords, normalized] });
    setKeywordDraft('');
  };

  const removeKeyword = (keyword: string) => {
    onFormChange({ keywords: formData.keywords.filter(k => k !== keyword) });
  };

  return (
    <div className="p-6 space-y-5">

      {/* Title */}
      <Input
        label="Habit Name"
        type="text"
        value={formData.title}
        onChange={e => onFormChange({ title: e.target.value })}
        placeholder="e.g., Practice guitar"
      />

      {/* Category & Type */}
      <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
        <Select
          label="Category"
          value={formData.category}
          onChange={e => onFormChange({ category: e.target.value })}
        >
          {CUSTOM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Type</label>
          <SegmentedControl
            value={formData.type}
            onChange={(val) => onFormChange({ type: val as 'positive' | 'negative' })}
            name="Habit Type"
            options={[
              { value: 'positive', label: 'Good', activeClassName: 'text-money-pos dark:text-money-posDark' },
              { value: 'negative', label: 'Bad', activeClassName: 'text-money-neg dark:text-money-negDark' },
            ]}
            className="mt-1"
          />
        </div>
      </div>

      {/* Effort Level */}
      <div>
        <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 block">
          Effort Level <span className="font-normal text-brand-300 dark:text-brand-450">(determines points)</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {EFFORT_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => onFormChange({ effortLevel: level })}
              className={`p-3 rounded-card border text-center transition-all focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 ${
                formData.effortLevel === level
                  ? `${EFFORT_COLORS[level].bg} ${EFFORT_COLORS[level].text} border-current ring-1 ring-current`
                  : 'bg-white dark:bg-brand-700/50 border-brand-200 dark:border-brand-700 text-brand-600 dark:text-brand-450 hover:bg-brand-50 dark:hover:bg-brand-700'
              }`}
            >
              <span className="block text-xs font-bold">{EFFORT_LABELS[level]}</span>
              <span className="block text-xxs mt-0.5 opacity-75">
                {formData.type === 'positive' ? '+' : '-'}{EFFORT_POINTS[level]} pts
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Scoring Type */}
      <div>
        <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 block">Scoring Strategy</label>
        <SegmentedControl
          tone="warm"
          name="Scoring Strategy"
          value={formData.scoringType}
          onChange={(val) => onFormChange({ scoringType: val as 'incremental' | 'threshold' })}
          options={[
            {
              value: 'threshold',
              label: (
                <span className="block text-left">
                  <span className="block font-bold text-sm text-brand-800 dark:text-brand-100">Threshold</span>
                  <span className="block text-xxs text-brand-400 dark:text-brand-400 mt-0.5">Points when target is met</span>
                </span>
              ),
            },
            {
              value: 'incremental',
              label: (
                <span className="block text-left">
                  <span className="block font-bold text-sm text-brand-800 dark:text-brand-100">Incremental</span>
                  <span className="block text-xxs text-brand-400 dark:text-brand-400 mt-0.5">Points for every tap</span>
                </span>
              ),
            },
          ]}
        />
      </div>

      {/* Target & Period */}
      <div className="grid grid-cols-2 gap-4 [&>*]:min-w-0">
        <Input
          label="Target Count"
          type="number"
          min="1"
          value={formData.targetCount}
          onChange={e => onFormChange({ targetCount: e.target.value })}
          className="text-center font-mono font-bold"
        />
        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase">Period</label>
          <SegmentedControl
            value={formData.period}
            onChange={(val) => onFormChange({ period: val as 'daily' | 'weekly' })}
            name="Frequency Period"
            options={[
              { value: 'daily', label: 'Daily', activeClassName: 'text-brand-800' },
              { value: 'weekly', label: 'Weekly', activeClassName: 'text-brand-800' },
            ]}
            className="mt-1"
          />
        </div>
      </div>

      {/* Automations (Edit mode only) — PRD #1065. Transaction keywords and
          geolocation triggers are both fully wired here (keyword chips +
          saved locations editor); linked to-dos are listed read-only last
          (the link is authored on the to-do's "Counts toward habit" picker). */}
      {editingHabit && (
        <section aria-labelledby="habit-automations-heading" className="pt-1 space-y-3">
          <h3
            id="habit-automations-heading"
            className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase mb-2 flex items-center gap-1.5"
          >
            <Sparkles size={13} className="text-warm-500" aria-hidden="true" />
            Automations
          </h3>
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

            {formData.keywords.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.keywords.map(keyword => (
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
              locations={formData.locations}
              onChange={(locations) => onFormChange({ locations })}
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
        </section>
      )}

      {/* Delete Button (Edit mode only) */}
      {editingHabit && onDelete && (
        <button
          onClick={() => onDelete(editingHabit)}
          className="w-full py-3 text-money-neg dark:text-money-negDark font-semibold rounded-card border border-money-neg/30 dark:border-money-neg/40 hover:bg-money-bgNeg dark:hover:bg-money-neg/15 transition-colors flex items-center justify-center gap-2"
          aria-label={`Delete habit: ${editingHabit.title}`}
        >
          <Trash2 size={16} />
          Delete This Habit
        </button>
      )}

    </div>
  );
};

export default CustomHabitForm;
