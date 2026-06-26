import React, { useEffect, useId, useRef, useState, useMemo } from 'react';
import { Sparkles, X, Check, Loader, AlertTriangle, ListOrdered, ArrowRight } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Modal } from '@/components/ui/Modal';
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
  const titleId = useId();
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-2xl"
      ariaLabelledBy={titleId}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-warm-200 dark:border-warm-800/60 bg-warm-50 dark:bg-warm-900/20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white dark:bg-brand-800 rounded-xl text-warm-700 dark:text-warm-300 border border-warm-200 dark:border-warm-800/60">
            <ListOrdered size={20} />
          </div>
          <div>
            <h2 id={titleId} className="font-display text-lg font-semibold text-brand-800 dark:text-brand-100">Smart Reorder</h2>
            <p className="text-xs text-warm-700 dark:text-warm-300 font-medium">AI-powered organization</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-warm-500 dark:text-warm-300 hover:bg-white/60 dark:hover:bg-brand-700/50 hover:text-warm-700 dark:hover:text-warm-300"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={20} />
        </Button>
      </div>

      {/* Content */}
      <div className="p-6 scroll-contain-y max-h-[70vh]">
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
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-brand-100 dark:bg-brand-700/50 text-brand-600 dark:text-brand-300 rounded-lg text-sm font-bold hover:bg-brand-200 dark:hover:bg-brand-700"
            >
              Close
            </button>
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
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-700/50 rounded-b-card flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-brand-500 dark:text-brand-400 font-bold text-sm hover:bg-brand-100 dark:hover:bg-brand-700/50 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-3 bg-warm-500 text-white font-semibold text-sm rounded-btn hover:bg-warm-600 shadow-btn-primary active:scale-[0.98] transition-all duration-(--duration-fast) ease-(--ease-standard) flex items-center justify-center gap-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40"
          >
            <Check size={18} />
            Apply Changes
          </button>
        </div>
      )}
    </Modal>
  );
};

export default SmartHabitReorderModal;
