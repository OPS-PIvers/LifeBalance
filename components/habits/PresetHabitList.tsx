import React from 'react';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import {
  PresetHabit,
  EFFORT_POINTS,
  EFFORT_COLORS,
  HABIT_CATEGORIES,
  NEGATIVE_CATEGORY,
} from '@/data/presetHabits';

interface PresetHabitListProps {
  presetsByCategory: Record<string, PresetHabit[]>;
  enabledPresetIds: Set<string | undefined>;
  expandedCategory: string | null;
  onToggleCategory: (category: string | null) => void;
  onTogglePreset: (preset: PresetHabit) => void;
}

const PresetHabitList: React.FC<PresetHabitListProps> = ({
  presetsByCategory,
  enabledPresetIds,
  expandedCategory,
  onToggleCategory,
  onTogglePreset,
}) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-brand-400" />
        <h3 className="text-xs font-bold text-brand-400 uppercase tracking-wider">
          Preset Habits
        </h3>
      </div>

      {/* Category Accordion */}
      <div className="space-y-2">
        {HABIT_CATEGORIES.map(category => {
          const categoryPresets = presetsByCategory[category] || [];
          if (categoryPresets.length === 0) return null;

          const enabledCount = categoryPresets.filter(p => enabledPresetIds.has(p.id)).length;
          const isExpanded = expandedCategory === category;
          const isNegativeCategory = category === NEGATIVE_CATEGORY;

          return (
            <div key={category} className={`border rounded-xl overflow-hidden ${isNegativeCategory ? 'border-rose-200' : 'border-brand-100'}`}>
              {/* Category Header */}
              <button
                onClick={() => onToggleCategory(isExpanded ? null : category)}
                className={`w-full flex items-center justify-between p-3 transition-colors ${isNegativeCategory ? 'bg-rose-50 hover:bg-rose-100' : 'bg-brand-50 hover:bg-brand-100'}`}
              >
                <span className={`font-semibold text-sm ${isNegativeCategory ? 'text-rose-700' : 'text-brand-700'}`}>{category}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs ${isNegativeCategory ? 'text-rose-400' : 'text-brand-400'}`}>
                    {enabledCount} / {categoryPresets.length} active
                  </span>
                  <ChevronRight
                    size={16}
                    className={`transition-transform ${isNegativeCategory ? 'text-rose-400' : 'text-brand-400'} ${isExpanded ? 'rotate-90' : ''}`}
                  />
                </div>
              </button>

              {/* Category Presets */}
              {isExpanded && (
                <div className="divide-y divide-brand-50">
                  {categoryPresets.map(preset => {
                    const isEnabled = enabledPresetIds.has(preset.id);
                    const pointsDisplay = preset.type === 'negative'
                      ? `-${EFFORT_POINTS[preset.effortLevel]}`
                      : `+${EFFORT_POINTS[preset.effortLevel]}`;

                    return (
                      <button
                        key={preset.id}
                        onClick={() => onTogglePreset(preset)}
                        className="w-full flex items-center justify-between p-3 hover:bg-brand-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                            isEnabled
                              ? preset.type === 'negative'
                                ? 'bg-money-neg border-money-neg text-white'
                                : 'bg-money-pos border-money-pos text-white'
                              : 'border-brand-200 text-transparent'
                          }`}>
                            <Check size={12} strokeWidth={3} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-medium text-sm truncate ${isEnabled ? 'text-brand-800' : 'text-brand-600'}`}>
                              {preset.title}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                preset.type === 'negative'
                                  ? 'bg-rose-100 text-rose-700'
                                  : `${EFFORT_COLORS[preset.effortLevel].bg} ${EFFORT_COLORS[preset.effortLevel].text}`
                              }`}>
                                {pointsDisplay} pts
                              </span>
                              <span className="text-[10px] text-brand-400">
                                {preset.period}
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PresetHabitList;
