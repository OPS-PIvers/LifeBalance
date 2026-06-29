import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Sparkles, Check, Loader, AlertTriangle, ArrowRight } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import type { HabitReorganizationPlan } from '@/services/geminiService.types';
import { Habit } from '@/types/schema';

interface SmartHabitReorderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SmartHabitReorderModal: React.FC<SmartHabitReorderModalProps> = ({ isOpen, onClose }) => {
  const { habits, reorderHabits } = useGamification();
  const { householdId } = useHouseholdCore();
  const [plan, setPlan] = useState<HabitReorganizationPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest habits in a ref so the open-effect can read the current
  // value at fetch time without re-running every time `habits` changes.
  // Written in an effect (not during render) per the latest-ref pattern.
  const habitsRef = useRef(habits);
  useEffect(() => {
    habitsRef.current = habits;
  });

  // Reset state when analysis is no longer active (modal closed or no household).
  // Done during render on the active→inactive edge rather than in an effect so
  // it doesn't trigger a cascading render. Mirrors the previous effect's `else`
  // branch, which cleared these whenever `isOpen && householdId` was false.
  const isActive = isOpen && !!householdId;
  const [wasActive, setWasActive] = useState(isActive);
  if (wasActive !== isActive) {
    setWasActive(isActive);
    if (!isActive) {
      setPlan(null);
      setIsLoading(false);
      setError(null);
    }
  }

  // Analyze habits when modal opens
  useEffect(() => {
    if (isOpen && householdId) {
      const fetchPlan = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const { reorganizeHabits } = await import('@/services/geminiService');
          const result = await reorganizeHabits(householdId, habitsRef.current);
          setPlan(result);
        } catch (err) {
          console.error("Failed to reorganize habits:", err);
          const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
          setError(`Failed to generate plan: ${errorMessage}`);
        } finally {
          setIsLoading(false);
        }
      };

      fetchPlan();
    }
  }, [isOpen, householdId]);

  const handleApply = async () => {
    if (!plan) return;

    try {
      await reorderHabits(plan.habits);
      onClose();
    } catch (err) {
      console.error("Failed to apply changes:", err);
      // Toast is handled in context
    }
  };

  // Preview Data Logic
  const previewHabits = useMemo(() => {
    if (!plan) return null;

    // Create a map of updates
    const updates = new Map(plan.habits.map(h => [h.id, h]));

    // Merge updates into current habits
    const merged = habits.map(h => {
      const update = updates.get(h.id);
      return {
        ...h,
        category: update ? update.category : h.category,
        order: update ? update.order : (h.order ?? 999)
      };
    });

    // Sort by order
    merged.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));

    // Group by category
    const categories = Array.from(new Set(merged.map(h => h.category)));
    const grouped = categories.reduce((acc, category) => {
      acc[category] = merged.filter(h => h.category === category);
      return acc;
    }, {} as Record<string, Habit[]>);

    return { categories, grouped };
  }, [habits, plan]);

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      title="Smart Reorder"
    >
      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader size={32} className="text-warm-700 dark:text-warm-300 animate-spin mb-4" />
            <p className="text-brand-800 dark:text-brand-100 font-bold">Analyzing your routine...</p>
            <p className="text-sm text-warm-600 dark:text-warm-300 mt-1 max-w-xs">
              Gemini is finding the best flow for your day.
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-money-neg">
            <AlertTriangle size={32} className="mb-3 opacity-50" />
            <p className="font-bold">{error}</p>
            <Button variant="ghost" onClick={onClose} className="mt-4">
              Close
            </Button>
          </div>
        ) : plan && previewHabits ? (
          <div className="space-y-6">
            <div className="bg-warm-50 dark:bg-warm-900/20 border border-warm-200 dark:border-warm-800/60 p-4 rounded-xl">
               <div className="flex items-start gap-3">
                 <Sparkles size={20} className="text-warm-600 dark:text-warm-300 shrink-0 mt-0.5" />
                 <div>
                   <h3 className="font-bold text-brand-800 dark:text-brand-100 text-sm">Proposed Plan</h3>
                   <p className="text-sm text-brand-700 dark:text-brand-300 mt-1">{plan.reasoning}</p>
                 </div>
               </div>
            </div>

            <div className="space-y-4">
              {previewHabits.categories.map(category => (
                <div key={category} className="space-y-2">
                  <h3 className="text-xs font-bold text-brand-400 dark:text-brand-500 uppercase tracking-wider ml-2">{category}</h3>
                  <div className="bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-xl overflow-hidden divide-y divide-brand-200">
                    {(previewHabits.grouped[category] ?? []).map(habit => (
                      <div key={habit.id} className="p-3 flex items-center justify-between hover:bg-brand-50 dark:hover:bg-brand-700/50 transition-colors">
                        <div className="flex items-center gap-3">
                           {/* Old category indicator if changed? maybe too cluttered */}
                           <span className="font-medium text-brand-700 dark:text-brand-200 text-sm">{habit.title}</span>
                        </div>
                        {/* Show if category changed */}
                        {(() => {
                            const original = habits.find(h => h.id === habit.id);
                            if (original && original.category !== habit.category) {
                                return (
                                    <div className="flex items-center gap-1.5 text-xs bg-warm-50 dark:bg-warm-900/30 text-warm-700 dark:text-warm-300 px-2 py-1 rounded-full border border-warm-200 dark:border-warm-800/60">
                                        <span className="opacity-75 line-through">{original.category}</span>
                                        <ArrowRight size={10} />
                                        <span className="font-bold">{habit.category}</span>
                                    </div>
                                )
                            }
                            return null;
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      {plan && !isLoading && (
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-700/50 flex gap-3">
          <Button variant="ghost" size="lg" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="warning"
            size="lg"
            onClick={handleApply}
            leftIcon={<Check size={18} />}
            className="flex-1"
          >
            Apply Changes
          </Button>
        </div>
      )}
    </Drawer>
  );
};

export default SmartHabitReorderModal;
