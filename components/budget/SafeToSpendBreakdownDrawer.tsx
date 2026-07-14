import React, { useMemo } from 'react';
import { Wallet, Receipt, Clock, PiggyBank } from 'lucide-react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { Drawer } from '@/components/ui/Drawer';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import ProgressBar from '@/components/ui/ProgressBar';
import { computeSafeToSpendDistribution } from '@/utils/safeToSpendDistribution';

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
 * All math lives in {@link computeSafeToSpendDistribution}; this component is
 * presentational. Default export so it can be React.lazy-loaded (keeping the
 * Drawer/framer-motion off the boot bundle).
 */
interface SafeToSpendBreakdownDrawerProps {
  open: boolean;
  onClose: () => void;
}

const SafeToSpendBreakdownDrawer: React.FC<SafeToSpendBreakdownDrawerProps> = ({ open, onClose }) => {
  const { safeToSpendBreakdown: breakdown, buckets, bucketSpentMap } = useFinance();
  const fmt = useFormatCurrency();

  const distribution = useMemo(
    () => (breakdown ? computeSafeToSpendDistribution(breakdown, buckets, bucketSpentMap) : null),
    [breakdown, buckets, bucketSpentMap]
  );

  // Guard: no breakdown yet (cold load) → render nothing (mirrors SafeToSpendDetail).
  if (breakdown === undefined || distribution === null) return null;

  const { rows, leftover, overAllocated } = distribution;

  return (
    <Drawer isOpen={open} onClose={onClose} title="Safe to spend">
      <div className="flex flex-col gap-5">
        {/* 1. Waterfall — how the pool is computed. */}
        <Section title="How it's calculated">
          <SurfaceList>
            <WaterfallRow
              icon={<Wallet size={16} />}
              label="Checking balance"
              sub="Available cash"
              value={fmt(breakdown.checkingBalance)}
            />
            <WaterfallRow
              icon={<Receipt size={16} />}
              label="Unpaid bills this period"
              sub="Due before your next paycheck"
              value={breakdown.unpaidBills >= 0.005 ? `- ${fmt(breakdown.unpaidBills)}` : fmt(0)}
              negative={breakdown.unpaidBills >= 0.005}
            />
            {breakdown.pendingSpend > 0 && (
              <WaterfallRow
                icon={<Clock size={16} />}
                label="Pending transactions"
                sub="Spent but not yet cleared"
                value={`- ${fmt(breakdown.pendingSpend)}`}
                negative
              />
            )}
            <Row className="justify-between bg-brand-50 dark:bg-brand-700/30">
              <span className="text-sm font-semibold text-brand-800 dark:text-brand-100">
                Safe to Spend
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-brand-900 dark:text-brand-50">
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
              return (
                <Row key={row.id} className="flex-col items-stretch gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium text-brand-800 dark:text-brand-100">
                      {row.name}
                    </span>
                    <span
                      className={`font-mono text-sm font-semibold tabular-nums shrink-0 ${
                        row.isOver
                          ? 'text-money-neg dark:text-money-negDark'
                          : 'text-brand-700 dark:text-brand-200'
                      }`}
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
                      {row.isOver ? 'Over budget' : 'Remaining'}
                    </span>
                  </div>
                </Row>
              );
            })}

            {/* Leftover / over-allocated row. */}
            <Row className="justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-brand-500 dark:text-brand-400 shrink-0">
                  <PiggyBank size={16} />
                </span>
                <span className="text-sm font-semibold text-brand-800 dark:text-brand-100">
                  {overAllocated ? 'Over-allocated' : 'Unallocated'}
                </span>
              </div>
              <span
                className={`font-mono text-sm font-bold tabular-nums shrink-0 ${
                  overAllocated
                    ? 'text-money-neg dark:text-money-negDark'
                    : 'text-brand-900 dark:text-brand-50'
                }`}
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

const WaterfallRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  sub: string;
  value: string;
  negative?: boolean;
}> = ({ icon, label, sub, value, negative = false }) => (
  <Row className="justify-between">
    <div className="flex items-center gap-3 min-w-0">
      <span className="w-9 h-9 rounded-card bg-brand-100 border border-brand-200 flex items-center justify-center text-brand-500 shrink-0 dark:bg-brand-700/50 dark:border-brand-700 dark:text-brand-300">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate">{label}</p>
        <p className="text-xxs text-brand-400 dark:text-brand-450">{sub}</p>
      </div>
    </div>
    <span
      className={`font-mono text-sm font-bold tabular-nums shrink-0 ${
        negative ? 'text-money-neg dark:text-money-negDark' : 'text-brand-900 dark:text-brand-50'
      }`}
    >
      {value}
    </span>
  </Row>
);

export default SafeToSpendBreakdownDrawer;
