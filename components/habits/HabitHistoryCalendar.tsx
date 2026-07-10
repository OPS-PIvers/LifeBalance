import React, { useState, useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { format, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, CheckCircle2, Flame, Calendar, Snowflake } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { Habit } from '@/types/schema';
import { cn } from '@/utils/cn';

/** Pure module-level helper: stable reference, never re-created on render. */
function getIntensityClass(count: number, maxDailyCompletions: number): string {
  if (count === 0) return '';
  const ratio = count / maxDailyCompletions;
  if (ratio >= 0.75) return 'bg-accent-600 text-white';
  if (ratio >= 0.5) return 'bg-accent-500 text-white';
  if (ratio >= 0.25) return 'bg-accent-300 text-accent-900';
  return 'bg-accent-200 text-accent-900';
}

// Optimization: Memoized calendar day to prevent re-rendering the entire grid on selection change
interface CalendarDayProps {
  day: Date;
  count: number;
  isSelected: boolean;
  isCurrentMonth: boolean;
  intensityClass: string;
  isToday: boolean;
  /** Plan 25: an auto-applied freeze protected at least one streak this day. */
  isFrozen: boolean;
  onSelect: (date: Date) => void;
}

const CalendarDay = React.memo(({ day, count, isSelected, isCurrentMonth, intensityClass, isToday, isFrozen, onSelect }: CalendarDayProps) => {
  return (
    <button
      onClick={() => onSelect(day)}
      className={cn(
        "relative flex flex-col items-center justify-center h-10 w-full rounded-card text-sm font-medium transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard)",
        !isCurrentMonth && "opacity-30",
        isSelected
          ? "ring-2 ring-warm-500 dark:ring-warm-400 scale-105 z-10"
          : "hover:scale-105 hover:bg-brand-100 dark:hover:bg-brand-700/50",
        !intensityClass && !isSelected && !isFrozen && "text-brand-400 dark:text-brand-400 bg-brand-50 dark:bg-brand-700/30",
        intensityClass,
        // Frozen day with no completions: distinct habit-blue marker (a frozen
        // day is NOT a completion, so it never gets the green intensity ramp).
        isFrozen && !intensityClass && "bg-habit-blue/15 text-habit-blue dark:bg-habit-blue/20",
        isFrozen && !isSelected && "ring-1 ring-habit-blue/40",
        isToday && !isSelected && !intensityClass && !isFrozen && "text-brand-900 dark:text-brand-50 font-bold bg-brand-200 dark:bg-brand-700"
      )}
      aria-label={`${format(day, 'MMM d')}: ${count} habits completed${isFrozen ? ', streak protected by a freeze' : ''}`}
    >
      {format(day, 'd')}
    </button>
  );
});
CalendarDay.displayName = 'CalendarDay';

const HabitHistoryCalendar: React.FC = () => {
  const { habits } = useGamification();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Calendar Grid Logic
  const { monthStart, days } = useCalendarGrid(currentDate);
  const weekDays: { abbr: string; full: string }[] = [
    { abbr: 'S', full: 'Sunday' },
    { abbr: 'M', full: 'Monday' },
    { abbr: 'T', full: 'Tuesday' },
    { abbr: 'W', full: 'Wednesday' },
    { abbr: 'T', full: 'Thursday' },
    { abbr: 'F', full: 'Friday' },
    { abbr: 'S', full: 'Saturday' },
  ];

  // Map: DateString -> Completed Habits & Max Count. Memoized on `habits` so it
  // only rebuilds when the habits array changes (i.e. on a Firestore snapshot).
  const { dailyCompletions, maxDailyCompletions, frozenByDate } = useMemo(() => {
    const map = new Map<string, Habit[]>();
    let max = 0;

    habits.forEach(habit => {
      habit.completedDates.forEach(date => {
        if (!map.has(date)) map.set(date, []);
        const list = map.get(date)!;
        list.push(habit);
        if (list.length > max) max = list.length;
      });
    });

    // Plan 25: days where an auto-applied freeze protected a streak. Frozen
    // days are NOT completions — they get their own marker, never intensity.
    const frozen = new Map<string, Habit[]>();
    habits.forEach(habit => {
      (habit.frozenDates ?? []).forEach(date => {
        if (!frozen.has(date)) frozen.set(date, []);
        frozen.get(date)!.push(habit);
      });
    });

    return { dailyCompletions: map, maxDailyCompletions: max || 1, frozenByDate: frozen };
  }, [habits]);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedDateHabits = dailyCompletions.get(selectedDateStr) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-(--duration-base)">
      {/* Calendar Card */}
      <div className="surface-section p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-semibold text-lg text-brand-900 dark:text-brand-50">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="text-brand-400 dark:text-brand-400 rounded-btn"
              aria-label="Previous month"
            >
              <ChevronLeft size={20} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="text-brand-400 dark:text-brand-400 rounded-btn"
              aria-label="Next month"
            >
              <ChevronRight size={20} />
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map((day, i) => (
            <div key={`${day.full}-${i}`} className="text-center text-xs font-bold text-brand-300 dark:text-brand-450 py-2">
              <abbr title={day.full} className="no-underline">{day.abbr}</abbr>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-2 gap-x-1">
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const habitsOnDate = dailyCompletions.get(dateStr) || [];
            const count = habitsOnDate.length;
            // String compare avoids allocating Date objects for every cell on every render.
            const isSelected = dateStr === selectedDateStr;
            const isCurrentMonth = isSameMonth(day, monthStart);
            const intensityClass = getIntensityClass(count, maxDailyCompletions);

            return (
              <CalendarDay
                key={dateStr}
                day={day}
                count={count}
                isSelected={isSelected}
                isCurrentMonth={isCurrentMonth}
                intensityClass={intensityClass}
                isToday={isToday(day)}
                isFrozen={frozenByDate.has(dateStr)}
                onSelect={setSelectedDate}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-end gap-2 text-xxs font-bold text-brand-300 dark:text-brand-450 uppercase tracking-wide">
          <span className="flex items-center gap-1 mr-2 normal-case">
            <Snowflake size={10} className="text-habit-blue" /> Frozen
          </span>
          <span>Less</span>
          <div className="flex gap-1">
             <div className="w-3 h-3 rounded-sm bg-accent-200"></div>
             <div className="w-3 h-3 rounded-sm bg-accent-300"></div>
             <div className="w-3 h-3 rounded-sm bg-accent-500"></div>
             <div className="w-3 h-3 rounded-sm bg-accent-600"></div>
          </div>
          <span>More</span>
        </div>
      </div>

      {/* Detail List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-display font-semibold text-brand-700 dark:text-brand-200 text-sm">
            {format(selectedDate, 'MMMM d')} summary
          </h3>
          <Badge variant="neutral" size="md">
            {selectedDateHabits.length} completed
          </Badge>
        </div>

        {/* Plan 25: a freeze protected streak(s) on the selected day */}
        {(frozenByDate.get(selectedDateStr)?.length ?? 0) > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-habit-blue/10 dark:bg-habit-blue/15 text-sm text-brand-700 dark:text-brand-200">
            <Snowflake size={16} className="text-habit-blue shrink-0" />
            <span>
              A freeze protected{' '}
              {frozenByDate.get(selectedDateStr)!.map(h => h.title).join(', ')} on this day —
              streak kept, no points earned.
            </span>
          </div>
        )}

        {selectedDateHabits.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-brand-800 border border-dashed border-brand-200 dark:border-brand-700 rounded-2xl text-brand-400 dark:text-brand-450">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-sm">No habits completed on this day.</p>
          </div>
        ) : (
          <div className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
            {selectedDateHabits.map(habit => {
              const isPositive = habit.type === 'positive';
              return (
                <div key={habit.id} className="px-4 py-3.5 hairline-divider flex items-center justify-between group animate-in fade-in duration-(--duration-base)">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      "w-10 h-10 rounded-card flex items-center justify-center font-bold shrink-0",
                      isPositive ? "bg-money-bgPos dark:bg-money-pos/15 text-money-pos dark:text-money-posDark" : "bg-money-bgNeg dark:bg-money-neg/15 text-money-neg dark:text-money-negDark"
                    )}>
                      {isPositive ? <CheckCircle2 size={20} /> : <Flame size={20} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-brand-800 dark:text-brand-100 text-sm truncate">{habit.title}</p>
                      <p className="text-xs text-brand-400 dark:text-brand-450">{habit.category}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end shrink-0">
                    <Badge variant={isPositive ? 'success' : 'danger'} size="md">
                      {habit.basePoints} pts
                    </Badge>
                    {habit.streakDays > 0 && (
                      <span className="text-xxs text-habit-streak font-bold flex items-center gap-0.5 mt-0.5">
                        <Flame size={8} fill="currentColor" /> {habit.streakDays} day streak
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default HabitHistoryCalendar;
