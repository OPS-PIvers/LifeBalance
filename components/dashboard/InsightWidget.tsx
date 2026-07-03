import React from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useInsightActions } from '@/hooks/useInsightActions';
import { Sparkles, Wand2, ArrowRight, Wallet, CheckCircle2, Plus, Trophy } from 'lucide-react';
import { CreateChallengePayload, Insight, InsightAction } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';

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
            <Eyebrow as="h3" tone="warm">AI Insight</Eyebrow>
            <div className="flex items-center gap-3">
              {/* Demoted to a quiet text link so "Get Insight" is the sole
                  primary header action; min-h-11 preserves the tap target. */}
              <Button
                variant="link"
                size="sm"
                className="min-h-11 text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200"
                onClick={onOpenArchive}
              >
                History
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="min-h-11"
                onClick={refreshInsight}
                disabled={isGeneratingInsight}
                leftIcon={<Wand2 size={12} />}
              >
                {isGeneratingInsight ? 'Generating…' : 'Get Insight'}
              </Button>
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
                <Button
                  key={idx}
                  variant="secondary"
                  size="sm"
                  className="py-2 text-accent-700 hover:text-accent-700 hover:bg-accent-50 dark:text-accent-200 dark:hover:text-accent-200 dark:hover:bg-brand-700"
                  onClick={() => {
                    if (action.type === 'create_challenge' && onCreateChallenge) {
                      onCreateChallenge(action.payload);
                    } else {
                      handleAction(action);
                    }
                  }}
                  leftIcon={getActionIcon(action.type)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

InsightWidget.displayName = 'InsightWidget';
