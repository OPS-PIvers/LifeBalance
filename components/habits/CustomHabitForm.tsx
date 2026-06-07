import React from 'react';
import { Trash2 } from 'lucide-react';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Habit, EffortLevel } from '@/types/schema';
import {
  EFFORT_POINTS,
  EFFORT_LABELS,
  EFFORT_COLORS,
  NEGATIVE_CATEGORY,
} from '@/data/presetHabits';

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
}

interface CustomHabitFormProps {
  formData: CustomHabitFormData;
  onFormChange: (data: Partial<CustomHabitFormData>) => void;
  editingHabit: Habit | null;
  onDelete?: (habit: Habit) => void;
}

const CustomHabitForm: React.FC<CustomHabitFormProps> = ({
  formData,
  onFormChange,
  editingHabit,
  onDelete,
}) => {
  return (
    <div className="p-6 space-y-5">

      {/* Title */}
      <div>
        <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase">Habit Name</label>
        <input
          type="text"
          value={formData.title}
          onChange={e => onFormChange({ title: e.target.value })}
          placeholder="e.g., Practice guitar"
          className="w-full mt-1 p-3 bg-brand-50 dark:bg-slate-700/50 border border-brand-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-brand-300 focus:border-brand-300 outline-none"
        />
      </div>

      {/* Category & Type */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase">Category</label>
          <select
            value={formData.category}
            onChange={e => onFormChange({ category: e.target.value })}
            className="w-full mt-1 p-3 bg-brand-50 dark:bg-slate-700/50 border border-brand-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
          >
            {CUSTOM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase">Type</label>
          <SegmentedControl
            value={formData.type}
            onChange={(val) => onFormChange({ type: val as 'positive' | 'negative' })}
            name="Habit Type"
            options={[
              { value: 'positive', label: 'Good', activeClassName: 'text-money-pos' },
              { value: 'negative', label: 'Bad', activeClassName: 'text-money-neg' },
            ]}
            className="mt-1"
          />
        </div>
      </div>

      {/* Effort Level */}
      <div>
        <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase mb-2 block">
          Effort Level <span className="font-normal text-brand-300 dark:text-slate-500">(determines points)</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {EFFORT_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => onFormChange({ effortLevel: level })}
              className={`p-3 rounded-xl border text-center transition-all ${
                formData.effortLevel === level
                  ? `${EFFORT_COLORS[level].bg} ${EFFORT_COLORS[level].text} border-current ring-1 ring-current`
                  : 'bg-white dark:bg-slate-700/50 border-brand-200 dark:border-slate-700 text-brand-600 dark:text-slate-300 hover:bg-brand-50 dark:hover:bg-slate-700'
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
        <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase mb-2 block">Scoring Strategy</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onFormChange({ scoringType: 'threshold' })}
            className={`p-3 rounded-xl border text-left transition-all ${
              formData.scoringType === 'threshold'
                ? 'bg-white dark:bg-slate-700 border-brand-300 dark:border-slate-600 shadow-sm ring-1 ring-brand-200 dark:ring-slate-600'
                : 'bg-brand-50 dark:bg-slate-700/50 border-transparent hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <span className="block font-bold text-sm text-brand-800 dark:text-slate-100">Threshold</span>
            <span className="block text-xxs text-brand-400 dark:text-slate-400 mt-0.5">Points when target is met</span>
          </button>
          <button
            onClick={() => onFormChange({ scoringType: 'incremental' })}
            className={`p-3 rounded-xl border text-left transition-all ${
              formData.scoringType === 'incremental'
                ? 'bg-white dark:bg-slate-700 border-brand-300 dark:border-slate-600 shadow-sm ring-1 ring-brand-200 dark:ring-slate-600'
                : 'bg-brand-50 dark:bg-slate-700/50 border-transparent hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <span className="block font-bold text-sm text-brand-800 dark:text-slate-100">Incremental</span>
            <span className="block text-xxs text-brand-400 dark:text-slate-400 mt-0.5">Points for every tap</span>
          </button>
        </div>
      </div>

      {/* Target & Period */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase">Target Count</label>
          <input
            type="number"
            min="1"
            value={formData.targetCount}
            onChange={e => onFormChange({ targetCount: e.target.value })}
            className="w-full mt-1 p-3 bg-brand-50 dark:bg-slate-700/50 border border-brand-200 dark:border-slate-700 rounded-xl text-center font-mono font-bold text-slate-900 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-brand-400 dark:text-slate-400 uppercase">Period</label>
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

      {/* Delete Button (Edit mode only) */}
      {editingHabit && onDelete && (
        <button
          onClick={() => onDelete(editingHabit)}
          className="w-full py-3 text-money-neg font-semibold rounded-xl border border-rose-200 dark:border-rose-500/30 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors flex items-center justify-center gap-2"
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
