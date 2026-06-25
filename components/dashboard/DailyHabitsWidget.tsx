import React, { useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { isHabitStale } from '@/utils/habitLogic';
import { format, startOfToday } from 'date-fns';
import { Check, Flame, ArrowRight, LayoutList, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

const MAX_VISIBLE_HABITS = 5;
const DEFAULT_ORDER_FALLBACK = 999;

export const DailyHabitsWidget: React.FC = () => {
  const { habits, toggleHabit } = useGamification();

  // Computed on every render (date formatting is cheap) so the value stays
  // correct across a midnight rollover even if the dashboard is left open.
  // The string value is stable day-to-day, so the dailyHabits useMemo below
  // (which depends on it) only recomputes when the date actually changes.
  const today = format(startOfToday(), 'yyyy-MM-dd');

  // Filter and Sort Habits
  const dailyHabits = useMemo(() => {
    return habits
      .filter(h => h.period === 'daily') // Show all daily habits (presets and custom)
      .filter(h => !h.assignedTo) // Hide kid chores from the parent tracker (assignedTo is set only for managed-kid chores; dormant by default)
      .map(habit => {
        const isStale = isHabitStale(habit);
        // Build a Set to get O(1) lookups instead of O(N) Array.includes per habit.
        const completedSet = new Set(habit.completedDates);
        const isCompleted = completedSet.has(today);
        const currentCount = isStale ? 0 : habit.count;
        const target = habit.targetCount || 1;
        const progress = Math.min(100, Math.round((currentCount / target) * 100));

        return {
          ...habit,
          isCompleted,
          currentCount,
          progress
        };
      })
      .sort((a, b) => {
        // 1. Pending first
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        // 2. Then by Order
        return (a.order ?? DEFAULT_ORDER_FALLBACK) - (b.order ?? DEFAULT_ORDER_FALLBACK);
      });
  }, [habits, today]);

  // Calculate Overall Progress
  const stats = useMemo(() => {
    const total = dailyHabits.length;
    const completed = dailyHabits.filter(h => h.isCompleted).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, percent };
  }, [dailyHabits]);

  if (dailyHabits.length === 0) return null;

  // Limit to top habits to save space
  const visibleHabits = dailyHabits.slice(0, MAX_VISIBLE_HABITS);
  const remainingCount = dailyHabits.length - MAX_VISIBLE_HABITS;

  return (
    <div className="bg-white/80 dark:bg-slate-800/60 backdrop-blur-xl border border-white/20 dark:border-white/5 shadow-glass ring-1 ring-black/5 rounded-3xl p-6 animate-in fade-in slide-in-from-top-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <div className="p-1.5 bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300 rounded-lg">
             <LayoutList size={14} />
          </div>
          Daily Habits
        </h2>
        <Link
          to="/habits"
          className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 transition-colors"
        >
          View All <ArrowRight size={12} />
        </Link>
      </div>

      {/* Progress Header */}
      <div className="mb-6 px-1 flex items-center justify-between">
         <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">Today&apos;s Progress</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {stats.completed}/{stats.total}
              </span>
              <span className="text-sm font-bold text-slate-400 dark:text-slate-500">done</span>
            </div>
         </div>

         {/* Circular Progress (CSS based) — aria-hidden because the % is shown as text */}
         <div className="relative w-12 h-12 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <path
                className="text-slate-100 dark:text-slate-700"
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className={`${stats.percent === 100 ? 'text-emerald-500' : 'text-violet-500'} transition-all duration-1000 ease-out`}
                strokeDasharray={`${stats.percent}, 100`}
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute text-xs font-bold text-slate-600 dark:text-slate-300">
               {stats.percent}%
            </div>
         </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {visibleHabits.map(habit => (
          <div
            key={habit.id}
            className={`flex items-center justify-between py-2 px-3 rounded-xl transition-all border ${
                habit.isCompleted
                ? 'bg-emerald-50/50 border-emerald-100/50 dark:bg-emerald-500/10 dark:border-emerald-500/20'
                : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700/50 dark:hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
               {/* Toggle Button */}
               <button
                  onClick={() => toggleHabit(habit.id, habit.isCompleted ? 'down' : 'up')}
                  className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-xs shrink-0 ${
                      habit.isCompleted
                      ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                      : 'bg-slate-100 text-slate-300 hover:bg-slate-200 hover:text-slate-400 dark:bg-slate-700 dark:text-slate-500 dark:hover:bg-slate-600 dark:hover:text-slate-400'
                  }`}
                  aria-label={habit.isCompleted ? "Mark as incomplete" : "Mark as complete"}
               >
                  {habit.isCompleted ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
               </button>

               <div className="min-w-0">
                  <p className={`text-sm font-bold truncate ${habit.isCompleted ? 'text-emerald-800 dark:text-emerald-300 line-through decoration-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>
                    {habit.title}
                  </p>
                  <div className="flex items-center gap-2 text-xxs font-medium">
                     {/* Count / Target */}
                     {habit.targetCount > 1 && (
                         <span className={`${habit.isCompleted ? 'text-emerald-600' : 'text-slate-400 dark:text-slate-500'}`}>
                            {habit.currentCount}/{habit.targetCount}
                         </span>
                     )}

                     {/* Streak */}
                     {habit.streakDays > 0 && (
                        <span className={`flex items-center gap-0.5 ${habit.streakDays >= 3 ? 'text-orange-500' : 'text-slate-400 dark:text-slate-500'}`}>
                           <Flame aria-hidden="true" size={10} className={`${habit.streakDays >= 3 ? 'fill-orange-500' : ''} ${habit.streakDays >= 7 ? 'motion-safe:animate-pulse' : ''}`} />
                           <span aria-hidden="true">{habit.streakDays}</span>
                           <span className="sr-only">{habit.streakDays} day streak</span>
                        </span>
                     )}
                  </div>
               </div>
            </div>
          </div>
        ))}

        {remainingCount > 0 && (
           <Link to="/habits" className="block text-center text-xs font-bold text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 py-2">
              + {remainingCount} more habits
           </Link>
        )}
      </div>
    </div>
  );
};
