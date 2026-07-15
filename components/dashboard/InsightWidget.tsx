import React from 'react';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useInsightActions } from '@/hooks/useInsightActions';
import { Sparkles, Wand2, ArrowRight, Wallet, CheckCircle2, Plus, Trophy, ThumbsUp, ThumbsDown } from 'lucide-react';
import { CreateChallengePayload, Insight, InsightAction } from '@/types/schema';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import Eyebrow from '@/components/ui/Eyebrow';
import { Section } from '@/components/ui/Section';

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
    rateInsight,
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
    <Section
      title={<Eyebrow as="span" tone="warm">AI Insight</Eyebrow>}
      action={
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
      }
    >
      {/* A hairline-edged BAND on the canvas — mirrors PulseStripWidget's
          "distinct but not boxed" treatment (border-y, no side border, no
          rounded panel, no background) instead of a full `surface-section`.
          The warm icon chip + "AI Insight" eyebrow above already anchor this
          as the AI insight, so the band is enough to keep it from blending
          into the surrounding canvas without adding another bordered card. */}
      <div className="flex items-start gap-4 border-y border-brand-200 dark:border-brand-700 px-1 py-4">
        <div className="p-2.5 rounded-card bg-warm-100 text-warm-600 dark:bg-warm-900/40 dark:text-warm-300 shrink-0">
          <Sparkles size={20} />
        </div>
        <div className="flex-1 min-w-0">
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

          {/* F-DASH-11: thumbs up/down on the currently-shown insight. Only
              rateable when it's the latest history entry (we need its doc id);
              the placeholder/legacy string insight has no id to attach to. */}
          {!isGeneratingInsight && isLatestShown && (
            <div className="flex items-center gap-1 mb-3 -ml-1.5" role="group" aria-label="Rate this insight">
              <Button
                variant="ghost"
                size="icon"
                className={
                  latestInsight.feedback === 'up'
                    ? 'text-accent-600 dark:text-accent-400'
                    : 'text-brand-400 hover:text-accent-600 dark:text-brand-500 dark:hover:text-accent-400'
                }
                onClick={() => rateInsight(latestInsight.id, 'up')}
                aria-label="This insight was helpful"
                aria-pressed={latestInsight.feedback === 'up'}
              >
                <ThumbsUp size={15} fill={latestInsight.feedback === 'up' ? 'currentColor' : 'none'} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={
                  latestInsight.feedback === 'down'
                    ? 'text-money-neg dark:text-money-negDark'
                    : 'text-brand-400 hover:text-money-neg dark:text-brand-500 dark:hover:text-money-negDark'
                }
                onClick={() => rateInsight(latestInsight.id, 'down')}
                aria-label="This insight was not helpful"
                aria-pressed={latestInsight.feedback === 'down'}
              >
                <ThumbsDown size={15} fill={latestInsight.feedback === 'down' ? 'currentColor' : 'none'} />
              </Button>
            </div>
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
    </Section>
  );
});

InsightWidget.displayName = 'InsightWidget';
