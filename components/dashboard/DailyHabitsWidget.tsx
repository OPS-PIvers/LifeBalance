import React, { useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { isHabitStale } from '@/utils/habitLogic';
import { format, startOfToday } from 'date-fns';
import { Check, Flame, ListChecks, Plus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import SectionActionLink from '@/components/ui/SectionActionLink';
import { Section, SurfaceList, Row } from '@/components/ui/Section';
import EmptyState from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';

const MAX_VISIBLE_HABITS = 5;
const DEFAULT_ORDER_FALLBACK = 999;

export const DailyHabitsWidget: React.FC = React.memo(() => {
  const { habits, toggleHabit } = useGamification();
  const navigate = useNavigate();

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
        // Signal inputs for the smart ranking below. completedDates are
        // yyyy-MM-dd strings, so a lexical max is the most-recent completion.
        const lastCompleted = habit.completedDates.reduce((max, d) => (d > max ? d : max), '');
        const frequency = habit.completedDates.length;

        return { ...habit, isCompleted, currentCount, progress, lastCompleted, frequency };
      })
      // Smart ranking (replaces raw manual order): surface the highest-signal
      // habits first so the widget leads with what's worth acting on today —
      // not whatever happens to sit at the top of the manual list.
      //   1. Incomplete before completed (completed sink to the bottom).
      //   2. Active / at-risk streaks first, biggest streak first — an
      //      unchecked habit with a live streak has the most to lose today.
      //   3. Then most-recently completed (recency), then most-frequently
      //      completed (frequency).
      //   4. Manual `order` breaks any remaining ties.
      .sort((a, b) => {
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        const aHasStreak = a.streakDays > 0;
        const bHasStreak = b.streakDays > 0;
        if (aHasStreak !== bHasStreak) return aHasStreak ? -1 : 1;
        if (a.streakDays !== b.streakDays) return b.streakDays - a.streakDays;
        if (a.lastCompleted !== b.lastCompleted) return a.lastCompleted < b.lastCompleted ? 1 : -1;
        if (a.frequency !== b.frequency) return b.frequency - a.frequency;
        return (a.order ?? DEFAULT_ORDER_FALLBACK) - (b.order ?? DEFAULT_ORDER_FALLBACK);
      });
  }, [habits, today]);

  if (dailyHabits.length === 0) {
    return (
      <Section title="Today's habits">
        <EmptyState
          variant="dashed"
          size="compact"
          icon={<ListChecks size={20} />}
          title="No habits yet"
          description="Add a habit to start building streaks and earning points."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/habits')}
              leftIcon={<Plus size={14} />}
            >
              Add a habit
            </Button>
          }
        />
      </Section>
    );
  }

  const visibleHabits = dailyHabits.slice(0, MAX_VISIBLE_HABITS);
  const remainingCount = dailyHabits.length - MAX_VISIBLE_HABITS;

  return (
    <Section
      title="Today's habits"
      action={
        <SectionActionLink to="/habits">View all</SectionActionLink>
      }
    >
      <SurfaceList>
        {/* Habit rows — the progress-ring header (done/total, %) was removed:
            it duplicated PulseStripWidget's Consistency cell shown just above
            (same %/done-total for today) — see UX content audit Batch 4. */}
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
                    : 'bg-brand-100 text-brand-400 group-hover/toggle:bg-brand-200 group-hover/toggle:text-brand-500 dark:bg-brand-700 dark:text-brand-450 dark:group-hover/toggle:bg-brand-600 dark:group-hover/toggle:text-brand-300'
                )}>
                  {habit.isCompleted ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
                </span>
              </button>

              <div className="min-w-0">
                <p className={cn(
                  'text-sm font-semibold truncate',
                  habit.isCompleted
                    ? 'text-brand-400 dark:text-brand-450 line-through decoration-brand-300'
                    : 'text-brand-800 dark:text-brand-100'
                )}>
                  {habit.title}
                </p>
                <div className="flex items-center gap-2 text-xxs font-medium mt-0.5">
                  {habit.targetCount > 1 && (
                    <span className={habit.isCompleted ? 'text-money-pos dark:text-money-posDark' : 'text-brand-400 dark:text-brand-450'}>
                      {habit.currentCount}/{habit.targetCount}
                    </span>
                  )}
                  {habit.streakDays > 0 && (
                    <span className={cn(
                      'flex items-center gap-0.5',
                      habit.streakDays >= 3 ? 'text-habit-streak' : 'text-brand-400 dark:text-brand-450'
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
              className="block w-full text-center text-xs font-semibold text-brand-400 dark:text-brand-450 hover:text-accent-700 dark:hover:text-accent-300 py-3"
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
