import React, { useState } from 'react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import type { HabitPatternInsight } from '@/services/geminiService.types';
import { Sparkles, Trophy, TrendingUp, AlertCircle, RefreshCw, Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';
import EmptyState from '@/components/ui/EmptyState';

export const HabitCoach: React.FC = () => {
  const { habits } = useGamification();
  const { householdId } = useHouseholdCore();
  const [insights, setInsights] = useState<HabitPatternInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const handleAnalyze = async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      const { analyzeHabitPatterns } = await import('@/services/geminiService');
      const results = await analyzeHabitPatterns(householdId, habits);
      setInsights(results);
      setHasRun(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to analyze patterns");
    } finally {
      setLoading(false);
    }
  };

  if (habits.length === 0) {
    return (
      <EmptyState
        icon={<Trophy size={32} />}
        title="No Habits Yet"
        description="Start tracking some habits to unlock coaching insights!"
      />
    );
  }

  return (
    <div className="space-y-6">
      {!hasRun ? (
        // Hero CTA — solid evergreen surface (the one elevated moment in Coach),
        // warm-amber call-to-action button. No gradient, no glass.
        <div className="bg-accent-600 dark:bg-accent-800 rounded-lg p-6 text-white text-center shadow-raised border border-accent-700 dark:border-accent-700">
          <div className="w-16 h-16 bg-white/10 rounded-card flex items-center justify-center mx-auto mb-4">
            <Sparkles size={32} className="text-warm-200" />
          </div>
          <h2 className="font-display text-xl font-semibold mb-2">Unlock Your Habit Potential</h2>
          <p className="text-accent-100 text-sm mb-6 max-w-xs mx-auto leading-relaxed">
            Let our AI coach analyze your streaks, find hidden patterns, and suggest ways to level up.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-6 py-3 bg-warm-500 text-white font-bold rounded-btn shadow-btn-primary hover:bg-warm-600 active:scale-95 transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 mx-auto focus:outline-hidden focus-visible:ring-2 focus-visible:ring-white/50"
          >
            {loading ? <RefreshCw size={20} className="animate-spin" /> : <Sparkles size={20} />}
            {loading ? "Analyzing..." : "Analyze My Habits"}
          </button>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-(--duration-base)">
          <div className="flex justify-between items-center px-1">
            <h3 className="font-display text-sm font-semibold text-brand-700 dark:text-brand-200">Coach insights</h3>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="text-xs font-bold text-brand-600 dark:text-brand-300 flex items-center gap-1 hover:bg-brand-100 dark:hover:bg-brand-700/50 px-2 py-1 rounded-btn transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="grid gap-3">
            {insights.map((insight, idx) => (
              <div key={idx} className="surface-section p-5 flex gap-4">
                <div className={`p-3 rounded-card h-fit shrink-0 ${
                  insight.type === 'praise' ? 'bg-warm-100 text-warm-600 dark:bg-warm-900/30 dark:text-warm-200' :
                  insight.type === 'critique' ? 'bg-money-bgNeg text-money-neg dark:bg-money-neg/15 dark:text-money-negDark' :
                  'bg-habit-blue/10 text-habit-blue dark:bg-habit-blue/15 dark:text-habit-blue'
                }`}>
                  {insight.type === 'praise' ? <Trophy size={20} /> :
                   insight.type === 'critique' ? <AlertCircle size={20} /> :
                   <Lightbulb size={20} />}
                </div>
                <div>
                  <h4 className="font-semibold text-brand-900 dark:text-brand-50 mb-1">{insight.title}</h4>
                  <p className="text-sm text-brand-500 dark:text-brand-400 leading-relaxed">{insight.description}</p>
                  {insight.relatedHabitId && (
                     <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-brand-100 dark:bg-brand-700/50 rounded-btn text-xs font-medium text-brand-500 dark:text-brand-400">
                        <TrendingUp size={12} />
                        Related Habit
                     </div>
                  )}
                </div>
              </div>
            ))}

            {insights.length === 0 && !loading && (
                <div className="text-center p-8 bg-brand-50 dark:bg-brand-800 rounded-2xl border border-dashed border-brand-200 dark:border-brand-700">
                    <p className="text-brand-400 dark:text-brand-400 font-medium">No clear patterns found yet. Keep tracking!</p>
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
