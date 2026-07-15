import React, { useMemo } from 'react';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { useFormatCurrency } from '@/hooks/useFormatCurrency';
import {
  XAxis, YAxis, Tooltip,
  ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from 'recharts';
import { format } from 'date-fns';
import { PiggyBank } from 'lucide-react';
import { CustomTooltip } from '@/components/analytics/CustomTooltip';

/**
 * Net worth trend chart (F-MONEY-09). Reads the bounded live window of
 * server-written daily `NetWorthSnapshot` docs (`netWorthHistory`, newest
 * first) and plots them oldest-first. Matches the editorial styling of the
 * sibling charts in `BudgetTrends.tsx` (evergreen area fill, hairline grid).
 */

const AXIS_TICK = { fill: '#a8a399', fontSize: 11 } as const;
const GRID_STROKE = 'rgba(168,163,153,0.25)';
const LINE_COLOR = '#285742'; // accent-800 (evergreen)

const NetWorthTrendChart: React.FC = () => {
  const { netWorthHistory } = useFinance();
  const fmt = useFormatCurrency();

  const data = useMemo(
    () =>
      [...netWorthHistory]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map(snapshot => {
          // Parse the yyyy-MM-dd string as a local date (not UTC via parseISO)
          // to avoid shifting the displayed day back for users west of UTC.
          const [year, month, day] = snapshot.date.split('-').map(Number);
          return {
            day: format(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1), 'MMM d'),
            netWorth: snapshot.netWorth,
          };
        }),
    [netWorthHistory]
  );

  const chartLabel = useMemo(() => {
    if (data.length === 0) return 'Net worth trend chart.';
    const first = data[0];
    const last = data[data.length - 1];
    if (!first || !last) return 'Net worth trend chart.';
    const direction = last.netWorth >= first.netWorth ? 'up' : 'down';
    return `Net worth trend chart. From ${first.day} to ${last.day}, net worth moved ${direction} to ${fmt(last.netWorth)}.`;
  }, [data, fmt]);

  return (
    <div className="surface-section p-5">
      <h3 className="font-display text-sm font-semibold tracking-tight text-brand-800 dark:text-brand-100 mb-5 flex items-center gap-2">
        <span className="text-accent-600 dark:text-accent-300"><PiggyBank size={16} /></span>
        Net worth
      </h3>
      <div className="h-64">
        {data.length < 2 ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <p className="text-sm text-brand-400 dark:text-brand-450 max-w-xs">
              Net worth is snapshotted once daily — check back tomorrow to start seeing a trend here.
            </p>
          </div>
        ) : (
          <div role="img" aria-label={chartLabel} className="h-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="net-worth-gradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={LINE_COLOR} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={LINE_COLOR} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={10} />
                <YAxis hide />
                <Tooltip content={<CustomTooltip formatter={(val: number) => fmt(val)} />} />
                <Area
                  type="monotone"
                  dataKey="netWorth"
                  name="Net worth"
                  stroke={LINE_COLOR}
                  strokeWidth={2}
                  fill="url(#net-worth-gradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default NetWorthTrendChart;
