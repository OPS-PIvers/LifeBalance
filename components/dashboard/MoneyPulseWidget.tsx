import React from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { useDashboardTransactionStats } from '@/hooks/useDashboardTransactionStats';
import { roundMoney } from '@/utils/money';
import { TrendingUp, TrendingDown, Receipt } from 'lucide-react';
import SectionActionLink from '@/components/ui/SectionActionLink';
import { Section, SurfaceList, Row } from '@/components/ui/Section';

export const MoneyPulseWidget: React.FC = () => {
  const { transactions } = useFinance();
  const { thisWeekSpend, lastWeekSpend, recentTransactions } = useDashboardTransactionStats();
  const fmt = useFormatCurrency();

  // Spending pulse — week deltas derived from the shared single-pass totals.
  // Identical arithmetic to the prior local useMemo (the week totals are now
  // accumulated in integer cents upstream, exactly equal for cent-valued money).
  const diff = roundMoney(thisWeekSpend - lastWeekSpend);
  const spendingStats = {
    thisWeek: thisWeekSpend,
    lastWeek: lastWeekSpend,
    percentChange: lastWeekSpend > 0 ? (diff / lastWeekSpend) * 100 : 0,
    isHigher: diff > 0,
  };

  if (transactions.length === 0) return null;

  const noPrior = spendingStats.percentChange === 0 && spendingStats.isHigher;

  return (
    <Section
      title="Money pulse"
      action={
        <SectionActionLink to="/budget">View money</SectionActionLink>
      }
    >
      <SurfaceList>
        {/* This week's spend + delta */}
        <Row className="flex-col items-start gap-1">
          <p className="text-xs text-brand-500 dark:text-brand-400 font-medium">Spent this week</p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <p className="stat-num text-2xl font-bold text-brand-900 dark:text-brand-50">
              {fmt(spendingStats.thisWeek, { decimals: 0 })}
            </p>
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                noPrior
                  ? 'bg-brand-100 text-brand-500 dark:bg-brand-700 dark:text-brand-300'
                  : spendingStats.isHigher
                    ? 'bg-money-bgNeg text-money-neg dark:bg-money-neg/15 dark:text-money-negDark'
                    : 'bg-money-bgPos text-money-pos dark:bg-money-pos/15 dark:text-money-posDark'
              }`}
            >
              {noPrior ? (
                <span className="font-medium">No prior data</span>
              ) : (
                <>
                  {spendingStats.isHigher ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  <span>{Math.abs(spendingStats.percentChange).toFixed(0)}%</span>
                  <span className="opacity-70 font-medium">vs last week</span>
                </>
              )}
            </div>
          </div>
        </Row>

        {/* Recent transactions */}
        {recentTransactions.map(tx => (
          <Row key={tx.id} className="justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-card bg-brand-100 border border-brand-200 flex items-center justify-center text-brand-400 shrink-0 dark:bg-brand-700/50 dark:border-brand-700 dark:text-brand-500">
                <Receipt size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-800 dark:text-brand-100 truncate max-w-[150px]">{tx.merchant}</p>
                <p className="text-xxs text-brand-400 dark:text-brand-500 font-medium">{tx.relativeDate}</p>
              </div>
            </div>
            <span className="font-mono font-bold tabular-nums text-brand-900 dark:text-brand-50 text-sm shrink-0">
              {fmt(tx.amount, { decimals: 0 })}
            </span>
          </Row>
        ))}
      </SurfaceList>
    </Section>
  );
};
