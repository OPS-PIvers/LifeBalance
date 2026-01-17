/* eslint-disable */
import React, { useState, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Flame, Activity, Target, Wallet, Brain } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer,
  Line,
  AreaChart, Area, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Legend, ComposedChart
} from 'recharts';
import {
  format, subDays, parseISO, startOfWeek, subWeeks, addDays
} from 'date-fns';
import { clsx } from 'clsx';
import { Modal } from '../ui/Modal';
import { CustomTooltip } from '../analytics/CustomTooltip';
import { calculateBurnDown } from '../../utils/analytics/financialMetrics';
import {
  calculatePulseData,
  calculateWeeklyComparison,
  calculateHabitConsistency,
  calculateHeatmapData,
  calculateCategoryTrend,
  HEATMAP_COLORS,
  CHART_COLORS
} from '../../utils/analytics/analyticsHelper';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Common chart styling
const CHART_STYLES = {
  xAxis: {
    axisLine: false,
    tickLine: false,
    tick: { fill: '#94a3b8', fontSize: 11 },
    dy: 10,
  },
  yAxis: {
    axisLine: false,
    tickLine: false,
    tick: { fill: '#94a3b8', fontSize: 11 },
  },
  cartesianGrid: {
    strokeDasharray: '3 3',
    vertical: false,
    stroke: '#f1f5f9',
  },
  tooltip: {
    cursor: { fill: '#f8fafc', opacity: 0.4 },
  },
} as const;

const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ isOpen, onClose }) => {
  const { habits, transactions, currentPeriodId, buckets } = useHousehold();
  const [activeTab, setActiveTab] = useState<'pulse' | 'behavior' | 'wallet'>('pulse');

  // ==========================================
  // VIEW 1: PULSE (OVERVIEW)
  // ==========================================

  // Hero Metrics (Kept from original)
  const weeklyProgress = useMemo(() => {
    const now = new Date();
    const currentWeekStart = startOfWeek(now, { weekStartsOn: 1 });
    const lastWeekStart = subWeeks(currentWeekStart, 1);
    const lastWeekEnd = subDays(currentWeekStart, 1);

    let currentWeekPoints = 0;
    let lastWeekPoints = 0;

    habits.forEach(habit => {
      habit.completedDates?.forEach(dateStr => {
        const date = parseISO(dateStr);
        const habitPoints = (habit as any).type === 'negative' ? -habit.basePoints : habit.basePoints;
        
        if (date >= currentWeekStart) {
          currentWeekPoints += habitPoints;
        } else if (date >= lastWeekStart && date <= lastWeekEnd) {
          lastWeekPoints += habitPoints;
        }
      });
    });

    let percentChange = 100;
    if (lastWeekPoints > 0) {
      percentChange = ((currentWeekPoints - lastWeekPoints) / lastWeekPoints) * 100;
    } else if (currentWeekPoints === 0 && lastWeekPoints === 0) {
      percentChange = 0;
    }

    return {
      current: currentWeekPoints,
      last: lastWeekPoints,
      change: Math.round(percentChange)
    };
  }, [habits]);

  const consistencyScore = useMemo(() => {
    let totalExpected = 0;
    let totalCompleted = 0;
    const thirtyDaysAgo = subDays(new Date(), 30);

    habits.forEach(habit => {
      const recentCompletions = habit.completedDates?.filter(d => parseISO(d) >= thirtyDaysAgo).length || 0;
      if (habit.period === 'daily') {
        totalExpected += 30;
      } else {
        totalExpected += Math.ceil(30 / 7);
      }
      totalCompleted += recentCompletions;
    });

    if (totalExpected === 0) return 0;
    return Math.min(Math.round((totalCompleted / totalExpected) * 100), 100);
  }, [habits]);

  const streakStats = useMemo(() => {
    const activeStreaks = habits.filter(h => h.streakDays > 0);
    return { count: activeStreaks.length };
  }, [habits]);

  // Chart A: Balance (Points vs Spending)
  const pulseData = useMemo(() => calculatePulseData(habits, transactions, 14), [habits, transactions]);

  // Chart B: Week-over-Week
  const weeklyComparisonData = useMemo(() => calculateWeeklyComparison(habits), [habits]);

  // ==========================================
  // VIEW 2: BEHAVIOR (HABITS)
  // ==========================================

  // Chart C: Consistency Radar
  const radarData = useMemo(() => calculateHabitConsistency(habits), [habits]);

  // Chart D: Heatmap
  const heatmapData = useMemo(() => calculateHeatmapData(habits), [habits]);

  // ==========================================
  // VIEW 3: WALLET (FINANCE)
  // ==========================================

  // Chart E: Burn Down
  const burnDownData = useMemo(() => {
    // Determine period. Default to last 30 days if no current period
    const start = currentPeriodId || format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const end = format(addDays(parseISO(start), 30), 'yyyy-MM-dd'); // Default to 30 day window

    // Calculate total budget (sum of bucket limits)
    // Note: detailed budget logic might be more complex (income based), but bucket limits is a good proxy for "Planned Spend"
    const totalBudget = buckets.reduce((sum, b) => sum + b.limit, 0);

    return calculateBurnDown(transactions, start, end, totalBudget || 1); // Avoid 0 budget
  }, [transactions, currentPeriodId, buckets]);

  // Chart F: Variable Expense Trend
  const { data: trendData, categories: trendCategories } = useMemo(() => calculateCategoryTrend(transactions), [transactions]);


  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="max-w-5xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white z-10">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Activity className="text-brand-600" size={24} />
            Analytics & Insights
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Track your progress and financial health</p>
        </div>
        <button onClick={onClose} aria-label="Close modal" className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors text-slate-600">
          <X size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex px-6 pt-4 pb-2 bg-white shrink-0 gap-8 border-b border-slate-100">
        {[
          { id: 'pulse', label: 'Pulse', icon: Activity },
          { id: 'behavior', label: 'Behavior', icon: Brain },
          { id: 'wallet', label: 'Wallet', icon: Wallet }
        ].map((tab) => (
          <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={clsx(
                "pb-3 text-sm font-bold transition-all relative flex items-center gap-2",
                activeTab === tab.id ? "text-brand-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <tab.icon size={16} />
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 space-y-6">

          {/* ================= PULSE TAB ================= */}
          {activeTab === 'pulse' && (
            <div className="space-y-6">

              {/* Hero Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Weekly Points */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Target size={80} />
                  </div>
                  <div className="flex justify-between items-start mb-2 relative z-10">
                    <div className="p-2 bg-brand-50 rounded-lg text-brand-600">
                      <Target size={20} />
                    </div>
                    <div className={clsx(
                      "px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1",
                      weeklyProgress.change >= 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                    )}>
                      {weeklyProgress.change >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {Math.abs(weeklyProgress.change)}%
                    </div>
                  </div>
                  <div className="text-3xl font-black text-slate-800 relative z-10">{weeklyProgress.current}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1 relative z-10">Points This Week</div>
                </div>

                {/* Consistency Score */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                     <Brain size={80} />
                  </div>
                  <div className="flex justify-between items-start mb-2 relative z-10">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                      <Activity size={20} />
                    </div>
                  </div>
                  <div className="flex items-end gap-2 relative z-10">
                    <div className="text-3xl font-black text-slate-800">{consistencyScore}%</div>
                    <div className="mb-1 text-xs font-medium text-slate-400">consistency</div>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full mt-3 overflow-hidden relative z-10">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                      style={{ width: `${consistencyScore}%` }}
                    />
                  </div>
                </div>

                {/* Active Streaks */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                    <Flame size={80} />
                  </div>
                  <div className="flex justify-between items-start mb-2 relative z-10">
                    <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
                      <Flame size={20} />
                    </div>
                  </div>
                  <div className="text-3xl font-black text-slate-800 relative z-10">{streakStats.count}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1 relative z-10">Active Streaks</div>
                </div>
              </div>

              {/* Chart A: Balance (Points vs Spending) */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6 flex items-center gap-2">
                  <Activity size={16} className="text-brand-500"/>
                  Daily Balance: Effort vs. Spending
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={pulseData}>
                      <defs>
                        <linearGradient id="pointsGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0.2}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...CHART_STYLES.cartesianGrid} />
                      <XAxis dataKey="date" {...CHART_STYLES.xAxis} />
                      <YAxis yAxisId="left" orientation="left" hide />
                      <YAxis yAxisId="right" orientation="right" hide />
                      <Tooltip content={<CustomTooltip />} {...CHART_STYLES.tooltip} />

                      {/* Points Bar (Left Axis) */}
                      <Bar
                        yAxisId="left"
                        dataKey="points"
                        name="Points"
                        fill="url(#pointsGradient)"
                        radius={[4, 4, 0, 0]}
                        barSize={24}
                      />

                      {/* Spending Line (Right Axis) */}
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="spending"
                        name="Spent"
                        stroke="#EF4444"
                        strokeWidth={3}
                        dot={false}
                        activeDot={{ r: 6, fill: '#EF4444' }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart B: Week-over-Week */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6 flex items-center gap-2">
                  <Target size={16} className="text-blue-500"/>
                  Performance: This Week vs Last
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyComparisonData}>
                      <CartesianGrid {...CHART_STYLES.cartesianGrid} />
                      <XAxis dataKey="day" {...CHART_STYLES.xAxis} />
                      <Tooltip content={<CustomTooltip />} {...CHART_STYLES.tooltip} />
                      <Legend iconType="circle" wrapperStyle={{paddingTop: 10}} />
                      <Bar dataKey="Last Week" fill="#cbd5e1" radius={[4, 4, 4, 4]} />
                      <Bar dataKey="This Week" fill="#3b82f6" radius={[4, 4, 4, 4]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}

          {/* ================= BEHAVIOR TAB ================= */}
          {activeTab === 'behavior' && (
            <div className="space-y-6">

              {/* Chart C: Consistency Radar */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-2">Category Balance</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis dataKey="subject" tick={{fill: '#64748b', fontSize: 10, fontWeight: 600}} />
                      <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                      <Radar
                        name="Points"
                        dataKey="points"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        fill="#8b5cf6"
                        fillOpacity={0.4}
                      />
                      <Tooltip content={<CustomTooltip />} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart D: Heatmap */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold text-slate-700">Consistency Heatmap (90 Days)</h3>
                </div>

                <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-2">
                  {heatmapData.map((day) => (
                    <div
                      key={day.date}
                      tabIndex={0}
                      className="w-3 h-3 sm:w-4 sm:h-4 rounded-[3px] transition-all hover:scale-125 hover:ring-2 hover:ring-offset-1 hover:ring-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      style={{
                        backgroundColor: HEATMAP_COLORS[day.intensity as keyof typeof HEATMAP_COLORS],
                      }}
                      title={`${day.formattedDate}: ${day.count} completions`}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  <span>Less</span>
                  <div className="flex gap-1">
                    {[0,1,2,3,4].map(i => (
                        <div key={i} className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: HEATMAP_COLORS[i as keyof typeof HEATMAP_COLORS] }} />
                    ))}
                  </div>
                  <span>More</span>
                </div>
              </div>

            </div>
          )}

          {/* ================= WALLET TAB ================= */}
          {activeTab === 'wallet' && (
            <div className="space-y-6">

              {/* Chart E: Burn Down */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6 flex items-center gap-2">
                  <Wallet size={16} className="text-red-500"/>
                  Budget Burn-Down
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={burnDownData}>
                       <CartesianGrid {...CHART_STYLES.cartesianGrid} />
                       <XAxis dataKey="day" {...CHART_STYLES.xAxis} />
                       <YAxis hide />
                       <Tooltip content={<CustomTooltip formatter={(val: number) => `$${val.toLocaleString()}`} />} />

                       {/* Ideal Pacing (Reference Line) */}
                       <Line
                         type="linear"
                         dataKey="idealPacing"
                         name="Ideal Limit"
                         stroke="#94a3b8"
                         strokeDasharray="5 5"
                         strokeWidth={2}
                         dot={false}
                       />

                       {/* Budget Cap (Reference Line) */}
                       <Line
                         type="linear"
                         dataKey="budget"
                         name="Budget Cap"
                         stroke="#ef4444"
                         strokeWidth={1}
                         strokeOpacity={0.5}
                         dot={false}
                       />

                       {/* Actual Spending */}
                       <Line
                         type="monotone"
                         dataKey="spent"
                         name="Actual Spent"
                         stroke="#3b82f6"
                         strokeWidth={3}
                         dot={{r: 4, fill: '#3b82f6'}}
                       />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart F: Variable Expense Trend */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6">Variable Expense Trend (6 Months)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData}>
                      <defs>
                        {trendCategories.map((cat, idx) => (
                           <linearGradient key={cat} id={`gradient-${idx}`} x1="0" y1="0" x2="0" y2="1">
                             <stop offset="5%" stopColor={CHART_COLORS[idx % CHART_COLORS.length]} stopOpacity={0.8}/>
                             <stop offset="95%" stopColor={CHART_COLORS[idx % CHART_COLORS.length]} stopOpacity={0.1}/>
                           </linearGradient>
                        ))}
                         <linearGradient id="gradient-other" x1="0" y1="0" x2="0" y2="1">
                             <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.8}/>
                             <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.1}/>
                           </linearGradient>
                      </defs>
                      <CartesianGrid {...CHART_STYLES.cartesianGrid} />
                      <XAxis dataKey="month" {...CHART_STYLES.xAxis} />
                      <Tooltip content={<CustomTooltip formatter={(val: number) => `$${val.toLocaleString()}`} />} />

                      {trendCategories.map((cat, idx) => (
                        <Area
                          key={cat}
                          type="monotone"
                          dataKey={cat}
                          stackId="1"
                          stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                          fill={`url(#gradient-${idx})`}
                        />
                      ))}
                      <Area
                          key="Other"
                          type="monotone"
                          dataKey="Other"
                          stackId="1"
                          stroke="#94a3b8"
                          fill="url(#gradient-other)"
                        />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

            </div>
          )}

        </div>
    </Modal>
  );
};

export default AnalyticsModal;
