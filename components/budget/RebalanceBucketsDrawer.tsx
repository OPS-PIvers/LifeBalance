import React, { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import BucketPlanEditor from '@/components/budget/BucketPlanEditor';
import { computeTrimPlan } from '@/utils/bucketTrimPlan';
import { resolvePlanDrafts } from '@/utils/bucketPlanPreview';
import { computeBudgetFit } from '@/utils/budgetFit';

/**
 * PR B2 — "Rebalance buckets": the FIX for the over-allocation that
 * `SafeToSpendBreakdownDrawer` reports and the toolbar's amber mark hints at.
 *
 * It mounts the same {@link BucketPlanEditor} the pay-period ceremony uses,
 * with its drafts SEEDED from {@link computeTrimPlan} — so the user opens the
 * drawer and the recommended trims are already applied, with the fit meter
 * reading as balanced. Nothing is written until Save, and every field is
 * editable first: the plan is a starting point, not a verdict.
 *
 * `available` is the LIVE Safe-to-Spend, taken off the same
 * `safeToSpendBreakdown` that produced the shortfall being closed. It is
 * deliberately NOT the ceremony's `projectedAvailable` variant — there are no
 * balance drafts on this surface, so there is nothing to project, and reading a
 * projection here would measure the plan against cash that doesn't exist yet.
 *
 * Default export so it can be `React.lazy`-loaded, keeping `Drawer` (and
 * framer-motion with it) off the boot bundle.
 */
interface RebalanceBucketsDrawerProps {
  open: boolean;
  onClose: () => void;
}

const RebalanceBucketsDrawer: React.FC<RebalanceBucketsDrawerProps> = ({ open, onClose }) => {
  const {
    safeToSpendBreakdown: breakdown,
    buckets,
    bucketSpentMap,
    bucketHistory,
    setBucketLimits,
  } = useFinance();
  const fmt = useFormatCurrency();
  const [isSaving, setIsSaving] = useState(false);

  // The shortfall this drawer exists to close. Derived from the SAME
  // `computeBudgetFit` the header mark and the breakdown drawer read, rather
  // than passed in as a prop — a figure and the action that closes it must not
  // be able to drift apart.
  const fit = useMemo(
    () => (breakdown ? computeBudgetFit(breakdown, buckets, bucketSpentMap) : null),
    [breakdown, buckets, bucketSpentMap],
  );

  const plan = useMemo(
    () => (fit ? computeTrimPlan(fit.shortfall, buckets, bucketSpentMap, bucketHistory) : null),
    [fit, buckets, bucketSpentMap, bucketHistory],
  );

  // Seed every bucket with its recommended limit, falling back to its saved
  // limit for the buckets the plan leaves alone.
  const seed = useMemo(() => {
    const trims = new Map((plan?.suggestions ?? []).map(s => [s.id, s.suggestedLimit]));
    return Object.fromEntries(buckets.map(b => [b.id, String(trims.get(b.id) ?? b.limit)]));
  }, [buckets, plan]);

  const [drafts, setDrafts] = useState<Record<string, string>>(seed);

  // `LazyMount` keeps this drawer mounted after its first open, so a stale set
  // of drafts would otherwise greet the user on the next over-allocation with
  // numbers computed against last time's shortfall. Re-seeding on the OPEN edge
  // is React's documented "adjust state when a prop changes" pattern (no extra
  // render pass, no `react-hooks/set-state-in-effect` suppression) and mirrors
  // how `SafeToSpendBreakdownDrawer` resets its expanded panel.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setDrafts(seed);
  }

  const { changed, hasInvalid } = useMemo(
    () => resolvePlanDrafts(buckets, drafts),
    [buckets, drafts],
  );

  // Cold load: no breakdown yet, so there is no shortfall to describe and no
  // honest cash figure to measure a plan against (mirrors the breakdown
  // drawer's own guard).
  if (!breakdown || !fit || !plan) return null;

  const handleSave = async () => {
    if (changed.length === 0 || hasInvalid) return;
    setIsSaving(true);
    try {
      // ONE batched, all-or-nothing write — never a limit at a time, or a
      // failure part-way through would leave the household with a plan that
      // matches neither the old budgets nor the new ones.
      await setBucketLimits(changed);
      onClose();
    } catch {
      // setBucketLimits already toasted; keep the drawer open so the user can
      // retry without losing their edits.
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Drawer
      isOpen={open}
      onClose={onClose}
      title="Rebalance buckets"
      height="tall"
      header={
        <div className="px-4 pb-3 pt-1">
          <p
            data-testid="rebalance-shortfall"
            className="text-sm text-brand-600 dark:text-brand-300"
          >
            {fit.shortfall >= 0.005 ? (
              <>
                Your budgets claim{' '}
                <span className="font-mono font-semibold tabular-nums text-money-neg dark:text-money-negDark">
                  {fmt(fit.shortfall)}
                </span>{' '}
                more than you have left.
              </>
            ) : (
              'Your budgets already fit the cash you have left.'
            )}
          </p>
          <p className="mt-0.5 text-xs text-brand-400 dark:text-brand-450">
            {plan.suggestions.length > 0
              ? `Suggested trims are filled in below — ${fmt(plan.resolved)} off ${
                  plan.suggestions.length === 1
                    ? '1 bucket'
                    : `${plan.suggestions.length} buckets`
                }. Change anything before saving.`
              : 'Nothing is filled in — adjust any limit below.'}
          </p>
        </div>
      }
      footer={
        <div className="flex gap-2 border-t border-brand-200 px-4 pt-3 dark:border-brand-700">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleSave}
            disabled={changed.length === 0 || hasInvalid}
            isLoading={isSaving}
          >
            Save budgets
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* The part the buckets could NOT absorb. Surfaced rather than quietly
            under-delivered: the meter below will still read short, and a plan
            that says nothing about why is worse than no plan. */}
        {plan.unresolved >= 0.005 && (
          <div
            data-testid="rebalance-unresolved"
            className="flex items-start gap-2 rounded-card border border-warm-200 bg-warm-50 px-3 py-2.5 dark:border-warm-700 dark:bg-warm-900/25"
          >
            <AlertTriangle
              size={14}
              className="mt-0.5 shrink-0 text-warm-600 dark:text-warm-400"
              aria-hidden="true"
            />
            {/* Careful with this sentence: with no spending history at all,
                every bucket's "usually needs" IS its current limit, so the
                plan frees $0 — not because the room isn't there, but because
                nothing yet says the bucket doesn't need it. Phrase it as what
                a SAFE trim can free, never as "there is no room". */}
            <p className="text-xs leading-relaxed text-brand-700 dark:text-brand-200">
              <span className="font-semibold">{fmt(plan.unresolved)} still uncovered.</span>{' '}
              Only {fmt(plan.resolved)} can come off without dropping a bucket below what it
              has already spent this period, or what it usually needs. Edit a limit below, or
              move a bill to the next period, to close the rest.
            </p>
          </div>
        )}

        <BucketPlanEditor
          buckets={buckets}
          drafts={drafts}
          onDraftsChange={setDrafts}
          bucketSpentMap={bucketSpentMap}
          available={breakdown.safeToSpend}
          idPrefix="rebalance"
          title="Bucket budgets"
          // Describes the PLAN, not the live draft — it's the reference the
          // user edits against, so it must stay put while they type.
          metaFor={b => {
            const suggestion = plan.suggestions.find(s => s.id === b.id);
            return suggestion
              ? `Plan: ${fmt(suggestion.suggestedLimit, { decimals: 0 })} · was ${fmt(suggestion.currentLimit, { decimals: 0 })}`
              : `Plan: keep ${fmt(b.limit, { decimals: 0 })}`;
          }}
          footnote="Trims come off the buckets with the most unused room first, and never drop a limit below what that bucket has already spent this period."
        />
      </div>
    </Drawer>
  );
};

export default RebalanceBucketsDrawer;
