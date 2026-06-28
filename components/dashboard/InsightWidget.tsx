import React from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useInsightActions } from '@/hooks/useInsightActions';
import { Sparkles, History, Wand2, ArrowRight, Wallet, CheckCircle2, Plus, Trophy } from 'lucide-react';
import { CreateChallengePayload, Insight, InsightAction } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';

interface InsightWidgetProps {
  onOpenArchive: () => void;
  onCreateChallenge?: (payload: CreateChallengePayload) => void;
}

/**
 * Plan 090 (graceful degradation): map an action pill to the domain its
 * destination belongs to, so a pill is dropped when that module is off. Returns
 * a flag-checker; `null`-domain actions (none today) would always show.
 */
const isInsightActionVisible = (
  action: InsightAction,
  isModuleEnabled: (key: 'money' | 'habits') => boolean,
  isPlanTabVisible: (tab: 'todos') => boolean,
): boolean => {
  switch (action.type) {
    case 'update_bucket':
      return isModuleEnabled('money');
    case 'create_habit':
    case 'create_challenge':
      return isModuleEnabled('habits');
    case 'create_todo':
      return isPlanTabVisible('todos');
    default:
      return true;
  }
};

export const InsightWidget: React.FC<InsightWidgetProps> = React.memo(({ onOpenArchive, onCreateChallenge }) => {
  const {
    insight,
    refreshInsight,
    isGeneratingInsight,
    insightsHistory,
  } = useHouseholdCore();
  const { isModuleEnabled, isPlanTabVisible } = useModuleVisibility();

  const { handleAction } = useInsightActions();

  const normalizeInsightText = (text: string | null | undefined): string =>
    (text ?? '').replace(/\s+/g, ' ').trim();

  const latestInsight = insightsHistory.length > 0 ? insightsHistory[0] : null;
  // The displayed `insight` is a plain string; we can only attribute a domain to
  // it when it matches the latest history entry (which carries a `type`).
  const isLatestShown =
    !!latestInsight &&
    normalizeInsightText(latestInsight.text) === normalizeInsightText(insight);

  // Hide the widget only when the shown insight is *definitively* domain-scoped
  // to a disabled module. 'general' insights (and the placeholder/unmatched
  // string, which has no type) always show — best-effort, no fragile classifier.
  const insightDomainHidden =
    isLatestShown &&
    ((latestInsight.type === 'spending' && !isModuleEnabled('money')) ||
      (latestInsight.type === 'habits' && !isModuleEnabled('habits')));
  if (insightDomainHidden) return null;

  const insightActions: Insight['actions'] = isLatestShown
    ? (latestInsight.actions ?? []).filter((a) =>
        isInsightActionVisible(a, isModuleEnabled, isPlanTabVisible),
      )
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
    <div className="surface-section p-5">
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-card bg-warm-100 text-warm-600 dark:bg-warm-900/40 dark:text-warm-300 shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-warm-600 dark:text-warm-300">AI Insight</h3>
            <div className="flex gap-2">
              <button
                onClick={onOpenArchive}
                className="flex items-center gap-1.5 px-3 min-h-11 bg-white dark:bg-brand-700/50 text-brand-600 dark:text-brand-200 border border-brand-200 dark:border-brand-700 rounded-btn text-xs font-semibold active:scale-95 transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) hover:bg-brand-50 dark:hover:bg-brand-700"
              >
                <History size={12} />
                History
              </button>
              <button
                onClick={refreshInsight}
                disabled={isGeneratingInsight}
                className="flex items-center gap-1.5 px-3 min-h-11 bg-accent-600 hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-400 text-white rounded-btn text-xs font-semibold shadow-btn-primary active:scale-95 transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard) disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                <Wand2 size={12} />
                {isGeneratingInsight ? 'Generating…' : 'Get Insight'}
              </button>
            </div>
          </div>
          {isGeneratingInsight ? (
            <div className="mb-1 space-y-2" aria-live="polite" aria-busy="true">
              <span className="sr-only">Generating insight…</span>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : (
            <p className="font-display text-brand-800 dark:text-brand-100 leading-relaxed mb-3">
              &ldquo;{insight}&rdquo;
            </p>
          )}

          {/* Action Pills */}
          {!isGeneratingInsight && insightActions && insightActions.length > 0 && (
            <div className="flex flex-wrap gap-2 animate-in fade-in slide-in-from-top-2 duration-(--duration-base)">
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
                  className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-accent-50 text-accent-700 border border-brand-200 dark:bg-brand-700/50 dark:hover:bg-brand-700 dark:text-accent-200 dark:border-brand-700 rounded-btn text-xs font-semibold active:scale-95 transition-[transform,colors] duration-(--duration-fast) ease-(--ease-standard)"
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
});

InsightWidget.displayName = 'InsightWidget';
