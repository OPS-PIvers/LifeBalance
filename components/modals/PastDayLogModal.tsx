import React, { useMemo, useState } from 'react';
import { format, isSameMonth, isToday, addMonths, subMonths, subDays, parseISO, differenceInCalendarDays } from 'date-fns';
import { ChevronLeft, ChevronRight, Check, Plus, CalendarDays, Star } from 'lucide-react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import Eyebrow from '@/components/ui/Eyebrow';
import EmptyState from '@/components/ui/EmptyState';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { getLocalDateString } from '@/utils/dateHelpers';
import { isHabitCompletedInCurrentPeriod } from '@/utils/habitLogic';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';

interface PastDayLogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WEEK_DAYS: { abbr: string; full: string }[] = [
  { abbr: 'S', full: 'Sunday' },
  { abbr: 'M', full: 'Monday' },
  { abbr: 'T', full: 'Tuesday' },
  { abbr: 'W', full: 'Wednesday' },
  { abbr: 'T', full: 'Thursday' },
  { abbr: 'F', full: 'Friday' },
  { abbr: 'S', full: 'Saturday' },
];

/**
 * PastDayLogModal — "Log a past day" drawer opened from the Habits page header.
 *
 * A compact month calendar sits on top (future days disabled); tapping a past
 * day swaps the habit list below to that day, and each row logs a completion
 * for THAT date with one tap. All writes ride the existing back-dating-aware
 * submissions path (`addHabitSubmission` with a noon timestamp on the chosen
 * date), which already handles past-period points, the prospective streak
 * multiplier for that day, and the no-double-award guard — this component adds
 * no scoring logic of its own.
 */
const PastDayLogModal: React.FC<PastDayLogModalProps> = ({ isOpen, onClose }) => {
  const { habits, addHabitSubmission } = useGamification();

  const today = getLocalDateString();
  // Default to yesterday — the day people most often forgot to log.
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(subDays(parseISO(today), 1), 'yyyy-MM-dd')
  );
  const [currentMonth, setCurrentMonth] = useState<Date>(() => parseISO(selectedDate));
  // Habit ids with an in-flight write, so a slow network can't double-log a tap.
  const [loggingIds, setLoggingIds] = useState<ReadonlySet<string>>(new Set());

  const { monthStart, days } = useCalendarGrid(currentMonth);

  // Same parent-visible set as the Track tab: kid chores (assignedTo) excluded.
  const sortedHabits = useMemo(
    () => habits.filter(h => !h.assignedTo).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [habits]
  );

  const groupedHabits = useMemo<[string, Habit[]][]>(() => {
    const groups = new Map<string, Habit[]>();
    sortedHabits.forEach(h => {
      const list = groups.get(h.category) ?? [];
      list.push(h);
      groups.set(h.category, list);
    });
    return Array.from(groups.entries());
  }, [sortedHabits]);

  // Days that already have at least one completion get a subtle dot, so the
  // gaps (the days worth backfilling) stand out at a glance.
  const completedDateSet = useMemo(() => {
    const set = new Set<string>();
    habits.forEach(h => h.completedDates.forEach(d => set.add(d)));
    return set;
  }, [habits]);

  const handleLog = async (habit: Habit) => {
    if (loggingIds.has(habit.id)) return;
    setLoggingIds(prev => new Set(prev).add(habit.id));
    try {
      // Threshold habits complete by reaching targetCount; one tap logs the
      // full target so the day flips to done. Incremental habits score per
      // action, so each tap logs one.
      const count = habit.scoringType === 'incremental' ? 1 : Math.max(1, habit.targetCount);
      // Noon keeps the timestamp unambiguously inside the chosen local day.
      await addHabitSubmission(habit.id, count, `${selectedDate}T12:00:00`);
      track('habit_past_day_logged', {
        daysAgo: differenceInCalendarDays(parseISO(today), parseISO(selectedDate)),
        positive: habit.type === 'positive',
      });
    } finally {
      setLoggingIds(prev => {
        const next = new Set(prev);
        next.delete(habit.id);
        return next;
      });
    }
  };

  const selectedIsToday = selectedDate === today;
  const selectedLabel = selectedIsToday ? 'Today' : format(parseISO(selectedDate), 'EEEE, MMMM d');

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Log a past day" height="tall" noPadding>
      <div className="p-4 space-y-5">
        {/* Month calendar */}
        <div className="surface-section p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-display font-semibold text-brand-900 dark:text-brand-50">
              {format(currentMonth, 'MMMM yyyy')}
            </h4>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                className="text-brand-400 dark:text-brand-400 rounded-btn"
                aria-label="Previous month"
              >
                <ChevronLeft size={20} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                disabled={isSameMonth(currentMonth, parseISO(today))}
                className="text-brand-400 dark:text-brand-400 rounded-btn"
                aria-label="Next month"
              >
                <ChevronRight size={20} />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {WEEK_DAYS.map((day, i) => (
              <div key={`${day.full}-${i}`} className="text-center text-xs font-bold text-brand-300 dark:text-brand-450 py-1">
                <abbr title={day.full} className="no-underline">{day.abbr}</abbr>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-1.5 gap-x-1">
            {days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const isFuture = dateStr > today;
              const isSelected = dateStr === selectedDate;
              const hasCompletions = completedDateSet.has(dateStr);
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  disabled={isFuture}
                  className={cn(
                    'relative flex flex-col items-center justify-center h-9 w-full rounded-card text-sm font-medium transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard)',
                    !isSameMonth(day, monthStart) && 'opacity-30',
                    isFuture && 'opacity-25 cursor-not-allowed',
                    isSelected
                      ? 'bg-warm-500 text-white font-bold scale-105 z-10'
                      : !isFuture && 'hover:bg-brand-100 dark:hover:bg-brand-700/50 text-brand-700 dark:text-brand-200',
                    isToday(day) && !isSelected && 'font-bold ring-1 ring-inset ring-brand-300 dark:ring-brand-600'
                  )}
                  aria-label={`${format(day, 'MMMM d')}${hasCompletions ? ', has logged habits' : ''}`}
                  aria-pressed={isSelected}
                >
                  {format(day, 'd')}
                  {hasCompletions && (
                    <span
                      className={cn(
                        'absolute bottom-1 w-1 h-1 rounded-full',
                        isSelected ? 'bg-white' : 'bg-accent-500'
                      )}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected-day habit list */}
        <div className="space-y-4">
          <div className="flex items-baseline justify-between px-1">
            <h4 className="font-display font-semibold text-brand-800 dark:text-brand-100">
              {selectedLabel}
            </h4>
            <span className="text-xs font-medium text-brand-400 dark:text-brand-450">
              Tap a habit to log it
            </span>
          </div>

          {sortedHabits.length === 0 ? (
            <EmptyState
              variant="dashed"
              icon={<CalendarDays size={28} />}
              title="No habits yet"
              description="Create a habit first, then come back to backfill past days."
            />
          ) : (
            groupedHabits.map(([category, categoryHabits]) => (
              <div key={category}>
                <Eyebrow as="h3" className="mb-2 px-1">{category}</Eyebrow>
                <div className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
                  {categoryHabits.map(habit => {
                    const done = isHabitCompletedInCurrentPeriod(habit, selectedDate);
                    const isIncremental = habit.scoringType === 'incremental';
                    const isLogging = loggingIds.has(habit.id);
                    // A completed threshold day can't earn again — lock the row.
                    // Incremental habits score per action, so they stay tappable.
                    const locked = done && !isIncremental;
                    return (
                      <button
                        key={habit.id}
                        type="button"
                        onClick={() => handleLog(habit)}
                        disabled={locked || isLogging}
                        className={cn(
                          'w-full px-4 py-3 hairline-divider flex items-center gap-3 text-left transition-colors duration-(--duration-fast)',
                          locked
                            ? 'cursor-default'
                            : 'hover:bg-brand-50 dark:hover:bg-brand-700/40 active:bg-brand-100 dark:active:bg-brand-700/60',
                          isLogging && 'opacity-60'
                        )}
                        aria-label={
                          locked
                            ? `${habit.title}: already logged for ${selectedLabel}`
                            : `Log ${habit.title} for ${selectedLabel}`
                        }
                      >
                        <span
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
                            done
                              ? 'bg-accent-600 border-accent-600 text-white'
                              : 'border-brand-300 dark:border-brand-600 text-brand-300 dark:text-brand-500'
                          )}
                          aria-hidden="true"
                        >
                          {done ? <Check size={16} strokeWidth={3} /> : <Plus size={16} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn(
                            'block text-sm font-semibold truncate',
                            done ? 'text-brand-500 dark:text-brand-400' : 'text-brand-800 dark:text-brand-100'
                          )}>
                            {habit.title}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-xxs font-medium text-brand-400 dark:text-brand-450">
                            <span className="inline-flex items-center gap-0.5">
                              <Star size={10} className="fill-current text-habit-gold" aria-hidden="true" />
                              {habit.basePoints} pts
                            </span>
                            {habit.period === 'weekly' && <Badge variant="neutral" size="sm">Weekly</Badge>}
                          </span>
                        </span>
                        <span className={cn(
                          'shrink-0 text-xxs font-bold uppercase tracking-wide',
                          done ? 'text-accent-600 dark:text-accent-400' : 'text-brand-400 dark:text-brand-450'
                        )}>
                          {locked ? 'Logged' : done ? '+1 more' : 'Log'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <p className="px-1 text-xs text-brand-400 dark:text-brand-450">
            Backfilled days earn points with the streak that applied on that day, and streaks update automatically.
          </p>
        </div>
      </div>
    </Drawer>
  );
};

export default PastDayLogModal;
