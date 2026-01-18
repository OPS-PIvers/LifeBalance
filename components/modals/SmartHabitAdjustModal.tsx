import React, { useEffect, useState } from 'react';
import { Sparkles, X, Check, ArrowRight, Loader, AlertTriangle } from 'lucide-react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { Modal } from '../ui/Modal';
import { analyzeHabitPoints, HabitPointAdjustmentSuggestion } from '@/services/geminiService';
import toast from 'react-hot-toast';

interface SmartHabitAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SmartHabitAdjustModal: React.FC<SmartHabitAdjustModalProps> = ({ isOpen, onClose }) => {
  const { habits, updateHabit } = useHousehold();
  const [suggestions, setSuggestions] = useState<HabitPointAdjustmentSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analyze habits when modal opens
  useEffect(() => {
    if (isOpen) {
      const fetchSuggestions = async () => {
        setIsLoading(true);
        setError(null);
        try {
          const results = await analyzeHabitPoints(habits);
          setSuggestions(results);
        } catch (err) {
          console.error("Failed to analyze habits:", err);
          setError("Failed to generate suggestions. Please try again later.");
        } finally {
          setIsLoading(false);
        }
      };

      fetchSuggestions();
    } else {
      // Reset state when closed
      setSuggestions([]);
      setIsLoading(false);
      setError(null);
    }
    // Intentionally omitting habits from dependency array to avoid loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-purple-100 bg-purple-50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white rounded-xl text-purple-600 shadow-sm">
            <Sparkles size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-purple-900">Smart Adjustments</h2>
            <p className="text-xs text-purple-600 font-medium">AI-powered optimization for your habits</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 text-purple-400 hover:bg-white/50 rounded-full transition-colors"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="p-6 overflow-y-auto max-h-[70vh]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Loader size={32} className="text-purple-600 animate-spin mb-4" />
            <p className="text-purple-900 font-bold">Analyzing your habits...</p>
            <p className="text-sm text-purple-500 mt-1 max-w-xs">
              Gemini is reviewing your streaks and completion rates to optimize your point system.
            </p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-red-500">
            <AlertTriangle size={32} className="mb-3 opacity-50" />
            <p className="font-bold">{error}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-200"
            >
              Close
            </button>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400">
            <Sparkles size={32} className="mb-3 opacity-30" />
            <p className="font-bold text-slate-600">No adjustments needed!</p>
            <p className="text-sm mt-1 max-w-xs">
              Your habit point values look balanced based on your current performance. Keep it up!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 mb-2">
              Found <span className="font-bold text-purple-600">{suggestions.length}</span> suggestions to improve your system:
            </p>

            {suggestions.map((suggestion) => (
              <div
                key={suggestion.habitId}
                className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm hover:shadow-md transition-shadow animate-in slide-in-from-bottom-2 fade-in duration-300"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">

                  {/* Info */}
                  <div className="flex-1">
                    <div className="flex items-center justify-between sm:justify-start sm:gap-4 mb-2">
                      <h3 className="font-bold text-slate-800 text-lg">{suggestion.habitTitle}</h3>
                      <div className="flex items-center gap-2 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
                        <span className="text-sm font-bold text-slate-500">{suggestion.currentPoints}</span>
                        <ArrowRight size={14} className="text-slate-300" />
                        <span className="text-sm font-bold text-purple-600">{suggestion.suggestedPoints} pts</span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100">
                      <Sparkles size={12} className="inline mr-1.5 text-purple-500 -mt-0.5" />
                      {suggestion.reasoning}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 sm:flex-col shrink-0">
                    <button
                      onClick={() => handleAccept(suggestion)}
                      className="flex-1 sm:w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl font-bold shadow-sm hover:bg-purple-700 active:scale-95 transition-all"
                      title="Accept Change"
                    >
                      <Check size={18} />
                      <span className="sm:hidden">Accept</span>
                    </button>
                    <button
                      onClick={() => handleIgnore(suggestion.habitId)}
                      className="flex-1 sm:w-full flex items-center justify-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded-xl font-bold hover:bg-slate-200 active:scale-95 transition-all"
                      title="Ignore"
                    >
                      <X size={18} />
                      <span className="sm:hidden">Ignore</span>
                    </button>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {suggestions.length > 0 && !isLoading && (
        <div className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-3xl">
          <button
            onClick={onClose}
            className="w-full py-3 text-slate-500 font-bold text-sm hover:text-slate-700 transition-colors"
          >
            Done Reviewing
          </button>
        </div>
      )}
    </Modal>
  );
};

export default SmartHabitAdjustModal;
