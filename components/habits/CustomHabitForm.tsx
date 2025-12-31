import React from 'react';
import { Trash2 } from 'lucide-react';
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
        <label className="text-xs font-bold text-brand-400 uppercase">Habit Name</label>
        <input
          type="text"
          value={formData.title}
          onChange={e => onFormChange({ title: e.target.value })}
          placeholder="e.g., Practice guitar"
          className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl focus:ring-2 focus:ring-brand-300 focus:border-brand-300 outline-none"
        />
      </div>

      {/* Category & Type */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-brand-400 uppercase">Category</label>
          <select
            value={formData.category}
            onChange={e => onFormChange({ category: e.target.value })}
            className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl"
          >
            {CUSTOM_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-brand-400 uppercase">Type</label>
          <div className="flex bg-brand-50 p-1 rounded-xl mt-1 border border-brand-200">
            <button
              onClick={() => onFormChange({ type: 'positive' })}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                formData.type === 'positive' ? 'bg-white shadow-sm text-money-pos' : 'text-brand-400'
              }`}
            >
              Good
            </button>
            <button
              onClick={() => onFormChange({ type: 'negative' })}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                formData.type === 'negative' ? 'bg-white shadow-sm text-money-neg' : 'text-brand-400'
              }`}
            >
              Bad
            </button>
          </div>
        </div>
      </div>

      {/* Effort Level */}
      <div>
        <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">
          Effort Level <span className="font-normal text-brand-300">(determines points)</span>
        </label>
        <div className="grid grid-cols-4 gap-2">
          {EFFORT_LEVELS.map(level => (
            <button
              key={level}
              onClick={() => onFormChange({ effortLevel: level })}
              className={`p-3 rounded-xl border text-center transition-all ${
                formData.effortLevel === level
                  ? `${EFFORT_COLORS[level].bg} ${EFFORT_COLORS[level].text} border-current ring-1 ring-current`
                  : 'bg-white border-brand-200 text-brand-600 hover:bg-brand-50'
              }`}
            >
              <span className="block text-xs font-bold">{EFFORT_LABELS[level]}</span>
              <span className="block text-[10px] mt-0.5 opacity-75">
                {formData.type === 'positive' ? '+' : '-'}{EFFORT_POINTS[level]} pts
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Scoring Type */}
      <div>
        <label className="text-xs font-bold text-brand-400 uppercase mb-2 block">Scoring Strategy</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onFormChange({ scoringType: 'threshold' })}
            className={`p-3 rounded-xl border text-left transition-all ${
              formData.scoringType === 'threshold'
                ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200'
                : 'bg-brand-50 border-transparent hover:bg-white'
            }`}
          >
            <span className="block font-bold text-sm text-brand-800">Threshold</span>
            <span className="block text-[10px] text-brand-400 mt-0.5">Points when target is met</span>
          </button>
          <button
            onClick={() => onFormChange({ scoringType: 'incremental' })}
            className={`p-3 rounded-xl border text-left transition-all ${
              formData.scoringType === 'incremental'
                ? 'bg-white border-brand-300 shadow-sm ring-1 ring-brand-200'
                : 'bg-brand-50 border-transparent hover:bg-white'
            }`}
          >
            <span className="block font-bold text-sm text-brand-800">Incremental</span>
            <span className="block text-[10px] text-brand-400 mt-0.5">Points for every tap</span>
          </button>
        </div>
      </div>

      {/* Target & Period */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-bold text-brand-400 uppercase">Target Count</label>
          <input
            type="number"
            min="1"
            value={formData.targetCount}
            onChange={e => onFormChange({ targetCount: e.target.value })}
            className="w-full mt-1 p-3 bg-brand-50 border border-brand-200 rounded-xl text-center font-mono font-bold"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-brand-400 uppercase">Period</label>
          <div className="flex bg-brand-50 p-1 rounded-xl mt-1 border border-brand-200">
            <button
              onClick={() => onFormChange({ period: 'daily' })}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                formData.period === 'daily' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => onFormChange({ period: 'weekly' })}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${
                formData.period === 'weekly' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'
              }`}
            >
              Weekly
            </button>
          </div>
        </div>
      </div>

      {/* Delete Button (Edit mode only) */}
      {editingHabit && onDelete && (
        <button
          onClick={() => onDelete(editingHabit)}
          className="w-full py-3 text-money-neg font-semibold rounded-xl border border-rose-200 hover:bg-rose-50 transition-colors flex items-center justify-center gap-2"
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
