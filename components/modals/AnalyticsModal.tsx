import React, { useState, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Flame, Award, Calendar } from 'lucide-react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, parseISO, differenceInDays } from 'date-fns';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ isOpen, onClose }) => {
  const { habits, transactions, buckets } = useHousehold();
  const [activeTab, setActiveTab] = useState<'week' | 'lifetime' | 'financial'>('week');

  // ===== WEEK VIEW DATA =====
  const last7Days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 7 }, (_, i) => {
      const date = subDays(today, 6 - i);
      return format(date, 'yyyy-MM-dd');
    });
  }, []);

  // Streak Status
  const streakStats = useMemo(() => {
    const activeStreaks = habits.filter(h => h.streakDays > 0);
    const longestStreak = Math.max(...habits.map(h => h.streakDays), 0);
    const atRisk = habits.filter(h => {
      if (h.streakDays === 0) return false;
      const lastCompleted = h.completedDates?.[h.completedDates.length - 1];
      if (!lastCompleted) return false;
      const daysSince = differenceInDays(new Date(), parseISO(lastCompleted));
      return daysSince >= 1;
    });

    return {
      activeStreaks: activeStreaks.length,
      longestStreak,
      atRisk: atRisk.length,
      atRiskHabits: atRisk.map(h => h.title)
    };
  }, [habits]);

  // Category Performance (past 7 days)
  // Uses actual submission data when available for accurate point tracking
  const categoryPerformance = useMemo(() => {
    const categoryMap = new Map<string, { completions: number; points: number; count: number }>();

    habits.forEach(habit => {
      const recentCompletions = habit.completedDates?.filter(d => last7Days.includes(d)).length || 0;
      if (recentCompletions > 0) {
        const current = categoryMap.get(habit.category) || { completions: 0, points: 0, count: 0 };

        // Calculate accurate points based on scoring type and multipliers
        // Note: This is an approximation since we don't have historical multipliers here
        // For truly accurate tracking, individual submissions should be queried
        let estimatedPoints = 0;
        if (habit.scoringType === 'incremental') {
          // Incremental: count all actions across the week
          const totalActions = habit.completedDates
            ?.filter(d => last7Days.includes(d))
            .reduce((sum) => {
              // Estimate: assume average multiplier based on current streak
              const multiplier = habit.streakDays >= 7 ? 2.0 : habit.streakDays >= 3 ? 1.5 : 1.0;
              return sum + (habit.basePoints * multiplier);
            }, 0) || 0;
          estimatedPoints = totalActions;
        } else {
          // Threshold: points per completion day
          const multiplier = habit.streakDays >= 7 ? 2.0 : habit.streakDays >= 3 ? 1.5 : 1.0;
          estimatedPoints = recentCompletions * (habit.basePoints * multiplier);
        }

        categoryMap.set(habit.category, {
          completions: current.completions + recentCompletions,
          points: current.points + Math.floor(estimatedPoints),
          count: current.count + 1
        });
      }
    });

    return Array.from(categoryMap.entries())
      .map(([category, data]) => ({
        category,
        completions: data.completions,
        points: data.points
      }))
      .sort((a, b) => b.points - a.points);
  }, [habits, last7Days]);

  // Sentiment Pie
  const sentimentData = useMemo(() => {
    const positiveCount = habits.filter(h => h.type === 'positive').length;
    const negativeCount = habits.filter(h => h.type === 'negative').length;
    return [
      { name: 'Positive', value: positiveCount, color: '#10B981' },
      { name: 'Negative', value: negativeCount, color: '#F43F5E' },
    ];
  }, [habits]);

  // Top Habits (by total count)
  const frequencyData = useMemo(() => {
    return [...habits]
      .sort((a, b) => b.totalCount - a.totalCount)
      .slice(0, 5)
      .map(h => ({
        name: h.title.split(' ').slice(0, 2).join(' '), // First 2 words
        count: h.totalCount
      }));
  }, [habits]);

  // ===== LIFETIME VIEW DATA =====

  // Weekly Trend - Real data from habit completions
  const trendData = useMemo(() => {
    const allCompletions: { date: Date; points: number }[] = [];

    habits.forEach(habit => {
      habit.completedDates?.forEach(dateStr => {
        const date = new Date(dateStr);
        allCompletions.push({ date, points: habit.basePoints });
      });
    });

    allCompletions.sort((a, b) => a.date.getTime() - b.date.getTime());

    if (allCompletions.length === 0) {
      return [{ week: 'No data', points: 0 }];
    }

    const weeklyPoints = new Map<string, number>();

    allCompletions.forEach(({ date, points }) => {
      const weekStart = new Date(date);
      const day = weekStart.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      weekStart.setDate(weekStart.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);

      const weekKey = weekStart.toISOString().split('T')[0];
      weeklyPoints.set(weekKey, (weeklyPoints.get(weekKey) || 0) + points);
    });

    const sortedWeeks = Array.from(weeklyPoints.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12);

    return sortedWeeks.map(([weekStart, points], idx) => ({
      week: `W${idx + 1}`,
      points,
      fullDate: weekStart
    }));
  }, [habits]);

  // Day of Week Performance
  const dayData = useMemo(() => {
    const dayTotals = new Map<number, { total: number; count: number }>();

    habits.forEach(habit => {
      habit.completedDates?.forEach(dateStr => {
        const date = new Date(dateStr);
        const dayOfWeek = date.getDay();

        const current = dayTotals.get(dayOfWeek) || { total: 0, count: 0 };
        dayTotals.set(dayOfWeek, {
          total: current.total + habit.basePoints,
          count: current.count + 1
        });
      });
    });

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = [];

    for (let i = 1; i <= 7; i++) {
      const dayIndex = i % 7;
      const data = dayTotals.get(dayIndex);
      result.push({
        day: dayNames[dayIndex],
        avg: data ? Math.round(data.total / data.count) : 0
      });
    }

    return result;
  }, [habits]);

  // Success Rate by Habit
  const habitSuccessRates = useMemo(() => {
    return habits
      .map(habit => {
        const totalDays = habit.completedDates?.length || 0;
        const firstDate = habit.completedDates?.[0];
        if (!firstDate) return null;

        const daysSinceStart = differenceInDays(new Date(), parseISO(firstDate));
        const expectedCompletions = habit.period === 'daily' ? daysSinceStart : Math.floor(daysSinceStart / 7);
        const successRate = expectedCompletions > 0 ? (totalDays / expectedCompletions) * 100 : 0;

        return {
          name: habit.title.split(' ').slice(0, 2).join(' '),
          rate: Math.min(successRate, 100)
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b?.rate || 0) - (a?.rate || 0))
      .slice(0, 5);
  }, [habits]);

  // Monthly Heatmap (last 90 days)
  const heatmapData = useMemo(() => {
    const days = eachDayOfInterval({
      start: subDays(new Date(), 89),
      end: new Date()
    });

    return days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      let completions = 0;

      habits.forEach(habit => {
        if (habit.completedDates?.includes(dateStr)) {
          completions++;
        }
      });

      return {
        date: dateStr,
        day: format(day, 'MMM d'),
        completions,
        intensity: completions === 0 ? 0 : Math.min(completions / 3, 1) // Normalize to 0-1
      };
    });
  }, [habits]);

  // Best/Worst Months
  const monthlyStats = useMemo(() => {
    const monthlyData = new Map<string, { points: number; completions: number }>();

    habits.forEach(habit => {
      habit.completedDates?.forEach(dateStr => {
        const monthKey = dateStr.substring(0, 7); // YYYY-MM
        const current = monthlyData.get(monthKey) || { points: 0, completions: 0 };
        monthlyData.set(monthKey, {
          points: current.points + habit.basePoints,
          completions: current.completions + 1
        });
      });
    });

    const sorted = Array.from(monthlyData.entries())
      .map(([month, data]) => ({
        month: format(parseISO(month + '-01'), 'MMM yyyy'),
        ...data
      }))
      .sort((a, b) => b.points - a.points);

    return {
      best: sorted[0],
      worst: sorted[sorted.length - 1]
    };
  }, [habits]);

  // ===== FINANCIAL VIEW DATA =====

  // Spending by Category (last 30 days)
  const spendingByCategory = useMemo(() => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const categorySpending = new Map<string, number>();

    transactions
      .filter(t => t.date >= thirtyDaysAgo)
      .forEach(t => {
        categorySpending.set(t.category, (categorySpending.get(t.category) || 0) + t.amount);
      });

    return Array.from(categorySpending.entries())
      .map(([category, amount]) => ({
        category,
        amount: Math.round(amount)
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);
  }, [transactions]);

  // Monthly Spending Trend (last 6 months)
  const monthlySpending = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const date = subDays(new Date(), i * 30);
      return {
        key: format(startOfMonth(date), 'yyyy-MM'),
        label: format(date, 'MMM')
      };
    }).reverse();

    return months.map(({ key, label }) => {
      const total = transactions
        .filter(t => t.date.startsWith(key))
        .reduce((sum, t) => sum + t.amount, 0);

      return {
        month: label,
        amount: Math.round(total)
      };
    });
  }, [transactions]);

  // Budget Performance
  const budgetPerformance = useMemo(() => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

    return buckets.map(bucket => {
      const spent = transactions
        .filter(t => t.category === bucket.name && t.date >= thirtyDaysAgo)
        .reduce((sum, t) => sum + t.amount, 0);

      return {
        name: bucket.name,
        spent: Math.round(spent),
        limit: bucket.limit,
        percentage: bucket.limit > 0 ? (spent / bucket.limit) * 100 : 0
      };
    })
    .filter(b => b.spent > 0)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 5);
  }, [buckets, transactions]);

  // Top Merchants
  const topMerchants = useMemo(() => {
    const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const merchantSpending = new Map<string, number>();

    transactions
      .filter(t => t.date >= thirtyDaysAgo)
      .forEach(t => {
        merchantSpending.set(t.merchant, (merchantSpending.get(t.merchant) || 0) + t.amount);
      });

    return Array.from(merchantSpending.entries())
      .map(([merchant, amount]) => ({
        merchant,
        amount: Math.round(amount)
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
  }, [transactions]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="relative w-full max-h-[calc(100dvh-10rem)] sm:max-h-[80vh] max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-brand-100 shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-brand-800">Analytics</h2>
          <button onClick={onClose} className="p-1.5 sm:p-2 bg-brand-50 rounded-full hover:bg-brand-100 active:scale-95 transition-transform">
            <X size={18} className="sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex p-1 sm:p-2 bg-brand-50 mx-4 sm:mx-6 mt-3 sm:mt-4 rounded-xl gap-1">
          <button
            onClick={() => setActiveTab('week')}
            className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${activeTab === 'week' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'}`}
          >
            Week
          </button>
          <button
            onClick={() => setActiveTab('lifetime')}
            className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${activeTab === 'lifetime' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'}`}
          >
            Lifetime
          </button>
          <button
            onClick={() => setActiveTab('financial')}
            className={`flex-1 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${activeTab === 'financial' ? 'bg-white shadow-sm text-brand-800' : 'text-brand-400'}`}
          >
            Financial
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">

          {activeTab === 'week' && (
            <>
              {/* Streak Status Cards */}
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl p-3 sm:p-4 border border-orange-200">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                    <Flame size={14} className="text-orange-600 sm:w-4 sm:h-4" />
                    <span className="text-[10px] sm:text-xs font-bold text-orange-600 uppercase tracking-tight">Active</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-orange-800">{streakStats.activeStreaks}</div>
                </div>
                <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-3 sm:p-4 border border-amber-200">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                    <Award size={14} className="text-amber-600 sm:w-4 sm:h-4" />
                    <span className="text-[10px] sm:text-xs font-bold text-amber-600 uppercase tracking-tight">Longest</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-amber-800">{streakStats.longestStreak}</div>
                </div>
                <div className="bg-gradient-to-br from-rose-50 to-rose-100 rounded-xl p-3 sm:p-4 border border-rose-200">
                  <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
                    <TrendingDown size={14} className="text-rose-600 sm:w-4 sm:h-4" />
                    <span className="text-[10px] sm:text-xs font-bold text-rose-600 uppercase tracking-tight">At Risk</span>
                  </div>
                  <div className="text-2xl sm:text-3xl font-black text-rose-800">{streakStats.atRisk}</div>
                </div>
              </div>

              {/* Category Performance */}
              {categoryPerformance.length > 0 && (
                <div className="bg-white rounded-2xl border border-brand-100 p-3 sm:p-4 shadow-sm">
                  <h3 className="text-xs sm:text-sm font-bold text-brand-500 uppercase tracking-wide mb-3 sm:mb-4">Category Performance (7 Days)</h3>
                  <div className="space-y-2.5 sm:space-y-3">
                    {categoryPerformance.map((cat, idx) => (
                      <div key={cat.category} className="flex items-center gap-2 sm:gap-3">
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-600 shrink-0">
                          {idx + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-brand-800 truncate">{cat.category}</div>
                          <div className="text-xs text-brand-500">{cat.completions} completion{cat.completions !== 1 ? 's' : ''}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-base sm:text-lg font-black text-habit-positive">+{cat.points}</div>
                          <div className="text-[10px] sm:text-xs text-brand-400">points</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sentiment Pie */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Habit Breakdown</h3>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sentimentData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {sentimentData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-center gap-6 mt-2">
                  {sentimentData.map(d => (
                    <div key={d.name} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="text-xs font-bold text-brand-600">{d.name} ({d.value})</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Habits */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Most Completed</h3>
                <div className="h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={frequencyData} margin={{ left: 10 }}>
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 11}} />
                      <Tooltip cursor={{fill: 'transparent'}} />
                      <Bar dataKey="count" fill="#1E293B" radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

          {activeTab === 'lifetime' && (
            <>
              {/* Best/Worst Month Stats */}
              {monthlyStats.best && monthlyStats.worst && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-xl p-4 border border-green-200">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp size={16} className="text-green-700" />
                      <span className="text-xs font-bold text-green-700 uppercase">Best Month</span>
                    </div>
                    <div className="text-lg font-black text-green-900">{monthlyStats.best.month}</div>
                    <div className="text-sm text-green-700">{monthlyStats.best.points} pts • {monthlyStats.best.completions} completions</div>
                  </div>
                  <div className="bg-gradient-to-br from-slate-50 to-slate-100 rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar size={16} className="text-slate-700" />
                      <span className="text-xs font-bold text-slate-700 uppercase">Lowest Month</span>
                    </div>
                    <div className="text-lg font-black text-slate-900">{monthlyStats.worst.month}</div>
                    <div className="text-sm text-slate-700">{monthlyStats.worst.points} pts • {monthlyStats.worst.completions} completions</div>
                  </div>
                </div>
              )}

              {/* Weekly Trend */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Points Trend (12 Weeks)</h3>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <XAxis dataKey="week" tick={{fontSize: 11}} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip />
                      <Line type="monotone" dataKey="points" stroke="#FBBF24" strokeWidth={3} dot={{r: 4, fill: '#FBBF24'}} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Success Rate */}
              {habitSuccessRates.length > 0 && (
                <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Success Rate by Habit</h3>
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={habitSuccessRates} margin={{ left: 10 }}>
                        <XAxis type="number" domain={[0, 100]} hide />
                        <YAxis dataKey="name" type="category" width={80} tick={{fontSize: 11}} />
                        <Tooltip formatter={(value: number) => `${value.toFixed(1)}%`} cursor={{fill: '#F1F5F9'}} />
                        <Bar dataKey="rate" fill="#10B981" radius={[0, 4, 4, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Day of Week Performance */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Best Performing Days</h3>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dayData}>
                      <XAxis dataKey="day" tick={{fontSize: 11}} axisLine={false} tickLine={false} />
                      <Tooltip cursor={{fill: '#F1F5F9'}} />
                      <Bar dataKey="avg" fill="#475569" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Activity Heatmap */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Activity Heatmap (90 Days)</h3>
                <div className="grid grid-cols-10 gap-1">
                  {heatmapData.slice(-90).map((day, idx) => (
                    <div
                      key={day.date}
                      className="aspect-square rounded-sm"
                      style={{
                        backgroundColor: day.intensity === 0 ? '#F1F5F9' :
                          `rgba(16, 185, 129, ${0.2 + day.intensity * 0.8})`
                      }}
                      title={`${day.day}: ${day.completions} completions`}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 text-xs text-brand-500">
                  <span>Less active</span>
                  <div className="flex gap-1">
                    {[0, 0.33, 0.66, 1].map(intensity => (
                      <div
                        key={intensity}
                        className="w-4 h-4 rounded-sm"
                        style={{
                          backgroundColor: intensity === 0 ? '#F1F5F9' :
                            `rgba(16, 185, 129, ${0.2 + intensity * 0.8})`
                        }}
                      />
                    ))}
                  </div>
                  <span>More active</span>
                </div>
              </div>
            </>
          )}

          {activeTab === 'financial' && (
            <>
              {/* Monthly Spending Trend */}
              <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Spending Trend (6 Months)</h3>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlySpending}>
                      <XAxis dataKey="month" tick={{fontSize: 11}} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(value: number) => `$${value}`} />
                      <Area type="monotone" dataKey="amount" stroke="#EF4444" fill="#FEE2E2" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Spending by Category */}
              {spendingByCategory.length > 0 && (
                <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Top Categories (30 Days)</h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart layout="vertical" data={spendingByCategory} margin={{ left: 10 }}>
                        <XAxis type="number" hide />
                        <YAxis dataKey="category" type="category" width={80} tick={{fontSize: 11}} />
                        <Tooltip formatter={(value: number) => `$${value}`} cursor={{fill: 'transparent'}} />
                        <Bar dataKey="amount" fill="#DC2626" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Budget Performance */}
              {budgetPerformance.length > 0 && (
                <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Budget Performance</h3>
                  <div className="space-y-3">
                    {budgetPerformance.map(bucket => (
                      <div key={bucket.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-bold text-brand-800">{bucket.name}</span>
                          <span className="text-xs font-bold text-brand-600">
                            ${bucket.spent} / ${bucket.limit}
                          </span>
                        </div>
                        <div className="h-2 bg-brand-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              bucket.percentage > 100 ? 'bg-red-500' :
                              bucket.percentage > 80 ? 'bg-orange-500' :
                              'bg-green-500'
                            }`}
                            style={{ width: `${Math.min(bucket.percentage, 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Merchants */}
              {topMerchants.length > 0 && (
                <div className="bg-white rounded-2xl border border-brand-100 p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-brand-500 uppercase tracking-wide mb-4">Top Merchants (30 Days)</h3>
                  <div className="space-y-2">
                    {topMerchants.map((merchant, idx) => (
                      <div key={merchant.merchant} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-money-spent text-white flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </div>
                        <div className="flex-1 text-sm font-medium text-brand-800 truncate">{merchant.merchant}</div>
                        <div className="text-sm font-bold text-money-spent">${merchant.amount}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default AnalyticsModal;