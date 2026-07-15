import React from 'react';
import { Lock, TrendingDown, TrendingUp, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import Eyebrow from '@/components/ui/Eyebrow';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { roundMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import { formatMonthLabel } from '@/utils/monthLabel';
import type { MonthlyMoneyRecap } from '@/types/schema';

/**
 * MoneyRecapDrawer — bottom-sheet detail view of one monthly money recap
 * (F-MONEY-06, the Weekly Recap's money sibling).
 *
 * Renders every recap section from the pre-computed server numbers: income vs
 * spend with month-over-month trend, per-bucket over/under close-out, the
 * month's biggest single expense, and the narrative (blurred behind a small
 * upsell row when `premium: false`). Statically imported by the Dashboard-only
 * MoneyRecapCard — the Dashboard page is itself lazy-loaded, so the Drawer/
 * framer-motion dependency stays off the boot bundle (same rationale as
 * WeeklyRecapDrawer).
 */

interface MoneyRecapDrawerProps {
  recap: MonthlyMoneyRecap | null;
  isOpen: boolean;
  onClose: () => void;
}

const SectionBlock: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <Eyebrow className="mb-2">{label}</Eyebrow>
    {children}
  </div>
);

export const MoneyRecapDrawer: React.FC<MoneyRecapDrawerProps> = ({ recap, isOpen, onClose }) => {
  const fmt = useFormatCurrency();

  if (!recap) return null;

  const diff = roundMoney(recap.totalSpend - recap.priorMonthSpend);
  const spentLess = diff < 0;
  const DiffIcon = spentLess ? TrendingDown : TrendingUp;
  const net = roundMoney(recap.totalIncome - recap.totalSpend);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title={`Money recap · ${formatMonthLabel(recap.month)}`}>
      <div className="space-y-6 pb-2">
        {/* Income vs spend */}
        <SectionBlock label="This month">
          <div className="grid grid-cols-2 gap-3">
            <div className="surface-section p-3">
              <p className="text-xs font-medium text-brand-500 dark:text-brand-400">Income</p>
              <p className="stat-num text-xl font-bold text-money-pos dark:text-money-posDark">
                {fmt(recap.totalIncome, { decimals: 0 })}
              </p>
            </div>
            <div className="surface-section p-3">
              <p className="text-xs font-medium text-brand-500 dark:text-brand-400">Spent</p>
              <p className="stat-num text-xl font-bold text-accent-700 dark:text-accent-300">
                {fmt(recap.totalSpend, { decimals: 0 })}
              </p>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm text-brand-500 dark:text-brand-400">
              Net {net < 0 ? 'shortfall' : 'left over'}
            </span>
            <span
              className={cn(
                'stat-num text-sm font-semibold',
                net < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark'
              )}
            >
              {fmt(Math.abs(net), { decimals: 0 })}
            </span>
          </div>
          {recap.priorMonthSpend > 0 && diff !== 0 && (
            <p
              className={cn(
                'mt-1 flex items-center gap-1 text-sm font-semibold',
                spentLess ? 'text-money-pos dark:text-money-posDark' : 'text-money-neg dark:text-money-negDark'
              )}
            >
              <DiffIcon size={14} aria-hidden="true" />
              {fmt(Math.abs(diff), { decimals: 0 })} {spentLess ? 'less' : 'more'} than last month
            </p>
          )}
        </SectionBlock>

        {/* Per-bucket over/under close-out */}
        {recap.bucketResults.length > 0 && (
          <SectionBlock label="Budget vs actual">
            <ul className="divide-y divide-brand-100 dark:divide-brand-700/60">
              {recap.bucketResults.map(b => {
                const over = b.overUnder > 0;
                return (
                  <li key={b.bucketId} className="flex items-center justify-between py-2 gap-3">
                    <span className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">
                      {b.bucketName}
                    </span>
                    <span className="flex items-baseline gap-2 shrink-0">
                      <span className="stat-num text-sm font-semibold text-brand-700 dark:text-brand-200">
                        {fmt(b.spent, { decimals: 0 })}
                      </span>
                      <span className="text-xs text-brand-400 dark:text-brand-500">
                        / {fmt(b.limit, { decimals: 0 })}
                      </span>
                      {b.overUnder !== 0 && (
                        <span
                          className={cn(
                            'flex items-center text-xs font-semibold',
                            over ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark'
                          )}
                        >
                          {over ? <ArrowUpRight size={12} aria-hidden="true" /> : <ArrowDownRight size={12} aria-hidden="true" />}
                          {fmt(Math.abs(b.overUnder), { decimals: 0 })}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </SectionBlock>
        )}

        {/* Biggest single expense */}
        {recap.topExpense && (
          <SectionBlock label="Biggest expense">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-900 dark:text-brand-100 truncate">
                  {recap.topExpense.merchant}
                </p>
                <p className="text-xs text-brand-500 dark:text-brand-400 truncate">
                  {recap.topExpense.category} · {recap.topExpense.date}
                </p>
              </div>
              <span className="stat-num text-lg font-bold text-accent-700 dark:text-accent-300 shrink-0">
                {fmt(recap.topExpense.amount, { decimals: 0 })}
              </span>
            </div>
          </SectionBlock>
        )}

        {/* Net worth delta — only when the feature has populated it */}
        {recap.netWorthDelta !== null && (
          <SectionBlock label="Net worth">
            <p
              className={cn(
                'stat-num text-lg font-bold',
                recap.netWorthDelta < 0 ? 'text-money-neg dark:text-money-negDark' : 'text-money-pos dark:text-money-posDark'
              )}
            >
              {recap.netWorthDelta < 0 ? '−' : '+'}{fmt(Math.abs(recap.netWorthDelta), { decimals: 0 })}
              <span className="ml-1.5 text-sm font-medium text-brand-500 dark:text-brand-400">this month</span>
            </p>
          </SectionBlock>
        )}

        {/* Narrative — the premium-gated section */}
        <SectionBlock label="Your recap">
          {recap.premium ? (
            <p className="text-sm leading-relaxed text-brand-700 dark:text-brand-200">
              {recap.narrative}
            </p>
          ) : (
            <div>
              <p
                className="text-sm leading-relaxed text-brand-700 dark:text-brand-200 blur-sm select-none"
                aria-hidden="true"
              >
                {recap.narrative || 'Your personalized monthly money summary is ready to read.'}
              </p>
              <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-warm-700 dark:text-warm-300">
                <Lock size={14} aria-hidden="true" />
                Unlock your personal recap with Premium
              </div>
            </div>
          )}
        </SectionBlock>
      </div>
    </Drawer>
  );
};
