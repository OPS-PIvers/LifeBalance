import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Sparkles, X, Check, Loader, AlertTriangle, ListOrdered, ArrowRight } from 'lucide-react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { reorganizeHabits, HabitReorganizationPlan } from '@/services/geminiService';
import { Habit } from '@/types/schema';

interface SmartHabitReorderModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SmartHabitReorderModal: React.FC<SmartHabitReorderModalProps> = ({ isOpen, onClose }) => {
  const { habits, reorderHabits, householdId } = useHousehold();
  const [plan, setPlan] = useState<HabitReorganizationPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest habits in a ref so the open-effect can read the current
  // value at fetch time without re-running every time `habits` changes.
  const habitsRef = useRef(habits);
  habitsRef.current = habits;

  // Analyze habits when modal opens
  useEffect(() => {
    if (isOpen && householdId) {
      const fetchPlan = async () => {
        setIsLoading(true);
        setError(null);
        try {
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
    } else {
      setPlan(null);
      setIsLoading(false);
      setError(null);
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
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-indigo-100 dark:border-indigo-500/30 bg-indigo-50 dark:bg-indigo-500/15 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white dark:bg-slate-800 rounded-xl text-indigo-600 dark:text-indigo-300 shadow-sm">
            <ListOrdered size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-indigo-900 dark:text-indigo-200">Smart Reorder</h2>
            <p className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">AI-powered organization</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full text-indigo-400 dark:text-indigo-300 hover:bg-white/50 dark:hover:bg-slate-700/50 hover:text-indigo-600 dark:hover:text-indigo-300"
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
            <Loader size={32} className="text-indigo-600 dark:text-indigo-300 animate-spin mb-4" />
            <p className="text-indigo-900 dark:text-indigo-200 font-bold">Analyzing your routine...</p>
            <p className="text-sm text-indigo-500 dark:text-indigo-300 mt-1 max-w-xs">
              Gemini is finding the best flow for your day.
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-red-500 dark:text-red-400">
            <AlertTriangle size={32} className="mb-3 opacity-50" />
            <p className="font-bold">{error}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-slate-100 dark:bg-slate-700/50 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        ) : plan && previewHabits ? (
          <div className="space-y-6">
            <div className="bg-indigo-50 dark:bg-indigo-500/15 border border-indigo-100 dark:border-indigo-500/30 p-4 rounded-xl">
               <div className="flex items-start gap-3">
                 <Sparkles size={20} className="text-indigo-500 dark:text-indigo-300 shrink-0 mt-0.5" />
                 <div>
                   <h3 className="font-bold text-indigo-900 dark:text-indigo-200 text-sm">Proposed Plan</h3>
                   <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1">{plan.reasoning}</p>
                 </div>
               </div>
            </div>

            <div className="space-y-4">
              {previewHabits.categories.map(category => (
                <div key={category} className="space-y-2">
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider ml-2">{category}</h3>
                  <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl overflow-hidden divide-y divide-slate-50">
                    {(previewHabits.grouped[category] ?? []).map(habit => (
                      <div key={habit.id} className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                        <div className="flex items-center gap-3">
                           {/* Old category indicator if changed? maybe too cluttered */}
                           <span className="font-medium text-slate-700 dark:text-slate-200 text-sm">{habit.title}</span>
                        </div>
                        {/* Show if category changed */}
                        {(() => {
                            const original = habits.find(h => h.id === habit.id);
                            if (original && original.category !== habit.category) {
                                return (
                                    <div className="flex items-center gap-1.5 text-xs bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-300 px-2 py-1 rounded-full border border-orange-100 dark:border-orange-500/30">
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
        <div className="p-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/50 rounded-b-3xl flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-slate-500 dark:text-slate-400 font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-3 bg-indigo-600 text-white font-bold text-sm rounded-xl hover:bg-indigo-700 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2"
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
