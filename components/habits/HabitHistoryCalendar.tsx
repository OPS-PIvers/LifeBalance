import React, { useState, useMemo } from 'react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { format, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, CheckCircle2, Flame, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { Habit } from '@/types/schema';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

/** Pure module-level helper: stable reference, never re-created on render. */
function getIntensityClass(count: number, maxDailyCompletions: number): string {
  if (count === 0) return '';
  const ratio = count / maxDailyCompletions;
  if (ratio >= 0.75) return 'bg-emerald-500 text-white';
  if (ratio >= 0.5) return 'bg-emerald-400 text-white';
  if (ratio >= 0.25) return 'bg-emerald-300 text-white';
  return 'bg-emerald-200 text-emerald-800';
}

// Optimization: Memoized calendar day to prevent re-rendering the entire grid on selection change
interface CalendarDayProps {
  day: Date;
  count: number;
  isSelected: boolean;
  isCurrentMonth: boolean;
  intensityClass: string;
  isToday: boolean;
  onSelect: (date: Date) => void;
}

const CalendarDay = React.memo(({ day, count, isSelected, isCurrentMonth, intensityClass, isToday, onSelect }: CalendarDayProps) => {
  return (
    <button
      onClick={() => onSelect(day)}
      className={cn(
        "relative flex flex-col items-center justify-center h-10 w-full rounded-xl text-sm font-medium transition-all duration-200",
        !isCurrentMonth && "opacity-30",
        isSelected
          ? "ring-2 ring-brand-800 dark:ring-brand-300 scale-105 z-10"
          : "hover:scale-105 hover:bg-brand-50 dark:hover:bg-slate-700/50",
        !intensityClass && !isSelected && "text-brand-400 dark:text-slate-400 bg-brand-50/50 dark:bg-slate-700/30",
        intensityClass,
        isToday && !isSelected && !intensityClass && "text-brand-800 dark:text-slate-100 font-bold bg-brand-100 dark:bg-slate-700"
      )}
      aria-label={`${format(day, 'MMM d')}: ${count} habits completed`}
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

  // Map: DateString -> Completed Habits & Max Count
  const { dailyCompletions, maxDailyCompletions } = useMemo(() => {
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

    return { dailyCompletions: map, maxDailyCompletions: max || 1 };
  }, [habits]);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedDateHabits = dailyCompletions.get(selectedDateStr) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Calendar Card */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-brand-100 dark:border-slate-700 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-brand-800 dark:text-slate-100">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="text-brand-400 dark:text-slate-400 rounded-lg"
              aria-label="Previous month"
            >
              <ChevronLeft size={20} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="text-brand-400 dark:text-slate-400 rounded-lg"
              aria-label="Next month"
            >
              <ChevronRight size={20} />
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map((day, i) => (
            <div key={`${day.full}-${i}`} className="text-center text-xs font-bold text-brand-300 dark:text-slate-500 py-2">
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
                onSelect={setSelectedDate}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-end gap-2 text-xxs font-bold text-brand-300 dark:text-slate-500 uppercase tracking-wide">
          <span>Less</span>
          <div className="flex gap-1">
             <div className="w-3 h-3 rounded bg-emerald-200"></div>
             <div className="w-3 h-3 rounded bg-emerald-300"></div>
             <div className="w-3 h-3 rounded bg-emerald-400"></div>
             <div className="w-3 h-3 rounded bg-emerald-500"></div>
          </div>
          <span>More</span>
        </div>
      </div>

      {/* Detail List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-bold text-brand-800 dark:text-slate-100 text-sm uppercase tracking-wide">
            {format(selectedDate, 'MMMM d')} Summary
          </h3>
          <span className="text-xs font-medium text-brand-500 dark:text-slate-300 bg-brand-100 dark:bg-slate-700/50 px-2 py-1 rounded-full">
            {selectedDateHabits.length} Completed
          </span>
        </div>

        {selectedDateHabits.length === 0 ? (
          <div className="text-center py-10 bg-white dark:bg-slate-800/40 border border-dashed border-brand-200 dark:border-slate-700 rounded-2xl text-brand-400 dark:text-slate-400">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-sm">No habits completed on this day.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedDateHabits.map(habit => {
              const isPositive = habit.type === 'positive';
              return (
                <div key={habit.id} className="bg-white dark:bg-slate-800 p-3 rounded-xl border border-brand-100 dark:border-slate-700 shadow-sm flex items-center justify-between group animate-in slide-in-from-bottom-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center font-bold transition-colors",
                      isPositive ? "bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : "bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300"
                    )}>
                      {isPositive ? <CheckCircle2 size={20} /> : <Flame size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-brand-800 dark:text-slate-100 text-sm">{habit.title}</p>
                      <p className="text-xs text-brand-400 dark:text-slate-400">{habit.category}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-full",
                      isPositive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                    )}>
                      {habit.basePoints} pts
                    </span>
                    {habit.streakDays > 0 && (
                      <span className="text-xxs text-orange-500 font-bold flex items-center gap-0.5 mt-0.5">
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
