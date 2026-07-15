import React, { useMemo, useState } from 'react';
import { useFinance, useGamification } from '@/contexts/FirebaseHouseholdContext';
import {
  ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar, ComposedChart, Line, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { CustomTooltip } from '@/components/analytics/CustomTooltip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import {
  calculateHabitConsistency,
  calculateHeatmapData,
  calculatePulseData,
  calculateWeeklyComparison,
} from '@/utils/analytics/analyticsHelper';
import { calculateAggregateDayOfWeekPattern } from '@/utils/habitPatterns';

/**
 * Recharts-backed chart body for the Habits → Insights tab. Split into its own
 * module so the heavy `recharts` dependency is `React.lazy`-loaded only when the
 * Insights tab is actually opened (keeping it out of the Habits boot bundle).
 *
 * Reads the FROZEN behavior/pulse helpers (`calculateHabitConsistency`,
 * `calculateHeatmapData`, `calculatePulseData`, `calculateWeeklyComparison`).
 * Chart palette is the redesign evergreen/warm ramp (gradients are permitted
 * only inside data-viz per the spec). The Pulse charts (effort-vs-spending +
 * week-over-week) were relocated here when the Analytics modal was retired.
 *
 * A `SegmentedControl` gates which single chart is mounted at a time (instead
 * of stacking all four ~256px charts), so the tab reads as one focused view
 * with a picker rather than a long scroll. All four `useMemo` computations
 * still run unconditionally — they're cheap, and keeping them un-gated keeps
 * this diff minimal and avoids re-computing on every tab switch.
 */

type InsightsChartId = 'effort' | 'weekly' | 'balance' | 'consistency' | 'pattern';

const CHART_OPTIONS: { value: InsightsChartId; label: string }[] = [
  { value: 'effort', label: 'Effort' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'balance', label: 'Balance' },
  { value: 'consistency', label: 'Consistency' },
  { value: 'pattern', label: 'Pattern' },
];

// Evergreen heatmap ramp (replaces the generic slate→emerald set).
const HEATMAP_RAMP = ['#e3e0d8', '#b3cdbd', '#84ad97', '#356f54', '#214636'] as const;

// Shared axis/grid styling, tuned to read in both themes (brand-400 / hairline).
const AXIS_TICK = { fill: '#a8a399', fontSize: 11 } as const;
const GRID_STROKE = 'rgba(168,163,153,0.25)';

const HabitsInsightsCharts: React.FC = () => {
  const { habits } = useGamification();
  const { transactions } = useFinance();
  const [activeChart, setActiveChart] = useState<InsightsChartId>('effort');

  const radarData = useMemo(() => calculateHabitConsistency(habits), [habits]);
  const heatmapData = useMemo(() => calculateHeatmapData(habits), [habits]);
  const pulseData = useMemo(
    () => calculatePulseData(habits, transactions, 14),
    [habits, transactions]
  );
  const weeklyComparisonData = useMemo(() => calculateWeeklyComparison(habits), [habits]);
  const dayOfWeekData = useMemo(() => calculateAggregateDayOfWeekPattern(habits), [habits]);

  const totalCompletions = useMemo(
    () => heatmapData.reduce((sum, d) => sum + d.count, 0),
    [heatmapData]
  );

  return (
    <div className="space-y-6">
      <SegmentedControl
        name="Insights chart"
        value={activeChart}
        onChange={setActiveChart}
        options={CHART_OPTIONS}
      />

      {/* Effort vs spending — the cross-domain thesis chart (points bar + spend line) */}
      {activeChart === 'effort' && (
      <div className="surface-section p-6">
        <h3 className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-1">
          Effort vs. spending
        </h3>
        <p className="text-xs text-brand-400 dark:text-brand-450 mb-4">
          Daily points earned against money spent, last 14 days.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={pulseData}>
              <defs>
                <linearGradient id="insights-points-gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-warm-500)" stopOpacity={0.85} />
                  <stop offset="95%" stopColor="var(--color-warm-500)" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={10} />
              <YAxis yAxisId="left" orientation="left" hide />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip content={<CustomTooltip suffix=" pts" />} />
              <Bar
                yAxisId="left"
                dataKey="points"
                name="Points"
                fill="url(#insights-points-gradient)"
                radius={[4, 4, 0, 0]}
                barSize={20}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="spending"
                name="Spent"
                stroke="var(--color-money-neg)"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      )}

      {/* Week-over-week points */}
      {activeChart === 'weekly' && (
      <div className="surface-section p-6">
        <h3 className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-1">
          This week vs. last
        </h3>
        <p className="text-xs text-brand-400 dark:text-brand-450 mb-4">
          Daily points compared to the same day last week.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyComparisonData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={10} />
              <Tooltip content={<CustomTooltip suffix=" pts" />} />
              <Legend iconType="circle" wrapperStyle={{ paddingTop: 10, fontSize: 12 }} />
              <Bar dataKey="Last Week" fill="var(--color-brand-300)" radius={[4, 4, 4, 4]} />
              <Bar dataKey="This Week" fill="var(--color-accent-600)" radius={[4, 4, 4, 4]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      )}

      {/* Category balance radar */}
      {activeChart === 'balance' && (
      <div className="surface-section p-6">
        <h3 className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-2">
          Category balance
        </h3>
        <p className="text-xs text-brand-400 dark:text-brand-450 mb-4">
          Where your points came from over the last 90 days.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
              <PolarGrid stroke="var(--color-brand-200)" />
              <PolarAngleAxis
                dataKey="subject"
                tick={{ fill: 'var(--color-brand-500)', fontSize: 10, fontWeight: 600 }}
              />
              <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
              <Radar
                name="Points"
                dataKey="points"
                stroke="var(--color-accent-600)"
                strokeWidth={2}
                fill="var(--color-accent-500)"
                fillOpacity={0.35}
              />
              <Tooltip content={<CustomTooltip suffix=" pts" />} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
      )}

      {/* Consistency heatmap */}
      {activeChart === 'consistency' && (
      <div className="surface-section p-6">
        <h3 className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-1">
          Consistency heatmap
        </h3>
        <p className="text-xs text-brand-400 dark:text-brand-450 mb-5">
          Last 90 days · {totalCompletions} completions.
        </p>

        <div
          role="img"
          aria-label={`Habit completion heatmap for the last ${heatmapData.length} days. ${totalCompletions} total completions.`}
          className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-2 no-scrollbar"
        >
          {heatmapData.map(day => (
            <div
              key={day.date}
              aria-hidden="true"
              className="w-3 h-3 sm:w-4 sm:h-4 rounded-[3px] transition-transform hover:scale-125"
              style={{ backgroundColor: HEATMAP_RAMP[day.intensity] ?? HEATMAP_RAMP[0] }}
              title={`${day.formattedDate}: ${day.count} completions`}
            />
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 text-xxs font-bold text-brand-400 dark:text-brand-450 uppercase tracking-wide">
          <span>Less</span>
          <div className="flex gap-1">
            {HEATMAP_RAMP.map((color, i) => (
              <div key={i} className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: color }} />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
      )}

      {/* Day-of-week completion pattern — deterministic, non-AI, always-on */}
      {activeChart === 'pattern' && (
      <div className="surface-section p-6">
        <h3 className="font-display text-sm font-semibold text-brand-800 dark:text-brand-100 mb-1">
          Day-of-week pattern
        </h3>
        <p className="text-xs text-brand-400 dark:text-brand-450 mb-4">
          Which days you tend to get things done, across all habits.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dayOfWeekData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={10} />
              <Tooltip content={<CustomTooltip suffix=" completions" />} />
              <Bar dataKey="count" name="Completions" fill="var(--color-accent-600)" radius={[4, 4, 4, 4]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      )}
    </div>
  );
};

export default HabitsInsightsCharts;
