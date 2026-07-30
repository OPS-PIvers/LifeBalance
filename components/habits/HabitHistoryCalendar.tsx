import React, { useState, useMemo } from 'react';
import { useGamification, useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { format, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import { ChevronLeft, ChevronRight, Snowflake } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { useHabitCalendarData } from '@/hooks/useHabitCalendarData';
import DayHabitEditor from '@/components/habits/DayHabitEditor';
import { getLocalDateString } from '@/utils/dateHelpers';
import { buildHabitRowMemberContext } from '@/utils/habitRowAttribution';
import { Habit } from '@/types/schema';
import { cn } from '@/utils/cn';

// Optimization: Memoized calendar day to prevent re-rendering the entire grid on selection change
interface CalendarDayProps {
  day: Date;
  /** Signed net habit points earned on this day. */
  netPoints: number;
  isSelected: boolean;
  isCurrentMonth: boolean;
  isFuture: boolean;
  isToday: boolean;
  /** Plan 25: an auto-applied freeze protected at least one streak this day. */
  isFrozen: boolean;
  onSelect: (date: Date) => void;
}

const CalendarDay = React.memo(({ day, netPoints, isSelected, isCurrentMonth, isFuture, isToday, isFrozen, onSelect }: CalendarDayProps) => {
  return (
    <button
      onClick={() => onSelect(day)}
      disabled={isFuture}
      className={cn(
        "relative flex flex-col items-center justify-center h-12 w-full rounded-card text-sm font-medium leading-none transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard)",
        !isCurrentMonth && "opacity-30",
        isFuture && "opacity-25 cursor-not-allowed",
        isSelected
          ? "ring-2 ring-warm-500 dark:ring-warm-400 scale-105 z-10 bg-brand-100 dark:bg-brand-700/60 text-brand-900 dark:text-brand-50"
          : "hover:scale-105 hover:bg-brand-100 dark:hover:bg-brand-700/50 text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-700/30",
        // Frozen day: distinct habit-blue marker (a frozen day is NOT a
        // completion, so it never affects the points figure).
        isFrozen && !isSelected && "ring-1 ring-habit-blue/40",
        isFrozen && "bg-habit-blue/15 dark:bg-habit-blue/20",
        isToday && !isSelected && "font-bold ring-1 ring-inset ring-brand-300 dark:ring-brand-600"
      )}
      aria-label={`${format(day, 'MMM d')}: ${netPoints > 0 ? '+' : ''}${netPoints} points${isFrozen ? ', streak protected by a freeze' : ''}`}
    >
      {format(day, 'd')}
      {/* Signed net day points: green positive, red negative. */}
      {netPoints !== 0 && !isFuture && (
        <span
          className={cn(
            'mt-0.5 text-[10px] font-bold tabular-nums',
            netPoints > 0
              ? 'text-money-pos dark:text-money-posDark'
              : 'text-money-neg dark:text-money-negDark'
          )}
          aria-hidden="true"
        >
          {netPoints > 0 ? `+${netPoints}` : netPoints}
        </span>
      )}
    </button>
  );
});
CalendarDay.displayName = 'CalendarDay';

const HabitHistoryCalendar: React.FC = () => {
  const { habits } = useGamification();
  const { members, currentUser } = useHouseholdCore();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const today = getLocalDateString();

  // The History tab is a standalone surface with no parent to inherit the
  // roster from, so it builds its own (memoized on the roster, exactly as the
  // Habits page does for HabitCard).
  const rowMemberContext = useMemo(
    () => buildHabitRowMemberContext(members, currentUser?.uid),
    [members, currentUser?.uid]
  );

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

  // Same parent-visible set as the Track tab and PastDayLogModal: kid chores
  // (assignedTo) excluded, so the day cells sum to the HOUSEHOLD points the
  // toolbar shows (assigned chores credit the kid's own balance instead).
  const sortedHabits = useMemo(
    () => habits.filter(h => !h.assignedTo).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [habits]
  );

  const { netPointsByDate, countForHabitOnDate, refresh } = useHabitCalendarData(sortedHabits, days);

  // Plan 25: days where an auto-applied freeze protected a streak. Frozen days
  // are NOT completions — they get their own marker, never a points figure.
  const frozenByDate = useMemo(() => {
    const frozen = new Map<string, Habit[]>();
    sortedHabits.forEach(habit => {
      (habit.frozenDates ?? []).forEach(date => {
        if (!frozen.has(date)) frozen.set(date, []);
        frozen.get(date)!.push(habit);
      });
    });
    return frozen;
  }, [sortedHabits]);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const selectedLabel = selectedDateStr === today ? 'Today' : format(selectedDate, 'EEEE, MMMM d');

  return (
    // 🛡️ NO entrance animation on this wrapper. `DayHabitEditor`'s "who did
    // this?" picker is a non-portalled Popover anchored on a row INSIDE here,
    // and both an animating opacity and `slide-in-from-bottom-4`'s transform
    // create a stacking context on this element for the animation's whole
    // duration — which traps the picker's z-dropdown panel behind the Habits
    // page's sticky tab strip (z-30). The trailing "Who did …?" button opens
    // the picker on a plain click with no 500ms floor, so a tap landing inside
    // that window would silently paint the panel behind the strip. There is
    // nothing to gate the animation on here (unlike HabitCard, whose transform
    // is gated on its own picker state), so it simply goes.
    <div className="space-y-6">
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
            // String compare avoids allocating Date objects for every cell on every render.
            const isSelected = dateStr === selectedDateStr;
            const isCurrentMonth = isSameMonth(day, monthStart);

            return (
              <CalendarDay
                key={dateStr}
                day={day}
                netPoints={netPointsByDate.get(dateStr) ?? 0}
                isSelected={isSelected}
                isCurrentMonth={isCurrentMonth}
                isFuture={dateStr > today}
                isToday={isToday(day)}
                isFrozen={frozenByDate.has(dateStr)}
                onSelect={setSelectedDate}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center justify-end gap-3 text-xxs font-bold text-brand-300 dark:text-brand-450 uppercase tracking-wide">
          <span className="flex items-center gap-1 normal-case">
            <Snowflake size={10} className="text-habit-blue" /> Frozen
          </span>
          <span className="flex items-center gap-1 normal-case">
            <span className="font-bold text-money-pos dark:text-money-posDark">+pts</span> earned
          </span>
          <span className="flex items-center gap-1 normal-case">
            <span className="font-bold text-money-neg dark:text-money-negDark">−pts</span> lost
          </span>
        </div>
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

      {/* Selected-day editor: the same add/increment/clear surface as the
          "Log a past day" drawer, so history is editable in place. */}
      <DayHabitEditor
        habits={sortedHabits}
        selectedDate={selectedDateStr}
        selectedLabel={selectedLabel}
        countForHabitOnDate={countForHabitOnDate}
        onMutated={refresh}
        attribution={rowMemberContext}
      />
    </div>
  );
};

export default HabitHistoryCalendar;
