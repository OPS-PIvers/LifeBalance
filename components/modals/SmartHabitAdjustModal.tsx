import React, { useState } from 'react';
import { Sparkles, X, Check, ArrowRight } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import type { HabitPointAdjustmentSuggestion } from '@/services/geminiService.types';
import { generatePointRebalanceSuggestions, rebalanceDisplay } from '@/utils/pointRebalance';
import toast from 'react-hot-toast';

interface SmartHabitAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * SmartHabitAdjustModal — the Habits page surface for point rebalancing, the
 * sibling of the Dashboard's `PointRebalanceCard`.
 *
 * Suggestions come from `generatePointRebalanceSuggestions()`
 * (`utils/pointRebalance.ts`): a pure, synchronous calculation over the habits
 * already in memory. No AI call, no quota, and therefore no loading or failure
 * state to model — an empty result is the normal outcome and renders the
 * "nothing to change" empty state.
 */
const SmartHabitAdjustModal: React.FC<SmartHabitAdjustModalProps> = ({ isOpen, onClose }) => {
  const { habits, updateHabit } = useGamification();
  const { householdId } = useHouseholdCore();
  const [suggestions, setSuggestions] = useState<HabitPointAdjustmentSuggestion[]>([]);

  // Snapshot the calculation on the inactive→active edge (and clear it on the
  // way back) rather than deriving it every render, so accepting or ignoring a
  // suggestion can drop it from the list without the next render recomputing
  // it straight back in. Done during render, not in an effect, so it doesn't
  // cost a cascading render.
  const isActive = isOpen && !!householdId;
  const [wasActive, setWasActive] = useState(false);
  if (wasActive !== isActive) {
    setWasActive(isActive);
    setSuggestions(isActive ? generatePointRebalanceSuggestions(habits) : []);
  }

  const handleAccept = async (suggestion: HabitPointAdjustmentSuggestion) => {
    const habit = habits.find(h => h.id === suggestion.habitId);
    if (!habit) {
      toast.error("Habit not found");
      // Remove from list if not found to prevent repeated errors
      setSuggestions(prev => prev.filter(s => s.habitId !== suggestion.habitId));
      return;
    }

    try {
      await updateHabit({
        ...habit,
        basePoints: suggestion.suggestedPoints
      });
      toast.success(`Updated "${habit.title}" points`);

      // Remove from list
      setSuggestions(prev => prev.filter(s => s.habitId !== suggestion.habitId));
    } catch (err) {
      console.error("Failed to update habit:", err);
      toast.error("Failed to apply update");
    }
  };

  const handleIgnore = (habitId: string) => {
    setSuggestions(prev => prev.filter(s => s.habitId !== habitId));
  };

  const habitById = new Map(habits.map(h => [h.id, h]));

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      title="Smart Adjustments"
    >
      {/* Content */}
      <div className="p-6">
        {suggestions.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={32} />}
            title="No adjustments needed!"
            description="Your habit point values look balanced against how often you're actually completing them. Keep it up!"
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-brand-500 dark:text-brand-400 mb-2">
              Found <span className="font-bold text-warm-700 dark:text-warm-300">{suggestions.length}</span> suggestions to improve your system:
            </p>

            {suggestions.map((suggestion) => {
              // See `rebalanceDisplay` — re-derives canonical signed display
              // values from `habit.type` rather than the raw (convention-
              // dependent) stored sign, so a penalty habit reads
              // unambiguously (e.g. "-8 pts", never a bare "8") and colours
              // identically under either basePoints storage convention. Fall
              // back to a positive habit's identity sign in the (untested-
              // reachable) case the habit has already left the list.
              const habit = habitById.get(suggestion.habitId) ?? { type: 'positive' as const };
              const {
                currentPoints: canonicalCurrent,
                suggestedPoints: canonicalSuggested,
                favorable: increasing,
              } = rebalanceDisplay(habit, suggestion);

              return (
                <div
                  key={suggestion.habitId}
                  className="bg-white dark:bg-brand-800 border border-brand-200 dark:border-brand-700 rounded-2xl p-4 transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700/40 animate-in slide-in-from-bottom-2 fade-in"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

                    {/* Info */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between sm:justify-start sm:gap-4 mb-2">
                        <h3 className="font-bold text-brand-800 dark:text-brand-100 text-lg">{suggestion.habitTitle}</h3>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold text-brand-500 dark:text-brand-400">{canonicalCurrent} pts</span>
                          <ArrowRight size={14} className="text-brand-300 dark:text-brand-500" />
                          <span
                            className={
                              increasing
                                ? 'text-sm font-bold text-money-pos dark:text-money-posDark'
                                : 'text-sm font-bold text-money-neg dark:text-money-negDark'
                            }
                          >
                            {canonicalSuggested} pts
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed italic">
                        <Sparkles size={12} className="inline mr-1.5 text-warm-600 dark:text-warm-300 -mt-0.5 not-italic" />
                        {suggestion.reasoning}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 sm:flex-col shrink-0">
                      <Button
                        variant="warning"
                        onClick={() => handleAccept(suggestion)}
                        leftIcon={<Check size={18} />}
                        className="flex-1 sm:w-full"
                        title="Accept Change"
                      >
                        <span className="sm:hidden">Accept</span>
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleIgnore(suggestion.habitId)}
                        leftIcon={<X size={18} />}
                        className="flex-1 sm:w-full"
                        title="Ignore"
                      >
                        <span className="sm:hidden">Ignore</span>
                      </Button>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {suggestions.length > 0 && (
        <div className="p-4 border-t border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-700/50">
          <Button variant="ghost" size="lg" onClick={onClose} className="w-full">
            Done Reviewing
          </Button>
        </div>
      )}
    </Drawer>
  );
};

export default SmartHabitAdjustModal;
