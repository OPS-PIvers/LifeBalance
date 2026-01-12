import React, { useState, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Flame, Award, Calendar, DollarSign, Activity, Target, ArrowRight } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip,
  LineChart, Line, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Legend, ComposedChart
} from 'recharts';
import {
  format, subDays, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, parseISO, differenceInDays, startOfWeek, subWeeks,
  getISOWeek, addDays, isSameWeek, subMonths
} from 'date-fns';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Custom Tooltip Component
const CustomTooltip = ({ active, payload, label, formatter, suffix = '' }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-slate-100 shadow-xl rounded-xl z-[70]">
        <p className="text-xs font-bold text-slate-500 mb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
            <span className="font-medium text-slate-700">
              {entry.name}: {formatter ? formatter(entry.value) : entry.value}{suffix}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ isOpen, onClose }) => {
  const { habits, transactions, buckets } = useHousehold();
  const [activeTab, setActiveTab] = useState<'overview' | 'habits' | 'spending'>('overview');

  // ==========================================
  // 1. OVERVIEW DATA
  // ==========================================

  // Hero Metric: Weekly Points Comparison
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
        if (date >= currentWeekStart) {
          currentWeekPoints += habit.basePoints;
        } else if (date >= lastWeekStart && date <= lastWeekEnd) {
          lastWeekPoints += habit.basePoints;
        }
      });
    });

    const percentChange = lastWeekPoints > 0
      ? ((currentWeekPoints - lastWeekPoints) / lastWeekPoints) * 100
      : 100;

    return {
      current: currentWeekPoints,
      last: lastWeekPoints,
      change: Math.round(percentChange)
    };
  }, [habits]);

  // Consistency Score (Last 30 Days)
  const consistencyScore = useMemo(() => {
    let totalExpected = 0;
    let totalCompleted = 0;
    const thirtyDaysAgo = subDays(new Date(), 30);

    habits.forEach(habit => {
      // Only count active habits
      if (habit.period === 'daily') {
        // Simple estimation: 30 days * target count (usually 1)
        totalExpected += 30;
      } else {
        // Weekly: 4 weeks
        totalExpected += 4;
      }

      const recentCompletions = habit.completedDates?.filter(d => parseISO(d) >= thirtyDaysAgo).length || 0;
      totalCompleted += recentCompletions;
    });

    if (totalExpected === 0) return 0;
    return Math.min(Math.round((totalCompleted / totalExpected) * 100), 100);
  }, [habits]);

  // Activity Sparkline (Last 14 Days)
  const activityTrend = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, i) => {
      const date = subDays(new Date(), 13 - i);
      return format(date, 'yyyy-MM-dd');
    });

    return days.map(dateStr => {
      let points = 0;
      habits.forEach(h => {
        if (h.completedDates?.includes(dateStr)) {
          points += h.basePoints;
        }
      });
      return { date: format(parseISO(dateStr), 'MMM d'), points };
    });
  }, [habits]);

  // Streak Stats
  const streakStats = useMemo(() => {
    const activeStreaks = habits.filter(h => h.streakDays > 0);
    const longestStreak = Math.max(...habits.map(h => h.streakDays), 0);

    // Sort streaks for "Top Performers"
    const topStreaks = [...habits]
      .sort((a, b) => b.streakDays - a.streakDays)
      .slice(0, 3)
      .filter(h => h.streakDays > 0);

    return {
      count: activeStreaks.length,
      longest: longestStreak,
      top: topStreaks
    };
  }, [habits]);

  // ==========================================
  // 2. HABITS DATA
  // ==========================================

  // Heatmap Data (Last 90 Days)
  const heatmapData = useMemo(() => {
    const endDate = new Date();
    const startDate = subDays(endDate, 89); // 90 days total
    const days = eachDayOfInterval({ start: startDate, end: endDate });

    // Find max completions in a single day for normalization
    let maxCompletions = 0;
    const dailyCounts = new Map<string, number>();

    habits.forEach(habit => {
      habit.completedDates?.forEach(date => {
        dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
      });
    });

    dailyCounts.forEach(count => {
      if (count > maxCompletions) maxCompletions = count;
    });

    return days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const count = dailyCounts.get(dateStr) || 0;

      // Calculate intensity (0-4 scale like GitHub)
      let intensity = 0;
      if (count > 0) {
        if (count >= maxCompletions * 0.75) intensity = 4;
        else if (count >= maxCompletions * 0.5) intensity = 3;
        else if (count >= maxCompletions * 0.25) intensity = 2;
        else intensity = 1;
      }

      return {
        date: dateStr,
        dayName: format(day, 'EEE'), // Mon, Tue...
        formattedDate: format(day, 'MMM d, yyyy'),
        count,
        intensity
      };
    });
  }, [habits]);

  // Day of Week Performance
  const dayOfWeekData = useMemo(() => {
    const dayCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat

    habits.forEach(habit => {
      habit.completedDates?.forEach(dateStr => {
        const dayIndex = parseISO(dateStr).getDay();
        dayCounts[dayIndex]++;
      });
    });

    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days.map((day, i) => ({
      day,
      completions: dayCounts[i],
      fullMark: 100 // Just for visual background ref if needed
    }));
  }, [habits]);

  // Category Radar
  const categoryRadarData = useMemo(() => {
    const categoryStats = new Map<string, number>();

    habits.forEach(habit => {
      const points = habit.totalCount * habit.basePoints;
      categoryStats.set(habit.category, (categoryStats.get(habit.category) || 0) + points);
    });

    return Array.from(categoryStats.entries())
      .map(([subject, A]) => ({ subject, A }))
      .sort((a, b) => b.A - a.A)
      .slice(0, 6); // Top 6 categories
  }, [habits]);

  // Success Rates
  const successRates = useMemo(() => {
    return habits
      .map(habit => {
        const completions = habit.completedDates?.length || 0;
        if (completions === 0) return null;

        // Very rough estimate of "success rate" based on assumption of daily/weekly intent
        // since creation. A perfect calc requires creation date which we might not have reliable access to in old data.
        // We'll use a simplified metric: Streak vs Age or just recent consistency.
        // Let's stick to the previous implementation's logic but refined.
        const firstDate = habit.completedDates?.[habit.completedDates.length - 1];
        if (!firstDate) return null;

        const daysActive = Math.max(differenceInDays(new Date(), parseISO(firstDate)), 1);
        const expected = habit.period === 'daily' ? daysActive : Math.ceil(daysActive / 7);
        const rate = Math.min(Math.round((completions / expected) * 100), 100);

        return {
          name: habit.title,
          rate,
          count: completions
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.rate || 0) - (a?.rate || 0))
      .slice(0, 5);
  }, [habits]);

  // ==========================================
  // 3. FINANCIAL DATA
  // ==========================================

  // Net Flow (Income vs Expense) - Last 6 Months
  const netFlowData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = subMonths(new Date(), 5 - i); // 5 months ago to now
      return format(d, 'yyyy-MM');
    });

    const data = months.map(monthKey => {
      let income = 0;
      let expense = 0;

      transactions
        .filter(t => t.date.startsWith(monthKey))
        .forEach(t => {
          if (t.category === 'Income') {
            income += t.amount;
          } else {
            expense += t.amount;
          }
        });

      return {
        month: format(parseISO(monthKey + '-01'), 'MMM'),
        Income: Math.round(income),
        Expense: Math.round(expense),
        Net: Math.round(income - expense)
      };
    });

    return data;
  }, [transactions]);

  // Spending Trend (Area Chart)
  const spendingTrend = useMemo(() => {
    return netFlowData.map(d => ({
      name: d.month,
      Amount: d.Expense
    }));
  }, [netFlowData]);

  // Category Breakdown
  const spendingCategories = useMemo(() => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const totals = new Map<string, number>();
    let totalSpent = 0;

    transactions
      .filter(t => t.date >= thirtyDaysAgo && t.category !== 'Income')
      .forEach(t => {
        totals.set(t.category, (totals.get(t.category) || 0) + t.amount);
        totalSpent += t.amount;
      });

    const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1'];

    return Array.from(totals.entries())
      .map(([name, value], index) => ({
        name,
        value: Math.round(value),
        percent: totalSpent > 0 ? Math.round((value / totalSpent) * 100) : 0,
        fill: COLORS[index % COLORS.length]
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [transactions]);


  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-h-[calc(100dvh-6rem)] sm:max-h-[85vh] max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0 bg-white z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Activity className="text-brand-600" size={24} />
              Analytics & Insights
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">Track your progress and financial health</p>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors text-slate-600">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-6 pt-4 pb-2 bg-white shrink-0 gap-8 border-b border-slate-100">
          {['overview', 'habits', 'spending'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={clsx(
                "pb-3 text-sm font-bold transition-all relative capitalize",
                activeTab === tab ? "text-brand-600" : "text-slate-400 hover:text-slate-600"
              )}
            >
              {tab}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-t-full" />
              )}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 space-y-6">

          {/* ================= OVERVIEW TAB ================= */}
          {activeTab === 'overview' && (
            <div className="space-y-6">

              {/* Hero Section */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Weekly Points */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-start mb-2">
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
                  <div className="text-3xl font-black text-slate-800">{weeklyProgress.current}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">Points This Week</div>
                </div>

                {/* Consistency Score */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-start mb-2">
                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                      <Activity size={20} />
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="text-3xl font-black text-slate-800">{consistencyScore}%</div>
                    <div className="mb-1 text-xs font-medium text-slate-400">consistency</div>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full mt-3 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                      style={{ width: `${consistencyScore}%` }}
                    />
                  </div>
                </div>

                {/* Active Streaks */}
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
                  <div className="flex justify-between items-start mb-2">
                    <div className="p-2 bg-orange-50 rounded-lg text-orange-600">
                      <Flame size={20} />
                    </div>
                  </div>
                  <div className="text-3xl font-black text-slate-800">{streakStats.count}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-1">Active Streaks</div>
                </div>
              </div>

              {/* Activity Trend Chart */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6">Daily Activity (14 Days)</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={activityTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{fill: '#94a3b8', fontSize: 10}}
                        dy={10}
                      />
                      <Tooltip content={<CustomTooltip suffix=" pts" />} cursor={{fill: '#f8fafc'}} />
                      <Bar
                        dataKey="points"
                        fill="#6366f1"
                        radius={[4, 4, 0, 0]}
                        barSize={24}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top Streaks */}
              {streakStats.top.length > 0 && (
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-700 mb-4">Top Performers</h3>
                  <div className="space-y-3">
                    {streakStats.top.map((habit, idx) => (
                      <div key={habit.id} className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl">
                        <div className="w-8 h-8 flex items-center justify-center bg-white rounded-full shadow-sm text-sm font-bold text-slate-500">
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-slate-700">{habit.title}</div>
                          <div className="text-xs text-slate-400">{habit.category}</div>
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">
                          <Flame size={12} fill="currentColor" />
                          {habit.streakDays} days
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= HABITS TAB ================= */}
          {activeTab === 'habits' && (
            <div className="space-y-6">

              {/* Heatmap */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-sm font-bold text-slate-700">Consistency Heatmap</h3>
                  <span className="text-xs font-medium text-slate-400">Last 90 Days</span>
                </div>

                <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-2">
                  {heatmapData.map((day) => (
                    <div
                      key={day.date}
                      className="w-3 h-3 sm:w-4 sm:h-4 rounded-[3px] transition-all hover:scale-125 hover:ring-2 hover:ring-offset-1 hover:ring-brand-200"
                      style={{
                        backgroundColor:
                          day.intensity === 0 ? '#f1f5f9' :
                          day.intensity === 1 ? '#d1fae5' : // 100
                          day.intensity === 2 ? '#6ee7b7' : // 300
                          day.intensity === 3 ? '#10b981' : // 500
                          '#047857',                        // 700
                      }}
                      title={`${day.formattedDate}: ${day.count} completions`}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-end gap-2 mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  <span>Less</span>
                  <div className="flex gap-1">
                    <div className="w-3 h-3 rounded-[2px] bg-slate-100" />
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-100" />
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-300" />
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-500" />
                    <div className="w-3 h-3 rounded-[2px] bg-emerald-700" />
                  </div>
                  <span>More</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Day of Week */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-700 mb-6">Weekly Rhythm</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dayOfWeekData}>
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#94a3b8'}} />
                        <Tooltip content={<CustomTooltip suffix=" completions" />} cursor={{fill: '#f8fafc'}} />
                        <Bar dataKey="completions" fill="#3b82f6" radius={[4, 4, 4, 4]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Category Radar */}
                <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                  <h3 className="text-sm font-bold text-slate-700 mb-2">Category Balance</h3>
                  <div className="h-52 -ml-6">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius="70%" data={categoryRadarData}>
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="subject" tick={{fill: '#64748b', fontSize: 10, fontWeight: 600}} />
                        <PolarRadiusAxis angle={30} domain={[0, 'auto']} tick={false} axisLine={false} />
                        <Radar
                          name="Points"
                          dataKey="A"
                          stroke="#8b5cf6"
                          strokeWidth={2}
                          fill="#8b5cf6"
                          fillOpacity={0.4}
                        />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Success Rates */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-4">Habit Success Rates</h3>
                <div className="space-y-4">
                  {successRates.map((habit) => (
                    <div key={habit.name}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-bold text-slate-700">{habit.name}</span>
                        <span className="text-xs font-bold text-slate-500">{habit.rate}%</span>
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            "h-full rounded-full",
                            habit.rate >= 80 ? "bg-emerald-500" :
                            habit.rate >= 50 ? "bg-blue-500" : "bg-amber-500"
                          )}
                          style={{ width: `${habit.rate}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================= SPENDING TAB ================= */}
          {activeTab === 'spending' && (
            <div className="space-y-6">

              {/* Net Flow Chart */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6">Income vs Expense (6 Months)</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={netFlowData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} dy={10} />
                      <YAxis hide />
                      <Tooltip content={<CustomTooltip formatter={(val: number) => `$${val.toLocaleString()}`} />} cursor={{fill: '#f8fafc'}} />
                      <Legend iconType="circle" wrapperStyle={{paddingTop: 20}} />
                      <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} barSize={20} />
                      <Bar dataKey="Expense" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
                      <Line type="monotone" dataKey="Net" stroke="#6366f1" strokeWidth={2} dot={{r: 4, fill: '#6366f1'}} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Spending Trend */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-6">Spending Trend</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={spendingTrend}>
                      <defs>
                        <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} />
                      <Tooltip content={<CustomTooltip formatter={(val: number) => `$${val.toLocaleString()}`} />} />
                      <Area type="monotone" dataKey="Amount" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" strokeWidth={3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Category Breakdown */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
                <h3 className="text-sm font-bold text-slate-700 mb-4">Top Spending Categories</h3>
                <div className="flex flex-col sm:flex-row items-center gap-8">
                  <div className="h-48 w-48 shrink-0 relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={spendingCategories}
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {spendingCategories.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.fill} strokeWidth={0} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip formatter={(val: number) => `$${val.toLocaleString()}`} />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex items-center justify-center flex-col pointer-events-none">
                      <span className="text-xs text-slate-400 font-bold uppercase">Total</span>
                      <span className="text-lg font-black text-slate-800">
                        ${Math.round(spendingCategories.reduce((acc, curr) => acc + curr.value, 0)).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 w-full space-y-2">
                    {spendingCategories.map((item) => (
                      <div key={item.name} className="flex items-center gap-3">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
                        <div className="flex-1 text-sm font-bold text-slate-700 truncate">{item.name}</div>
                        <div className="text-sm font-medium text-slate-500">{item.percent}%</div>
                        <div className="text-sm font-bold text-slate-800 w-16 text-right">${item.value.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default AnalyticsModal;