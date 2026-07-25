import React from 'react';
import { Trash2 } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import { Habit, EffortLevel, HabitLocationTrigger, NoSpendScope, ToDo } from '@/types/schema';
import {
  EFFORT_POINTS,
  EFFORT_LABELS,
  EFFORT_COLORS,
  NEGATIVE_CATEGORY,
} from '@/data/presetHabits';
import HabitAutomationsSection from '@/components/habits/HabitAutomationsSection';

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
  /** F-HABITS-14 — the no-spend scope this habit fires on, or undefined when the
   *  trigger is off. */
  noSpend: NoSpendScope | undefined;
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

      {/* Automations (Edit mode only) — PRD #1065. Extracted to the shared
          HabitAutomationsSection so the everyday HabitFormModal edit surface
          presents the identical controls for every habit. Always-expanded here
          since the wizard IS the dedicated custom-habit editor. */}
      {editingHabit && (
        <HabitAutomationsSection
          keywords={formData.keywords}
          onKeywordsChange={(keywords) => onFormChange({ keywords })}
          locations={formData.locations}
          onLocationsChange={(locations) => onFormChange({ locations })}
          noSpend={formData.noSpend}
          onNoSpendChange={(noSpend) => onFormChange({ noSpend })}
          linkedTodos={linkedTodos}
        />
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
