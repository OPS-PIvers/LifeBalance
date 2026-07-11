import React, { useMemo, useState } from 'react';
import { format, isSameMonth, isToday, addMonths, subMonths, subDays, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import DayHabitEditor from '@/components/habits/DayHabitEditor';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { useHabitCalendarData } from '@/hooks/useHabitCalendarData';
import { getLocalDateString } from '@/utils/dateHelpers';
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
 * A compact month calendar sits on top (future days disabled); each day cell
 * shows the signed net habit points earned that day (green positive / red
 * negative). Tapping a past day swaps the DayHabitEditor below to that day —
 * tap a habit to log one unit for THAT date, × to clear the day. All writes
 * ride the back-dating-aware submissions path (`addHabitSubmission` /
 * `resetHabitDay`), which owns past-period points, that day's streak
 * multiplier, and the no-double-award guard — this component adds no scoring
 * logic of its own.
 */
const PastDayLogModal: React.FC<PastDayLogModalProps> = ({ isOpen, onClose }) => {
  const { habits } = useGamification();

  const today = getLocalDateString();
  // Default to yesterday — the day people most often forgot to log.
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    format(subDays(parseISO(today), 1), 'yyyy-MM-dd')
  );
  const [currentMonth, setCurrentMonth] = useState<Date>(() => parseISO(selectedDate));

  const { monthStart, days } = useCalendarGrid(currentMonth);

  // Same parent-visible set as the Track tab: kid chores (assignedTo) excluded.
  const sortedHabits = useMemo(
    () => habits.filter(h => !h.assignedTo).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)),
    [habits]
  );

  const { netPointsByDate, countForHabitOnDate, refresh } = useHabitCalendarData(sortedHabits, days);

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
              const netPoints = netPointsByDate.get(dateStr) ?? 0;
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  disabled={isFuture}
                  className={cn(
                    'relative flex flex-col items-center justify-center h-11 w-full rounded-card text-sm font-medium leading-none transition-[transform,background-color] duration-(--duration-fast) ease-(--ease-standard)',
                    !isSameMonth(day, monthStart) && 'opacity-30',
                    isFuture && 'opacity-25 cursor-not-allowed',
                    isSelected
                      ? 'bg-warm-500 text-white font-bold scale-105 z-10'
                      : !isFuture && 'hover:bg-brand-100 dark:hover:bg-brand-700/50 text-brand-700 dark:text-brand-200',
                    isToday(day) && !isSelected && 'font-bold ring-1 ring-inset ring-brand-300 dark:ring-brand-600'
                  )}
                  aria-label={`${format(day, 'MMMM d')}${netPoints !== 0 ? `, ${netPoints > 0 ? '+' : ''}${netPoints} points` : ''}`}
                  aria-pressed={isSelected}
                >
                  {format(day, 'd')}
                  {/* Signed net day points: green positive, red negative. */}
                  {netPoints !== 0 && !isFuture && (
                    <span
                      className={cn(
                        'mt-0.5 text-[9px] font-bold tabular-nums',
                        isSelected
                          ? 'text-white'
                          : netPoints > 0
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
            })}
          </div>
        </div>

        {/* Selected-day habit editor */}
        <DayHabitEditor
          habits={sortedHabits}
          selectedDate={selectedDate}
          selectedLabel={selectedLabel}
          countForHabitOnDate={countForHabitOnDate}
          onMutated={refresh}
        />
      </div>
    </Drawer>
  );
};

export default PastDayLogModal;
