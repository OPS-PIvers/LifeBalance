import React from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useInsightActions } from '@/hooks/useInsightActions';
import { Sparkles, History, Wand2, ArrowRight, Wallet, CheckCircle2, Plus, Trophy } from 'lucide-react';
import { CreateChallengePayload } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';

interface InsightWidgetProps {
  onOpenArchive: () => void;
  onCreateChallenge?: (payload: CreateChallengePayload) => void;
}

export const InsightWidget: React.FC<InsightWidgetProps> = ({ onOpenArchive, onCreateChallenge }) => {
  const {
    insight,
    refreshInsight,
    isGeneratingInsight,
    insightsHistory,
  } = useHouseholdCore();

  const { handleAction } = useInsightActions();

  const normalizeInsightText = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim();

  // Get actions from the latest insight if it matches the current display text
  const latestInsight = insightsHistory.length > 0 ? insightsHistory[0] : null;
  const insightActions =
    latestInsight && normalizeInsightText(latestInsight.text) === normalizeInsightText(insight)
      ? latestInsight.actions
      : [];

  const getActionIcon = (type: string) => {
    switch (type) {
      case 'update_bucket': return <Wallet size={14} />;
      case 'create_habit': return <Plus size={14} />;
      case 'create_todo': return <CheckCircle2 size={14} />;
      case 'create_challenge': return <Trophy size={14} />;
      default: return <ArrowRight size={14} />;
    }
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50/80 to-white/80 dark:from-indigo-500/10 dark:to-slate-800/60 backdrop-blur-md border border-indigo-100/50 dark:border-indigo-500/20 shadow-sm rounded-3xl p-6">
      <div className="flex items-start gap-4">
        <div className="p-2.5 bg-white/80 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl shadow-sm text-indigo-500 dark:text-indigo-300 ring-1 ring-indigo-100 dark:ring-indigo-500/20">
          <Sparkles size={20} />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-indigo-400 dark:text-indigo-300 uppercase tracking-wider">AI Insight</h3>
            <div className="flex gap-2">
              <button
                onClick={onOpenArchive}
                className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-300 rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-indigo-50 dark:hover:bg-slate-700"
              >
                <History size={12} />
                History
              </button>
              <button
                onClick={refreshInsight}
                disabled={isGeneratingInsight}
                className="flex items-center gap-1.5 px-3 py-1 bg-indigo-500 text-white rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Wand2 size={12} />
                {isGeneratingInsight ? 'Generating...' : 'Get Insight'}
              </button>
            </div>
          </div>
          {isGeneratingInsight ? (
            // "Generating" shimmer so a live AI call feels live.
            <div className="mb-3 space-y-2" aria-live="polite" aria-busy="true">
              <span className="sr-only">Generating insight…</span>
              <Skeleton className="h-4 w-full bg-indigo-200/60 dark:bg-indigo-500/20" />
              <Skeleton className="h-4 w-11/12 bg-indigo-200/60 dark:bg-indigo-500/20" />
              <Skeleton className="h-4 w-2/3 bg-indigo-200/60 dark:bg-indigo-500/20" />
            </div>
          ) : (
            <p className="text-indigo-900 dark:text-indigo-100 font-medium leading-relaxed mb-3">
              &quot;{insight}&quot;
            </p>
          )}

          {/* Action Pills */}
          {!isGeneratingInsight && insightActions && insightActions.length > 0 && (
            <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2">
              {insightActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    if (action.type === 'create_challenge' && onCreateChallenge) {
                      onCreateChallenge(action.payload);
                    } else {
                      handleAction(action);
                    }
                  }}
                  className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-indigo-100 text-indigo-700 border border-indigo-100 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-indigo-300 dark:border-indigo-500/20 rounded-lg text-xs font-bold shadow-sm active:scale-95 transition-all"
                >
                  {getActionIcon(action.type)}
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
