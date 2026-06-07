import React, { useState } from 'react';
import { useHousehold } from '@/contexts/FirebaseHouseholdContext';
import { HabitPatternInsight } from '@/services/geminiService';
import { Sparkles, Trophy, TrendingUp, AlertCircle, RefreshCw, Lightbulb } from 'lucide-react';
import toast from 'react-hot-toast';

export const HabitCoach: React.FC = () => {
  const { habits, householdId } = useHousehold();
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
      <div className="text-center py-12 px-4">
        <div className="w-16 h-16 bg-brand-100 dark:bg-slate-700/50 text-brand-400 dark:text-slate-500 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trophy size={32} />
        </div>
        <h3 className="text-lg font-bold text-brand-800 dark:text-slate-100 mb-2">No Habits Yet</h3>
        <p className="text-brand-400 dark:text-slate-400 text-sm">Start tracking some habits to unlock coaching insights!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!hasRun ? (
        <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-6 text-white text-center shadow-lg">
          <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles size={32} className="text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">Unlock Your Habit Potential</h2>
          <p className="text-white/80 text-sm mb-6 max-w-xs mx-auto">
            Let our AI coach analyze your streaks, find hidden patterns, and suggest ways to level up.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="px-6 py-3 bg-white text-indigo-600 font-bold rounded-xl shadow-lg active:scale-95 transition-all disabled:opacity-70 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
          >
            {loading ? <RefreshCw size={20} className="animate-spin" /> : <Sparkles size={20} />}
            {loading ? "Analyzing..." : "Analyze My Habits"}
          </button>
        </div>
      ) : (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex justify-between items-center px-2">
            <h3 className="text-sm font-bold text-brand-500 dark:text-slate-400 uppercase tracking-wider">Coach Insights</h3>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="text-xs font-bold text-brand-600 dark:text-slate-300 flex items-center gap-1 hover:bg-brand-100 dark:hover:bg-slate-700/50 px-2 py-1 rounded-lg transition-colors"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>

          <div className="grid gap-4">
            {insights.map((insight, idx) => (
              <div key={idx} className="bg-white dark:bg-slate-800 p-5 rounded-2xl shadow-sm border border-brand-100 dark:border-slate-700 flex gap-4">
                <div className={`p-3 rounded-xl h-fit shrink-0 ${
                  insight.type === 'praise' ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300' :
                  insight.type === 'critique' ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' :
                  'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300'
                }`}>
                  {insight.type === 'praise' ? <Trophy size={20} /> :
                   insight.type === 'critique' ? <AlertCircle size={20} /> :
                   <Lightbulb size={20} />}
                </div>
                <div>
                  <h4 className="font-bold text-brand-800 dark:text-slate-100 mb-1">{insight.title}</h4>
                  <p className="text-sm text-brand-500 dark:text-slate-400 leading-relaxed">{insight.description}</p>
                  {insight.relatedHabitId && (
                     <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-brand-50 dark:bg-slate-700/50 rounded-lg text-xs font-medium text-brand-400 dark:text-slate-400">
                        <TrendingUp size={12} />
                        Related Habit
                     </div>
                  )}
                </div>
              </div>
            ))}

            {insights.length === 0 && !loading && (
                <div className="text-center p-8 bg-brand-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-brand-200 dark:border-slate-700">
                    <p className="text-brand-400 dark:text-slate-400 font-medium">No clear patterns found yet. Keep tracking!</p>
                </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
