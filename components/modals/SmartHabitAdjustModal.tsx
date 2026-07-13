import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Check, ArrowRight, Loader, AlertTriangle } from 'lucide-react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import type { HabitPointAdjustmentSuggestion } from '@/services/geminiService.types';
import toast from 'react-hot-toast';

interface SmartHabitAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SmartHabitAdjustModal: React.FC<SmartHabitAdjustModalProps> = ({ isOpen, onClose }) => {
  const { habits, updateHabit } = useGamification();
  const { householdId } = useHouseholdCore();
  const [suggestions, setSuggestions] = useState<HabitPointAdjustmentSuggestion[]>([]);
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
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
    }
  }

  // Analyze habits when modal opens
  useEffect(() => {
    if (isOpen && householdId) {
      const fetchSuggestions = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const { analyzeHabitPoints } = await import('@/services/geminiService');
          const results = await analyzeHabitPoints(householdId, habitsRef.current);
          setSuggestions(results);
        } catch (err) {
          console.error("Failed to analyze habits:", err);
          // Show the actual error message to help with debugging
          const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
          setError(`Failed to generate suggestions: ${errorMessage}`);
        } finally {
          setIsLoading(false);
        }
      };

      fetchSuggestions();
    }
  }, [isOpen, householdId]);

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

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      noPadding
      title="Smart Adjustments"
    >
      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader size={32} className="text-warm-700 dark:text-warm-300 animate-spin mb-4" />
            <p className="text-brand-800 dark:text-brand-100 font-bold">Analyzing your habits...</p>
            <p className="text-sm text-warm-600 dark:text-warm-300 mt-1 max-w-xs">
              Gemini is reviewing your streaks and completion rates to optimize your point system.
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-money-neg dark:text-money-negDark">
            <AlertTriangle size={32} className="mb-3 opacity-50" />
            <p className="font-bold">{error}</p>
            <Button variant="ghost" onClick={onClose} className="mt-4">
              Close
            </Button>
          </div>
        ) : suggestions.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={32} />}
            title="No adjustments needed!"
            description="Your habit point values look balanced based on your current performance. Keep it up!"
          />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-brand-500 dark:text-brand-400 mb-2">
              Found <span className="font-bold text-warm-700 dark:text-warm-300">{suggestions.length}</span> suggestions to improve your system:
            </p>

            {suggestions.map((suggestion) => (
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
                        <span className="text-sm font-bold text-brand-500 dark:text-brand-400">{suggestion.currentPoints}</span>
                        <ArrowRight size={14} className="text-brand-300 dark:text-brand-500" />
                        <span className="text-sm font-bold text-warm-700 dark:text-warm-300">{suggestion.suggestedPoints} pts</span>
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
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {suggestions.length > 0 && !isLoading && (
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
