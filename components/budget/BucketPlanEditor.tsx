import React, { useMemo } from 'react';
import { AlertTriangle, RotateCcw, Sparkles } from 'lucide-react';
import { BudgetBucket } from '@/types/schema';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import Input from '@/components/ui/Input';
import ProgressBar from '@/components/ui/ProgressBar';
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

  // Full REPLACEMENT of the drafts object (not a merge onto `prev`) — matches
  // origin/main's pre-extraction `applySuggestions`/`resetToLast`. A merge
  // would leave a deleted bucket's stale draft key in state forever; every
  // consumer iterates `buckets` today so that's inert, but it's still an
  // unflagged behavioral departure for logic that claims to have moved
  // verbatim, so the full-replacement semantics are restored here.
  const applySuggestions = () => {
    if (!suggestions) return;
    onDraftsChange(
      Object.fromEntries(buckets.map(b => [b.id, String(suggestions.get(b.id) ?? b.limit)])),
    );
  };

  const resetToSaved = () => {
    onDraftsChange(Object.fromEntries(buckets.map(b => [b.id, String(b.limit)])));
  };

  // The bar reads "how much of the available cash this plan claims". With no
  // cash at all (or negative) there is no meaningful denominator, so the bar
  // renders full — every dollar planned is a dollar that isn't there.
  const percent = available > 0 ? (fit.claimed / available) * 100 : fit.claimed > 0 ? 100 : 0;
  // Driven by `leftover` — the TRUTH of whether the plan balances — never by
  // `fit.fits`, which is only the $10 noise floor for ALARM STYLING below.
  // A shortfall under that floor still over-claims the cash; declining to
  // raise an alarm about it is not the same as calling it "Fully planned".
  // The `0.005` half-cent epsilon matches this repo's other displayed-money
  // comparisons (TopToolbar's `isPositive`, the drawer's `>= 0.005` checks)
  // so a leftover just barely negative (e.g. -$0.004) still reads as
  // balanced rather than rounding `fit.shortfall` down to a nonsensical
  // "Short by $0.00".
  const verdict =
    fit.leftover >= 0.005
      ? `${fmt(fit.leftover)} left unplanned`
      : fit.leftover <= -0.005
        ? `Short by ${fmt(fit.shortfall)}`
        : 'Fully planned';

  // `text-brand-400` is hand-tuned to 4.54:1 against `bg-brand-50` (see
  // index.css) — the fits state's box background — but only 4.44:1 against
  // `bg-warm-50`, the short state's box background, under the 4.5:1 AA floor
  // for small text. `brand-500` (5.78:1 on warm-50) clears it in both boxes,
  // so the muted "of $X" / "· Safe to spend $Y" sub-labels switch to it only
  // in the short state; dark mode was already fine and is unchanged.
  const mutedSuffixClass = cn(
    'font-normal',
    fit.fits ? 'text-brand-400 dark:text-brand-450' : 'text-brand-500 dark:text-brand-450',
  );

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
        data-testid={`${idPrefix}-meter`}
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
            <span className={mutedSuffixClass}>
              {' '}
              of {fmt(available)}
            </span>
          </span>
        </div>
        {/* Track retints per state rather than staying a fixed neutral — same
            strategy BudgetBucketCard uses for its overspend track (never just
            the fill). Light reuses its exact tokens (bg-money-bgPos/bgNeg,
            solid). Dark can't reuse its literal money-pos/neg alpha tint: this
            meter's own box background is ITSELF translucent in dark
            (dark:bg-brand-700/30 / dark:bg-warm-900/25), and tinting the track
            toward the same hue as the fill only pulls the two closer together
            — verified by computing the actual composited pixels, that
            shrinks the fill-vs-track ratio as the tint gets stronger, not the
            opposite. A single solid darker neutral is backdrop-independent and
            clears 3:1 for both fills with room to spare (money-pos-dark
            4.49:1, money-neg-dark 3.85:1 against brand-900). */}
        <ProgressBar
          value={percent}
          className={cn('mt-2 h-1.5 dark:bg-brand-900', fit.fits ? 'bg-money-bgPos' : 'bg-money-bgNeg')}
          barClassName={fit.fits ? 'bg-money-pos' : 'bg-money-neg'}
          ariaLabel={`Planned ${fmt(fit.claimed)} of ${fmt(available)} ${availableLabel}`}
        />
        <p
          className={cn(
            'mt-1.5 flex items-center gap-1 text-xxs',
            fit.fits
              ? 'text-brand-500 dark:text-brand-400'
              : 'font-semibold text-money-neg dark:text-money-negDark',
          )}
        >
          {/* Matches BudgetBucketCard's "over budget" line, which pairs the
              same warning state with an AlertTriangle — icon stays aria-hidden
              since the adjacent text already carries the meaning. */}
          {!fit.fits && <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />}
          <span>
            {verdict}
            <span className={mutedSuffixClass}>
              {' · '}
              {availableLabel} {fmt(available)}
            </span>
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
                    className="text-right font-mono tabular-nums"
                    aria-label={`${b.name} budget for this period`}
                    // `Input` already wires aria-invalid/aria-describedby and
                    // renders a visible message whenever `error` is supplied —
                    // no need to hand-roll the red-border styling separately
                    // (that's what FIELD_ERROR did before, silently, with no
                    // explanation for why Save was unreachable).
                    error={invalid ? 'Must be $0 or more' : undefined}
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
