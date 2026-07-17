import React, { useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency, useHouseholdCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import ProgressBar from '@/components/ui/ProgressBar';
import { cn } from '@/utils/cn';
import { computeSafeToSpendDistribution } from '@/utils/safeToSpendDistribution';
import { calculateDailyPace, calculateBucketDailyPace, getDaysLeft } from '@/utils/spendPace';
import { splitCurrencyParts } from '@/utils/currencyParts';

/** Fill color by spend ratio — same ramp as BudgetHistory's bucket drawer. */
const progressColor = (spent: number, limit: number) => {
  if (limit === 0) return 'bg-money-neg';
  const ratio = spent / limit;
  if (ratio >= 1) return 'bg-money-neg';
  if (ratio >= 0.85) return 'bg-warm-500';
  return 'bg-money-pos';
};

/**
 * Plan 016 — Safe-to-Spend breakdown drawer, opened by tapping the toolbar
 * Safe-to-Spend figure.
 *
 * Model = "pool + tracking overlay": checking is one pool and all of it is safe
 * to spend. Buckets do NOT reserve against or reduce Safe-to-Spend — they are a
 * tracking overlay that shows WHERE the pool is nominally allocated. This drawer
 * decomposes:
 *
 *   Safe to Spend = Σ max(0, bucket remaining) + Unallocated (leftover)
 *
 * The drawer is the metric's editorial moment. The figure gets a magazine-scale
 * Besley treatment (a big ink integer with a smaller, muted currency symbol +
 * cents), and the decomposition beneath reads as a bank-ledger statement —
 * hairline-ruled rows, mono/tabular figures — rather than a generic icon-chip
 * stat list. Presentation only: all math lives in
 * {@link computeSafeToSpendDistribution}. Default export so it can be
 * React.lazy-loaded (keeping the Drawer/framer-motion off the boot bundle).
 */
interface SafeToSpendBreakdownDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SafeToSpendBreakdownDrawer: React.FC<SafeToSpendBreakdownDrawerProps> = ({ open, onClose }) => {
  const { safeToSpendBreakdown: breakdown, buckets, bucketSpentMap } = useFinance();
  const currency = useHouseholdCurrency();
  const fmt = useFormatCurrency();

  const distribution = useMemo(
    () => (breakdown ? computeSafeToSpendDistribution(breakdown, buckets, bucketSpentMap) : null),
    [breakdown, buckets, bucketSpentMap]
  );

  const daysLeft = useMemo(
    () => (breakdown ? getDaysLeft(breakdown.nextPaycheckDate) : null),
    [breakdown]
  );

  const dailyPace = useMemo(
    () => (breakdown ? calculateDailyPace(breakdown) : null),
    [breakdown]
  );

  // Guard: no breakdown yet (cold load) → render nothing (mirrors SafeToSpendDetail).
  if (breakdown === undefined || distribution === null) return null;

  const { rows, leftover, overAllocated } = distribution;
  const parts = splitCurrencyParts(breakdown.safeToSpend, currency);
  const { negative } = parts;

  // Editorial caption under the hero figure. When a next paycheck is known we
  // reuse the exact pace string that previously sat below the waterfall (copy
  // unchanged, just relocated); otherwise a neutral sentence-case descriptor
  // that only appears when the pace line was already hidden.
  const caption = negative
    ? 'Spending has outrun this paycheck'
    : dailyPace !== null
      ? `≈ ${fmt(dailyPace)}/day until payday`
      : 'Available before your next paycheck';

  const heroTone = negative
    ? 'text-money-neg dark:text-money-negDark'
    : 'text-brand-900 dark:text-brand-50';
  const heroMuted = negative
    ? 'text-money-neg dark:text-money-negDark'
    : 'text-brand-400 dark:text-brand-450';

  return (
    <Drawer isOpen={open} onClose={onClose} title="Safe to spend">
      <div className="flex flex-col gap-5">
        {/* Editorial hero — the metric's signature moment. Type + spacing only:
            a magazine-scale Besley integer, a smaller muted symbol + cents, and
            a single broadsheet hairline rule beneath. No box, no shadow. */}
        <div className="border-b border-brand-200 dark:border-brand-700 pb-5">
          <div className="flex items-start gap-0.5">
            <span
              className={cn(
                'font-display font-medium leading-none tracking-tight text-2xl mt-2',
                heroMuted
              )}
            >
              {negative ? '−' : ''}
              {parts.symbolFirst ? parts.symbol : ''}
            </span>
            <span
              className={cn(
                'font-display font-semibold leading-none tracking-tight tabular-nums text-6xl',
                heroTone
              )}
            >
              {parts.integer}
            </span>
            <span
              className={cn(
                'font-display font-medium leading-none tracking-tight tabular-nums text-2xl mt-2',
                heroMuted
              )}
            >
              {parts.decimalSeparator}
              {parts.fraction}
              {!parts.symbolFirst ? ` ${parts.symbol}` : ''}
            </span>
          </div>
          <p className="mt-3 text-sm font-medium text-brand-500 dark:text-brand-400">{caption}</p>
        </div>

        {/* 1. Ledger — how the pool is computed. */}
        <Section title="How it's calculated">
          <SurfaceList>
            <LedgerRow
              label="Checking balance"
              sub="Available cash"
              value={fmt(breakdown.checkingBalance)}
            />
            <LedgerRow
              label="Unpaid bills this period"
              sub="Due before your next paycheck"
              value={breakdown.unpaidBills >= 0.005 ? `− ${fmt(breakdown.unpaidBills)}` : fmt(0)}
              negative={breakdown.unpaidBills >= 0.005}
            />
            {breakdown.pendingSpend > 0 && (
              <LedgerRow
                label="Pending transactions"
                sub="Spent but not yet cleared"
                value={`− ${fmt(breakdown.pendingSpend)}`}
                negative
              />
            )}
            <Row className="justify-between bg-brand-50 dark:bg-brand-700/30">
              <span className="font-display text-sm font-semibold tracking-tight text-brand-800 dark:text-brand-100">
                Safe to Spend
              </span>
              <span className="stat-num text-base font-bold text-brand-900 dark:text-brand-50">
                {fmt(breakdown.safeToSpend)}
              </span>
            </Row>
          </SurfaceList>
        </Section>

        {/* 2. Distribution across buckets + leftover. */}
        <Section title="Where it's allocated">
          <SurfaceList>
            {rows.map(row => {
              const percent =
                row.limit > 0 ? Math.max(0, (row.spent / row.limit) * 100) : 100;
              const bucketPace = calculateBucketDailyPace(row.remaining, daysLeft);
              return (
                <Row key={row.id} className="flex-col items-stretch gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100">
                      {row.name}
                    </span>
                    <span
                      className={cn(
                        'stat-num text-sm font-semibold shrink-0',
                        row.isOver
                          ? 'text-money-neg dark:text-money-negDark'
                          : 'text-brand-700 dark:text-brand-200'
                      )}
                    >
                      {fmt(row.remaining)}
                    </span>
                  </div>
                  <ProgressBar
                    value={percent}
                    className="h-1.5 bg-brand-100 dark:bg-brand-700"
                    barClassName={progressColor(row.spent, row.limit)}
                    ariaLabel={`${row.name}: ${Math.round(percent)}% of ${fmt(row.limit)} spent`}
                  />
                  <div className="flex justify-between text-xxs text-brand-400 dark:text-brand-450">
                    <span>
                      {fmt(row.spent)} of {fmt(row.limit)} spent
                    </span>
                    <span className={row.isOver ? 'text-money-neg dark:text-money-negDark' : ''}>
                      {row.isOver
                        ? 'Over budget'
                        : bucketPace !== null
                          ? `${fmt(bucketPace)}/day until payday`
                          : 'Remaining'}
                    </span>
                  </div>
                </Row>
              );
            })}

            {/* Leftover / over-allocated row — the ledger's closing line. */}
            <Row className="justify-between bg-brand-50 dark:bg-brand-700/30">
              <span className="font-display text-sm font-semibold tracking-tight text-brand-800 dark:text-brand-100">
                {overAllocated ? 'Over-allocated' : 'Unallocated'}
              </span>
              <span
                className={cn(
                  'stat-num text-base font-bold shrink-0',
                  overAllocated
                    ? 'text-money-neg dark:text-money-negDark'
                    : 'text-brand-900 dark:text-brand-50'
                )}
              >
                {fmt(leftover)}
              </span>
            </Row>
          </SurfaceList>

          {overAllocated && (
            <p className="px-1 pt-2 text-xs text-money-neg dark:text-money-negDark">
              Your budgets exceed available cash — trim a bucket.
            </p>
          )}
        </Section>

        {/* Clarifying copy. */}
        <p className="px-1 text-xxs text-brand-400 dark:text-brand-450 leading-relaxed">
          Buckets track where your spending goes — they don&apos;t reduce Safe-to-Spend.
        </p>
      </div>
    </Drawer>
  );
};

/**
 * A single bank-statement line: description + muted sub on the left, a
 * right-aligned mono figure on the right. No icon chip — the ledger reads as
 * broadsheet type, hierarchy coming from weight + the hairline rule that `Row`
 * draws between lines.
 */
const LedgerRow: React.FC<{
  label: string;
  sub: string;
  value: string;
  negative?: boolean;
}> = ({ label, sub, value, negative = false }) => (
  <Row className="justify-between gap-3">
    <div className="min-w-0">
      <p className="text-sm font-medium text-brand-800 dark:text-brand-100 truncate">{label}</p>
      <p className="text-xxs text-brand-400 dark:text-brand-450">{sub}</p>
    </div>
    <span
      className={cn(
        'stat-num text-sm font-semibold shrink-0',
        negative ? 'text-money-neg dark:text-money-negDark' : 'text-brand-800 dark:text-brand-100'
      )}
    >
      {value}
    </span>
  </Row>
);

export default SafeToSpendBreakdownDrawer;
