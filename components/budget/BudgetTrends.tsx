import React, { useEffect, useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import {
  XAxis, YAxis, Tooltip,
  ResponsiveContainer,
  Line,
  AreaChart, Area, CartesianGrid,
  ComposedChart,
} from 'recharts';
import { format, subDays, parseISO, addDays } from 'date-fns';
import { Wallet, TrendingUp } from 'lucide-react';
import { sumMoney } from '@/utils/money';
import { CustomTooltip } from '@/components/analytics/CustomTooltip';
import { calculateBurnDown } from '@/utils/analytics/financialMetrics';
import { calculateCategoryTrend } from '@/utils/analytics/analyticsHelper';
import { Section } from '@/components/ui/Section';
import { usePowerToolsEnabled } from '@/hooks/usePowerToolsEnabled';
import BudgetHistory from './BudgetHistory';

/**
 * The Wallet charts (burn-down + variable-expense trend), which now live in the
 * Money domain's "Trends" tab (the former Analytics modal has been retired).
 * This reads from the FROZEN analytics helpers unchanged.
 *
 * Editorial-finance styling: solid grouped surfaces, hairline borders, no glass
 * or heavy shadows. Chart fills use the evergreen money accent (gradients are
 * permitted ONLY inside data-viz per the spec). Both themes are first-class —
 * axis/grid colors are tuned to read on the paper-light and brand-900 dark bg.
 */

// Evergreen money ramp for the trend areas; deepest for the top category.
const TREND_COLORS = ['#285742', '#356f54', '#538a70', '#84ad97', '#b3cdbd'];
const OTHER_COLOR = '#a8a399'; // brand-400

// Axis/grid styling shared by both charts. Uses brand-400 so ticks read in both
// themes without a JS theme lookup.
const AXIS_TICK = { fill: '#a8a399', fontSize: 11 } as const;
const GRID_STROKE = 'rgba(168,163,153,0.25)';

const ChartCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <div className="surface-section p-5">
    <h3 className="font-display text-sm font-semibold tracking-tight text-brand-800 dark:text-brand-100 mb-5 flex items-center gap-2">
      <span className="text-accent-600 dark:text-accent-300">{icon}</span>
      {title}
    </h3>
    <div className="h-64">{children}</div>
  </div>
);

const EmptyChart: React.FC<{ message: string }> = ({ message }) => (
  <div className="h-full flex items-center justify-center text-center px-6">
    <p className="text-sm text-brand-400 dark:text-brand-450 max-w-xs">{message}</p>
  </div>
);

const BudgetTrends: React.FC = () => {
  const { transactions, currentPeriodId, buckets, loadAllTransactions } = useFinance();
  const powerToolsEnabled = usePowerToolsEnabled();
  const fmt = useFormatCurrency();

  // The trend charts span up to 6 months — load the full transaction history
  // (beyond the live 90-day window) when this tab mounts so trends aren't
  // truncated. loadAllTransactions is a read-only loader (no logic change).
  useEffect(() => {
    loadAllTransactions();
  }, [loadAllTransactions]);

  // Chart A: Budget Burn-Down
  const burnDownData = useMemo(() => {
    const start = currentPeriodId || format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const end = format(addDays(parseISO(start), 30), 'yyyy-MM-dd');
    const totalBudget = sumMoney(buckets.map(b => b.limit));
    if (totalBudget <= 0) return [];
    return calculateBurnDown(transactions, start, end, totalBudget);
  }, [transactions, currentPeriodId, buckets]);

  // Chart B: Variable Expense Trend (6 months)
  const { data: trendData, categories: trendCategories } = useMemo(
    () => calculateCategoryTrend(transactions),
    [transactions]
  );

  const hasTrendData = trendData.some(row =>
    [...trendCategories, 'Other'].some(key => (row[key] as number) > 0)
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-(--duration-base)">
      <Section title="Wallet trends">
      <div className="space-y-4">
        {/* Chart A: Burn Down */}
        <ChartCard title="Budget burn-down" icon={<Wallet size={16} />}>
          {burnDownData.length === 0 ? (
            <EmptyChart message="Set bucket limits to see how your spending paces against the budget over the period." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={burnDownData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={10} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip formatter={(val: number) => fmt(val)} />} />

                {/* Ideal pacing reference */}
                <Line
                  type="linear"
                  dataKey="idealPacing"
                  name="Ideal pace"
                  stroke="#a8a399"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                  dot={false}
                />
                {/* Budget cap reference */}
                <Line
                  type="linear"
                  dataKey="budget"
                  name="Budget cap"
                  stroke="#d4483f"
                  strokeWidth={1}
                  strokeOpacity={0.5}
                  dot={false}
                />
                {/* Actual cumulative spend */}
                <Line
                  type="monotone"
                  dataKey="spent"
                  name="Actual spent"
                  stroke="#285742"
                  strokeWidth={3}
                  dot={{ r: 3, fill: '#285742' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Chart B: Variable Expense Trend */}
        <ChartCard title="Expense trend (6 months)" icon={<TrendingUp size={16} />}>
          {!hasTrendData ? (
            <EmptyChart message="As you log more spending, your category trends will chart here across the last six months." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  {trendCategories.map((cat, idx) => (
                    <linearGradient key={cat} id={`trend-gradient-${idx}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={TREND_COLORS[idx % TREND_COLORS.length]} stopOpacity={0.85} />
                      <stop offset="95%" stopColor={TREND_COLORS[idx % TREND_COLORS.length]} stopOpacity={0.1} />
                    </linearGradient>
                  ))}
                  <linearGradient id="trend-gradient-other" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={OTHER_COLOR} stopOpacity={0.7} />
                    <stop offset="95%" stopColor={OTHER_COLOR} stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={10} />
                <Tooltip content={<CustomTooltip formatter={(val: number) => fmt(val)} />} />

                {trendCategories.map((cat, idx) => (
                  <Area
                    key={cat}
                    type="monotone"
                    dataKey={cat}
                    stackId="1"
                    stroke={TREND_COLORS[idx % TREND_COLORS.length]}
                    fill={`url(#trend-gradient-${idx})`}
                  />
                ))}
                <Area
                  key="Other"
                  type="monotone"
                  dataKey="Other"
                  stackId="1"
                  stroke={OTHER_COLOR}
                  fill="url(#trend-gradient-other)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
      </Section>

      {/* Period (paycheck) history — the retrospective companion to the trends. */}
      {powerToolsEnabled && <BudgetHistory />}
    </div>
  );
};

export default BudgetTrends;
