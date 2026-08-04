import React, { useMemo } from 'react';
import { RotateCcw, Sparkles } from 'lucide-react';
import { BudgetBucket } from '@/types/schema';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import Input from '@/components/ui/Input';
import ProgressBar from '@/components/ui/ProgressBar';
import { FIELD_ERROR } from '@/components/ui/fieldStyles';
import { cn } from '@/utils/cn';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { parseLimitDraft, previewPlanFit, resolvePlanDrafts } from '@/utils/bucketPlanPreview';

/**
 * The bucket-budget editor + its live "does my plan fit" meter.
 *
 * DELIBERATELY BUILT FOR TWO CONSUMERS. It was extracted from
 * `PayPeriodCeremonyDrawer` (which sets budgets for a NEW pay period) so the
 * rebalance drawer can mount the same editor against a DIFFERENT save path —
 * so the split of responsibilities is the whole point of the prop shape:
 *
 *  - THIS component owns the editing UI, the per-bucket suggestion affordance,
 *    the parse/validation styling, and the fit meter. Nothing here writes.
 *  - The PARENT owns the drafts state (`drafts` + `onDraftsChange` is just its
 *    `useState` pair, so the parent can seed, inspect and submit them) and the
 *    save action, including whether a save is possible at all.
 *
 * The parent also supplies `available` rather than reading Safe-to-Spend
 * itself, because the two consumers measure against different cash: the
 * ceremony projects unsaved balance edits into it (`projectedAvailable`),
 * while a rebalance drawer measures against the live figure.
 *
 * WARN, NEVER BLOCK. The meter is informational — it never disables anything
 * and never gates a save. In the ceremony the user is half-way through
 * entering balances when they reach this editor, so the projected cash is
 * unsettled BY DESIGN; trapping someone behind a number that is still
 * mid-edit would be worse than the over-allocation it is warning about.
 */
export interface BucketPlanEditorProps {
  /** The household's buckets, in display order. */
  buckets: BudgetBucket[];
  /**
   * Draft limit text keyed by bucket id — raw field values, not numbers, so a
   * half-typed entry survives a re-render. A bucket with no entry falls back
   * to its saved limit (a bucket the live listener added after mount).
   */
  drafts: Record<string, string>;
  /**
   * The parent's `useState` setter for {@link drafts}. Typed as a full
   * `Dispatch<SetStateAction<…>>` so this component can apply functional
   * updates (per-field edits, "use suggestions", "reset") without ever owning
   * the state the parent has to submit.
   */
  onDraftsChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  /** Spend per bucket this period — drives `claim = max(0, limit − spent)`. */
  bucketSpentMap: Map<string, BucketSpent>;
  /** The cash this plan is measured against (see the note above about why it's a prop). */
  available: number;
  /**
   * Per-bucket suggested limits, keyed by bucket id. When omitted the
   * suggestion affordances (the header's "Use suggestions" and each row's
   * "Suggested: $X") are not rendered at all — a consumer with no spending
   * history to suggest from should pass nothing rather than a map of
   * no-op suggestions.
   */
  suggestions?: Map<string, number>;
  /** Section heading. */
  title?: React.ReactNode;
  /** What `available` is called in the meter (e.g. "Safe to spend"). */
  availableLabel?: string;
  /** Optional extra muted line under each row's field (e.g. last period's spend). */
  metaFor?: (bucket: BudgetBucket) => React.ReactNode;
  /** Optional explanatory copy rendered under the list. */
  footnote?: React.ReactNode;
  /** Prefix for the generated input ids/labels — must be unique per mounted editor. */
  idPrefix?: string;
}

/** Compact header-action button — matches the app's Section-action convention. */
const HeaderAction: React.FC<{
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ onClick, icon, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="text-xs font-semibold whitespace-nowrap text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-sm"
  >
    {icon} {children}
  </button>
);

const BucketPlanEditor: React.FC<BucketPlanEditorProps> = ({
  buckets,
  drafts,
  onDraftsChange,
  bucketSpentMap,
  available,
  suggestions,
  title = "This period's budgets",
  availableLabel = 'Safe to spend',
  metaFor,
  footnote,
  idPrefix = 'bucket-plan',
}) => {
  const fmt = useFormatCurrency();

  // ONE derivation feeds both the meter and the "did anything change" header
  // affordance, and it is the same helper the parent's save path uses — so
  // the meter always measures exactly what a save would write.
  const resolved = useMemo(() => resolvePlanDrafts(buckets, drafts), [buckets, drafts]);
  const fit = useMemo(
    () => previewPlanFit(available, resolved.effective, bucketSpentMap),
    [available, resolved.effective, bucketSpentMap],
  );

  const applySuggestions = () => {
    if (!suggestions) return;
    onDraftsChange(prev => {
      const next = { ...prev };
      buckets.forEach(b => {
        next[b.id] = String(suggestions.get(b.id) ?? b.limit);
      });
      return next;
    });
  };

  const resetToSaved = () => {
    onDraftsChange(prev => {
      const next = { ...prev };
      buckets.forEach(b => {
        next[b.id] = String(b.limit);
      });
      return next;
    });
  };

  // The bar reads "how much of the available cash this plan claims". With no
  // cash at all (or negative) there is no meaningful denominator, so the bar
  // renders full — every dollar planned is a dollar that isn't there.
  const percent = available > 0 ? (fit.claimed / available) * 100 : fit.claimed > 0 ? 100 : 0;
  const verdict = fit.fits
    ? fit.leftover >= 0.005
      ? `${fmt(fit.leftover)} left unplanned`
      : 'Fully planned'
    : `Short by ${fmt(fit.shortfall)}`;

  return (
    <Section
      title={title}
      action={
        <div className="flex items-center gap-3">
          {resolved.changed.length > 0 && (
            <HeaderAction onClick={resetToSaved} icon={<RotateCcw size={12} className="shrink-0" />}>
              Reset to last
            </HeaderAction>
          )}
          {suggestions && (
            <HeaderAction
              onClick={applySuggestions}
              icon={<Sparkles size={12} className="shrink-0" />}
            >
              Use suggestions
            </HeaderAction>
          )}
        </div>
      }
    >
      {/* Fit meter — informational only. Never disables or gates anything. */}
      <div
        data-testid="bucket-plan-meter"
        className={cn(
          'mb-2 rounded-card border px-3 py-2.5',
          fit.fits
            ? 'border-brand-200 bg-brand-50 dark:border-brand-700 dark:bg-brand-700/30'
            : 'border-warm-200 bg-warm-50 dark:border-warm-700 dark:bg-warm-900/25',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold text-brand-700 dark:text-brand-200">
            Planned
          </span>
          <span className="stat-num shrink-0 text-sm font-semibold text-brand-800 dark:text-brand-100">
            {fmt(fit.claimed)}
            <span className="font-normal text-brand-400 dark:text-brand-450">
              {' '}
              of {fmt(available)}
            </span>
          </span>
        </div>
        <ProgressBar
          value={percent}
          className="mt-2 h-1.5 bg-brand-100 dark:bg-brand-700"
          barClassName={fit.fits ? 'bg-money-pos' : 'bg-money-neg'}
          ariaLabel={`Planned ${fmt(fit.claimed)} of ${fmt(available)} ${availableLabel}`}
        />
        <p
          className={cn(
            'mt-1.5 text-xxs',
            fit.fits
              ? 'text-brand-500 dark:text-brand-400'
              : 'font-semibold text-money-neg dark:text-money-negDark',
          )}
        >
          {verdict}
          <span className="font-normal text-brand-400 dark:text-brand-450">
            {' · '}
            {availableLabel} {fmt(available)}
          </span>
        </p>
      </div>

      <SurfaceList>
        {buckets.map(b => {
          const value = drafts[b.id] ?? String(b.limit);
          const invalid = parseLimitDraft(value) === null;
          const suggestion = suggestions?.get(b.id) ?? b.limit;
          const meta = metaFor?.(b);
          return (
            <Row key={b.id} className="flex-col items-stretch gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={`${idPrefix}-limit-${b.id}`}
                  className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100"
                >
                  {b.name}
                </label>
                <div className="w-28 shrink-0">
                  <Input
                    id={`${idPrefix}-limit-${b.id}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="1"
                    value={value}
                    onChange={e =>
                      onDraftsChange(prev => ({ ...prev, [b.id]: e.target.value }))
                    }
                    className={cn('text-right font-mono tabular-nums', invalid && FIELD_ERROR)}
                    aria-label={`${b.name} budget for this period`}
                  />
                </div>
              </div>
              {(meta !== undefined || suggestions) && (
                <div className="flex justify-between gap-3 text-xxs text-brand-400 dark:text-brand-450">
                  <span className="min-w-0 truncate">{meta}</span>
                  {suggestions && (
                    <button
                      type="button"
                      className="shrink-0 text-accent-600 dark:text-accent-300 hover:underline"
                      onClick={() =>
                        onDraftsChange(prev => ({ ...prev, [b.id]: String(suggestion) }))
                      }
                    >
                      Suggested: {fmt(suggestion, { decimals: 0 })}
                    </button>
                  )}
                </div>
              )}
            </Row>
          );
        })}
      </SurfaceList>

      {footnote && (
        <p className="px-1 pt-2 text-xxs text-brand-400 dark:text-brand-450 leading-relaxed">
          {footnote}
        </p>
      )}
    </Section>
  );
};

export default BucketPlanEditor;
