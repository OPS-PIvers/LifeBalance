import React, { useState, useMemo } from 'react';
import { useHousehold } from '../../contexts/FirebaseHouseholdContext';
import { format, isSameMonth, isSameDay, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, CheckCircle2, Flame, Calendar } from 'lucide-react';
import { Button } from '../ui/Button';
import { useCalendarGrid } from '../../hooks/useCalendarGrid';
import { Habit } from '../../types/schema';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const HabitHistoryCalendar: React.FC = () => {
  const { habits } = useHousehold();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Calendar Grid Logic
  const { monthStart, days } = useCalendarGrid(currentDate);
  const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

  const getIntensityClass = (count: number) => {
    if (count === 0) return '';
    const ratio = count / maxDailyCompletions;
    if (ratio >= 0.75) return 'bg-emerald-500 text-white';
    if (ratio >= 0.5) return 'bg-emerald-400 text-white';
    if (ratio >= 0.25) return 'bg-emerald-300 text-white';
    return 'bg-emerald-200 text-emerald-800';
  };

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedDateHabits = dailyCompletions.get(selectedDateStr) || [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Calendar Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-brand-100 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg text-brand-800">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="text-brand-400 rounded-lg"
              aria-label="Previous month"
            >
              <ChevronLeft size={20} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="text-brand-400 rounded-lg"
              aria-label="Next month"
            >
              <ChevronRight size={20} />
            </Button>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-7 mb-2">
          {weekDays.map((d, i) => (
            <div key={`${d}-${i}`} className="text-center text-xs font-bold text-brand-300 py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-2 gap-x-1">
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const habitsOnDate = dailyCompletions.get(dateStr) || [];
            const count = habitsOnDate.length;
            const isSelected = isSameDay(day, selectedDate);
            const isCurrentMonth = isSameMonth(day, monthStart);
            const intensityClass = getIntensityClass(count);

            return (
              <button
                key={day.toString()}
                onClick={() => setSelectedDate(day)}
                className={cn(
                  "relative flex flex-col items-center justify-center h-10 w-full rounded-xl text-sm font-medium transition-all duration-200",
                  !isCurrentMonth && "opacity-30",
                  isSelected
                    ? "ring-2 ring-brand-800 scale-105 z-10"
                    : "hover:scale-105 hover:bg-brand-50",
                  !intensityClass && !isSelected && "text-brand-400 bg-brand-50/50",
                  intensityClass,
                  isToday(day) && !isSelected && !intensityClass && "text-brand-800 font-bold bg-brand-100"
                )}
                aria-label={`${format(day, 'MMM d')}: ${count} habits completed`}
              >
                {format(day, 'd')}
                {/* Optional: Dot indicator instead of background color?
                    Going with background color for heatmap effect as planned. */}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-end gap-2 text-xxs font-bold text-brand-300 uppercase tracking-wide">
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
          <h3 className="font-bold text-brand-800 text-sm uppercase tracking-wide">
            {format(selectedDate, 'MMMM d')} Summary
          </h3>
          <span className="text-xs font-medium text-brand-500 bg-brand-100 px-2 py-1 rounded-full">
            {selectedDateHabits.length} Completed
          </span>
        </div>

        {selectedDateHabits.length === 0 ? (
          <div className="text-center py-10 bg-white border border-dashed border-brand-200 rounded-2xl text-brand-400">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium text-sm">No habits completed on this day.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {selectedDateHabits.map(habit => {
              const isPositive = habit.type === 'positive';
              return (
                <div key={habit.id} className="bg-white p-3 rounded-xl border border-brand-100 shadow-sm flex items-center justify-between group animate-in slide-in-from-bottom-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center font-bold transition-colors",
                      isPositive ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                    )}>
                      {isPositive ? <CheckCircle2 size={20} /> : <Flame size={20} />}
                    </div>
                    <div>
                      <p className="font-bold text-brand-800 text-sm">{habit.title}</p>
                      <p className="text-xs text-brand-400">{habit.category}</p>
                    </div>
                  </div>

                  <div className="flex flex-col items-end">
                    <span className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-full",
                      isPositive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
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
