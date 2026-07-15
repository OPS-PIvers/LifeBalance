import React from 'react';
import { Check, ChefHat } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { SurfaceList } from '@/components/ui/Section';
import EmptyState from '@/components/ui/EmptyState';
import { Habit } from '@/types/schema';
import { cn } from '@/utils/cn';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  habits: Habit[];
  mealCookedHabitId: string | undefined;
  onSelect: (habitId: string | null) => void;
}

/**
 * F-MEALS-04 — links a habit (e.g. "Cooked dinner at home") that gets
 * auto-credited whenever today's meal-plan item is marked cooked. A single
 * radio-style pick list; "None" clears the link.
 */
export const CookHabitPickerDrawer: React.FC<Props> = ({
  isOpen,
  onClose,
  habits,
  mealCookedHabitId,
  onSelect,
}) => {
  const handlePick = (habitId: string | null) => {
    onSelect(habitId);
    onClose();
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Cook-at-home habit">
      <div className="px-4 pb-4 space-y-3">
        <p className="text-sm text-brand-500 dark:text-brand-400">
          Pick a habit to auto-complete when you mark today&apos;s meal as cooked.
        </p>
        {habits.length === 0 ? (
          <EmptyState
            variant="dashed"
            size="compact"
            icon={<ChefHat className="w-7 h-7" />}
            title="No habits yet"
            description="Add a habit first, then link it here."
          />
        ) : (
          <SurfaceList>
            <button
              type="button"
              onClick={() => handlePick(null)}
              aria-pressed={!mealCookedHabitId}
              className={cn(
                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                !mealCookedHabitId ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-brand-50 dark:hover:bg-brand-700/40'
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  !mealCookedHabitId
                    ? 'bg-accent-600 border-accent-600 text-white'
                    : 'border-brand-300 dark:border-brand-500/50 bg-white dark:bg-brand-800'
                )}
              >
                {!mealCookedHabitId && <Check size={12} strokeWidth={3} />}
              </span>
              <span className="text-sm font-medium text-brand-700 dark:text-brand-200">None</span>
            </button>
            {habits.map(habit => {
              const isSelected = habit.id === mealCookedHabitId;
              return (
                <button
                  key={habit.id}
                  type="button"
                  onClick={() => handlePick(habit.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center gap-3 px-4 py-3 text-left hairline-divider transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                    isSelected ? 'bg-accent-50 dark:bg-accent-900/20' : 'hover:bg-brand-50 dark:hover:bg-brand-700/40'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                      isSelected
                        ? 'bg-accent-600 border-accent-600 text-white'
                        : 'border-brand-300 dark:border-brand-500/50 bg-white dark:bg-brand-800'
                    )}
                  >
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="text-sm font-medium text-brand-700 dark:text-brand-200 truncate">
                    {habit.title}
                  </span>
                </button>
              );
            })}
          </SurfaceList>
        )}
      </div>
    </Drawer>
  );
};
