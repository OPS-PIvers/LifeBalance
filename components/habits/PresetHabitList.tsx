import React from 'react';
import { Check, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Section, SurfaceList } from '@/components/ui/Section';
import { Badge } from '@/components/ui/Badge';
import {
  PresetHabit,
  EFFORT_POINTS,
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

/**
 * Flat, always-visible list of preset habits grouped by category — one
 * typographic Section header + SurfaceList per category, stacked continuously.
 * No inline accordion/expand-collapse: per the design system, content that
 * "expands into nested options" becomes a flat scrollable Section instead.
 *
 * `expandedCategory`/`onToggleCategory` are retained in the prop signature for
 * compatibility with HabitCreatorWizard (which still owns that state) but are
 * no longer used to gate visibility here — every category is always shown.
 */
const PresetHabitList: React.FC<PresetHabitListProps> = ({
  presetsByCategory,
  enabledPresetIds,
  onTogglePreset,
}) => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={14} className="text-brand-400 dark:text-brand-450" />
        <h3 className="text-xs font-bold text-brand-400 dark:text-brand-400 uppercase tracking-wider">
          Preset Habits
        </h3>
      </div>

      <div className="space-y-6">
        {HABIT_CATEGORIES.map(category => {
          const categoryPresets = presetsByCategory[category] || [];
          if (categoryPresets.length === 0) return null;

          const enabledCount = categoryPresets.filter(p => enabledPresetIds.has(p.id)).length;
          const isNegativeCategory = category === NEGATIVE_CATEGORY;

          return (
            <Section
              key={category}
              title={
                <span className="flex items-baseline gap-2">
                  <span
                    className={
                      isNegativeCategory ? 'text-money-neg dark:text-money-negDark' : undefined
                    }
                  >
                    {category}
                  </span>
                  <span className="font-sans text-xs font-normal normal-case tracking-normal text-brand-400 dark:text-brand-400">
                    {enabledCount} / {categoryPresets.length} active
                  </span>
                </span>
              }
            >
              <SurfaceList>
                {categoryPresets.map(preset => {
                  const isEnabled = enabledPresetIds.has(preset.id);
                  const pointsDisplay = preset.type === 'negative'
                    ? `-${EFFORT_POINTS[preset.effortLevel]}`
                    : `+${EFFORT_POINTS[preset.effortLevel]}`;

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onTogglePreset(preset)}
                      aria-pressed={isEnabled}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left hairline-divider',
                        'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                        'hover:bg-brand-50 dark:hover:bg-brand-700/40',
                        'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-inset'
                      )}
                    >
                      <div
                        className={cn(
                          'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                          isEnabled
                            ? preset.type === 'negative'
                              ? 'bg-money-neg border-money-neg text-white'
                              : 'bg-money-pos border-money-pos text-white'
                            : 'border-brand-200 dark:border-brand-600 text-transparent'
                        )}
                      >
                        <Check size={12} strokeWidth={3} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            'font-medium text-sm truncate',
                            isEnabled
                              ? 'text-brand-800 dark:text-brand-100'
                              : 'text-brand-600 dark:text-brand-450'
                          )}
                        >
                          {preset.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge size="sm" variant={preset.type === 'negative' ? 'danger' : 'warning'}>
                            {pointsDisplay} pts
                          </Badge>
                          <span className="text-xxs text-brand-400 dark:text-brand-400">
                            {preset.period}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </SurfaceList>
            </Section>
          );
        })}
      </div>
    </div>
  );
};

export default PresetHabitList;
