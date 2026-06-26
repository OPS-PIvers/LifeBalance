import React, { useMemo } from 'react';
import { useFinance, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { streakForHabit } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { sumMoney, roundMoney } from '@/utils/money';
import { startOfWeek, parseISO, isSameWeek } from 'date-fns';
import { Flame, TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * PulseStripWidget — the app's thesis metric, finally surfaced on Home.
 *
 * LifeBalance argues that money and habits move together; this strip puts the
 * week's three signals side by side so the user can read their balance at a
 * glance: points earned this week, money spent this week, habit consistency
 * (share of today's habits done), and the strongest active streak.
 *
 * Presentation only — all values are derived read-only from context data using
 * the FROZEN scoring/streak/money helpers. No business logic is changed here.
 */

type SpendTrend = 'up' | 'down' | 'flat' | 'none';

interface PulseMetrics {
  weekPoints: number;
  weekSpend: number;
  spendTrend: SpendTrend;
  spendPercent: number;
  consistencyDone: number;
  consistencyTotal: number;
  consistencyPercent: number;
  topStreak: number;
}

export const PulseStripWidget: React.FC = () => {
  const { transactions } = useFinance();
  const { habits, weeklyPoints } = useGamification();
  const fmt = useFormatCurrency();

  const metrics = useMemo<PulseMetrics>(() => {
    const now = new Date();
    const today = getLocalDateString();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });

    // --- Spending this week vs last week (cleared, non-income only) ---
    let thisWeekSpend = 0;
    let lastWeekSpend = 0;
    const lastWeekStart = startOfWeek(
      new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
      { weekStartsOn: 1 }
    );
    const thisWeekAmts: number[] = [];
    const lastWeekAmts: number[] = [];
    transactions.forEach((t) => {
      if (t.category === 'Income' || t.status === 'pending_review') return;
      const d = parseISO(t.date);
      if (isSameWeek(d, now, { weekStartsOn: 1 })) thisWeekAmts.push(t.amount);
      else if (isSameWeek(d, lastWeekStart, { weekStartsOn: 1 })) lastWeekAmts.push(t.amount);
    });
    thisWeekSpend = sumMoney(thisWeekAmts);
    lastWeekSpend = sumMoney(lastWeekAmts);
    const diff = roundMoney(thisWeekSpend - lastWeekSpend);

    let spendTrend: SpendTrend = 'none';
    let spendPercent = 0;
    if (lastWeekSpend > 0) {
      spendPercent = Math.abs(Math.round((diff / lastWeekSpend) * 100));
      spendTrend = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    }

    // --- Consistency: share of today's parent-owned habits completed ---
    const trackableToday = habits.filter((h) => h.period === 'daily' && !h.assignedTo);
    const consistencyTotal = trackableToday.length;
    const consistencyDone = trackableToday.filter((h) =>
      h.completedDates?.includes(today)
    ).length;
    const consistencyPercent =
      consistencyTotal > 0
        ? Math.round((consistencyDone / consistencyTotal) * 100)
        : 0;

    // --- Strongest active streak across positive habits ---
    const topStreak = habits.reduce((max, h) => {
      if (h.type !== 'positive') return max;
      const s = streakForHabit(h);
      return s > max ? s : max;
    }, 0);

    return {
      weekPoints: weeklyPoints,
      weekSpend: thisWeekSpend,
      spendTrend,
      spendPercent,
      consistencyDone,
      consistencyTotal,
      consistencyPercent,
      topStreak,
    };
  }, [transactions, habits, weeklyPoints]);

  // Nothing to balance yet — stay quiet on a brand-new household.
  if (
    metrics.weekPoints === 0 &&
    metrics.weekSpend === 0 &&
    metrics.consistencyTotal === 0 &&
    metrics.topStreak === 0
  ) {
    return null;
  }

  const SpendTrendIcon =
    metrics.spendTrend === 'up'
      ? TrendingUp
      : metrics.spendTrend === 'down'
        ? TrendingDown
        : Minus;

  return (
    <section
      aria-label="This week at a glance"
      className="surface-section overflow-hidden"
    >
      <header className="px-4 pt-3 pb-2">
        <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
          This week
        </h2>
      </header>

      <div className="grid grid-cols-3 divide-x divide-brand-200 dark:divide-brand-700 border-t border-brand-200 dark:border-brand-700">
        {/* Points earned — the habit/gamification signal (warm) */}
        <PulseCell label="Points">
          <span className="font-mono text-2xl font-bold tabular-nums text-warm-600 dark:text-warm-300">
            {metrics.weekPoints}
          </span>
          {metrics.topStreak > 0 ? (
            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-habit-streak">
              <Flame size={12} className="fill-current" aria-hidden="true" />
              <span aria-hidden="true">{metrics.topStreak}</span>
              <span className="sr-only">{metrics.topStreak} best active streak</span>
            </span>
          ) : (
            <span className="mt-1 text-xs font-medium text-brand-400 dark:text-brand-500">
              earned
            </span>
          )}
        </PulseCell>

        {/* Spending — the money signal (evergreen) */}
        <PulseCell label="Spent">
          <span className="font-mono text-2xl font-bold tabular-nums text-accent-700 dark:text-accent-300">
            {fmt(metrics.weekSpend, { decimals: 0 })}
          </span>
          {metrics.spendTrend === 'none' ? (
            <span className="mt-1 text-xs font-medium text-brand-400 dark:text-brand-500">
              this week
            </span>
          ) : (
            <span
              className={cn(
                'mt-1 flex items-center gap-1 text-xs font-semibold',
                metrics.spendTrend === 'up'
                  ? 'text-money-neg'
                  : metrics.spendTrend === 'down'
                    ? 'text-money-pos'
                    : 'text-brand-400 dark:text-brand-500'
              )}
            >
              <SpendTrendIcon size={12} aria-hidden="true" />
              <span>
                {metrics.spendPercent}%
                <span className="sr-only">
                  {' '}
                  {metrics.spendTrend === 'up' ? 'more' : 'less'} than last week
                </span>
              </span>
            </span>
          )}
        </PulseCell>

        {/* Consistency — the bridge metric (slate-teal) */}
        <PulseCell label="Consistency">
          {metrics.consistencyTotal > 0 ? (
            <>
              <span className="font-mono text-2xl font-bold tabular-nums text-habit-blue">
                {metrics.consistencyPercent}%
              </span>
              <span className="mt-1 flex items-center gap-1 text-xs font-medium text-brand-400 dark:text-brand-500">
                <Target size={12} aria-hidden="true" />
                {metrics.consistencyDone}/{metrics.consistencyTotal} today
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-2xl font-bold tabular-nums text-brand-300 dark:text-brand-600">
                —
              </span>
              <span className="mt-1 text-xs font-medium text-brand-400 dark:text-brand-500">
                no habits
              </span>
            </>
          )}
        </PulseCell>
      </div>
    </section>
  );
};

const PulseCell: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex flex-col items-center justify-center px-2 py-4 text-center">
    <span className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-brand-400 dark:text-brand-500">
      {label}
    </span>
    {children}
  </div>
);
