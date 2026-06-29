import React, { useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { isHabitStale } from '@/utils/habitLogic';
import { format, startOfToday } from 'date-fns';
import { Check, Flame, ArrowRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import { cn } from '@/utils/cn';
import ProgressRing from '@/components/ui/ProgressRing';

const MAX_VISIBLE_HABITS = 5;
const DEFAULT_ORDER_FALLBACK = 999;

export const DailyHabitsWidget: React.FC = React.memo(() => {
  const { habits, toggleHabit } = useGamification();

  // Computed on every render (date formatting is cheap) so the value stays
  // correct across a midnight rollover even if the dashboard is left open.
  const today = format(startOfToday(), 'yyyy-MM-dd');

  // Filter and Sort Habits
  const dailyHabits = useMemo(() => {
    return habits
      .filter(h => h.period === 'daily') // Show all daily habits (presets and custom)
      .filter(h => !h.assignedTo) // Hide kid chores from the parent tracker
      .map(habit => {
        const isStale = isHabitStale(habit);
        const completedSet = new Set(habit.completedDates);
        const isCompleted = completedSet.has(today);
        const currentCount = isStale ? 0 : habit.count;
        const target = habit.targetCount || 1;
        const progress = Math.min(100, Math.round((currentCount / target) * 100));

        return { ...habit, isCompleted, currentCount, progress };
      })
      .sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        return (a.order ?? DEFAULT_ORDER_FALLBACK) - (b.order ?? DEFAULT_ORDER_FALLBACK);
      });
  }, [habits, today]);

  const stats = useMemo(() => {
    const total = dailyHabits.length;
    const completed = dailyHabits.filter(h => h.isCompleted).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, percent };
  }, [dailyHabits]);

  if (dailyHabits.length === 0) return null;

  const visibleHabits = dailyHabits.slice(0, MAX_VISIBLE_HABITS);
  const remainingCount = dailyHabits.length - MAX_VISIBLE_HABITS;

  return (
    <Section
      title="Today's habits"
      action={
        <Link
          to="/habits"
          className="text-xs font-semibold text-brand-500 dark:text-brand-400 hover:text-accent-700 dark:hover:text-accent-300 flex items-center gap-1 transition-colors"
        >
          View all <ArrowRight size={12} />
        </Link>
      }
    >
      <SurfaceList>
        {/* Progress header row */}
        <Row className="justify-between">
          <div>
            <p className="text-xs text-brand-500 dark:text-brand-400 font-medium mb-0.5">Today&apos;s progress</p>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tabular-nums tracking-tight text-brand-900 dark:text-brand-50">
                {stats.completed}/{stats.total}
              </span>
              <span className="text-sm font-semibold text-brand-400 dark:text-brand-500">done</span>
            </div>
          </div>

          {/* Circular progress — aria-hidden because the % is shown as text */}
          <ProgressRing
            percent={stats.percent}
            barClassName={stats.percent === 100 ? 'text-money-pos' : 'text-warm-500'}
          >
            <span className="font-mono text-[11px] font-bold tabular-nums text-brand-600 dark:text-brand-300">
              {stats.percent}%
            </span>
          </ProgressRing>
        </Row>

        {/* Habit rows */}
        {visibleHabits.map(habit => (
          <Row key={habit.id} className="justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => toggleHabit(habit.id, habit.isCompleted ? 'down' : 'up')}
                className="group/toggle -m-1.5 w-11 h-11 flex items-center justify-center shrink-0 rounded-full focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40"
                aria-label={habit.isCompleted ? `Mark ${habit.title} as incomplete` : `Mark ${habit.title} as complete`}
              >
                <span className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                  habit.isCompleted
                    ? 'bg-money-pos text-white group-hover/toggle:brightness-95'
                    : 'bg-brand-100 text-brand-400 group-hover/toggle:bg-brand-200 group-hover/toggle:text-brand-500 dark:bg-brand-700 dark:text-brand-500 dark:group-hover/toggle:bg-brand-600 dark:group-hover/toggle:text-brand-300'
                )}>
                  {habit.isCompleted ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
                </span>
              </button>

              <div className="min-w-0">
                <p className={cn(
                  'text-sm font-semibold truncate',
                  habit.isCompleted
                    ? 'text-brand-400 dark:text-brand-500 line-through decoration-brand-300'
                    : 'text-brand-800 dark:text-brand-100'
                )}>
                  {habit.title}
                </p>
                <div className="flex items-center gap-2 text-xxs font-medium mt-0.5">
                  {habit.targetCount > 1 && (
                    <span className={habit.isCompleted ? 'text-money-pos' : 'text-brand-400 dark:text-brand-500'}>
                      {habit.currentCount}/{habit.targetCount}
                    </span>
                  )}
                  {habit.streakDays > 0 && (
                    <span className={cn(
                      'flex items-center gap-0.5',
                      habit.streakDays >= 3 ? 'text-habit-streak' : 'text-brand-400 dark:text-brand-500'
                    )}>
                      <Flame
                        aria-hidden="true"
                        size={10}
                        className={cn(
                          habit.streakDays >= 3 && 'fill-habit-streak',
                          habit.streakDays >= 7 && 'motion-safe:animate-pulse'
                        )}
                      />
                      <span aria-hidden="true">{habit.streakDays}</span>
                      <span className="sr-only">{habit.streakDays} day streak</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Row>
        ))}

        {remainingCount > 0 && (
          <Row interactive className="justify-center p-0">
            <Link
              to="/habits"
              className="block w-full text-center text-xs font-semibold text-brand-400 dark:text-brand-500 hover:text-accent-700 dark:hover:text-accent-300 py-3"
            >
              + {remainingCount} more {remainingCount === 1 ? 'habit' : 'habits'}
            </Link>
          </Row>
        )}
      </SurfaceList>
    </Section>
  );
});

DailyHabitsWidget.displayName = 'DailyHabitsWidget';
