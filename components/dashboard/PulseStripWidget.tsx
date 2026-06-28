import React, { useMemo } from 'react';
import { useFinance, useGamification } from '@/contexts/FirebaseHouseholdContext';
import { useModuleVisibility } from '@/hooks/useModuleVisibility';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import { streakForHabit } from '@/utils/habitLogic';
import { getLocalDateString } from '@/utils/dateHelpers';
import { sumMoney, roundMoney } from '@/utils/money';
import { startOfWeek, parseISO, isSameWeek } from 'date-fns';
import { Flame, TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Section } from '@/components/ui/Section';

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

// Tailwind's JIT can only see full, literal class names, so map a cell count to
// a complete `grid-cols-N` string rather than building `grid-cols-${n}` (which
// the purge would strip). Keys cover every count this widget can render (1-3).
const GRID_COLS_BY_COUNT: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
};

export const PulseStripWidget: React.FC = () => {
  const { transactions } = useFinance();
  const { habits, weeklyPoints } = useGamification();
  const { isModuleEnabled } = useModuleVisibility();
  const fmt = useFormatCurrency();

  // Plan 090 (graceful degradation): drop the Spent cell when money is off and
  // the Points/Consistency cells when habits are off. The grid column count and
  // `divide-x` dividers follow whichever cells actually render.
  const showSpend = isModuleEnabled('money');
  const showHabits = isModuleEnabled('habits');

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

  // Stay quiet when none of the ENABLED modules have active content. This covers
  // both the "both domains off" case AND the degraded case where one domain is
  // off and the other is empty (e.g. a brand-new household) — so we never render
  // a zeroed strip just because the disabled domain has stale data.
  const hasSpendContent = showSpend && metrics.weekSpend > 0;
  const hasHabitsContent =
    showHabits &&
    (metrics.weekPoints > 0 || metrics.consistencyTotal > 0 || metrics.topStreak > 0);

  if (!hasSpendContent && !hasHabitsContent) {
    return null;
  }

  // Cell count drives the grid column count (and the divider layout, since
  // `divide-x` only paints between siblings — no stray leading/trailing rule).
  const cellCount = (showSpend ? 1 : 0) + (showHabits ? 2 : 0);
  const gridColsClass = GRID_COLS_BY_COUNT[cellCount] ?? 'grid-cols-1';

  const SpendTrendIcon =
    metrics.spendTrend === 'up'
      ? TrendingUp
      : metrics.spendTrend === 'down'
        ? TrendingDown
        : Minus;

  return (
    <Section title="This week" aria-label="This week at a glance">
      {/* A hairline-edged stat BAND on the canvas — deliberately not a rounded
          card, so it reads as a lightweight ledger strip under the hero rather
          than another peer surface competing for weight. */}
      <div
        className={cn(
          'grid divide-x divide-brand-200 dark:divide-brand-700 border-y border-brand-200 dark:border-brand-700',
          gridColsClass
        )}
      >
        {/* Points earned — the habit/gamification signal (warm) */}
        {showHabits && (
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
        )}

        {/* Spending — the money signal (evergreen) */}
        {showSpend && (
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
        )}

        {/* Consistency — the bridge metric (slate-teal) */}
        {showHabits && (
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
        )}
      </div>
    </Section>
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
