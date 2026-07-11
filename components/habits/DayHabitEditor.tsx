import React, { useCallback, useMemo, useState } from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { CalendarDays, Plus, Star, X } from 'lucide-react';
import { useGamification } from '@/contexts/FirebaseHouseholdContext';
import { Habit } from '@/types/schema';
import { Badge } from '@/components/ui/Badge';
import Eyebrow from '@/components/ui/Eyebrow';
import EmptyState from '@/components/ui/EmptyState';
import { getLocalDateString } from '@/utils/dateHelpers';
import { signedHabitPoints } from '@/utils/habitLogic';
import { track } from '@/services/analytics';
import { cn } from '@/utils/cn';

interface DayHabitEditorProps {
  /** Parent-visible habits (kid chores excluded), already sorted. */
  habits: Habit[];
  /** The day being edited (YYYY-MM-DD). */
  selectedDate: string;
  /** Human label for the day ("Today" / "Tuesday, July 8"). */
  selectedLabel: string;
  /** Units of a habit logged on a date (from useHabitCalendarData). */
  countForHabitOnDate: (habit: Habit, date: string) => number;
  /** Called after any successful mutation so the caller can refetch. */
  onMutated: () => void;
}

/**
 * DayHabitEditor — the editable habit list for one calendar day, shared by
 * PastDayLogModal and the History tab's HabitHistoryCalendar so both surfaces
 * edit history identically.
 *
 * Interaction mirrors the Track tab's HabitCard: tapping a row logs one more
 * unit for THAT day (via the back-dating-aware `addHabitSubmission`, which
 * owns past-period points, the day's prospective streak multiplier, and the
 * no-double-award guard), and the small × on an active row clears the whole
 * day (`resetHabitDay`), reversing exactly the points that day earned. Points
 * labels are signed via `signedHabitPoints` — a negative habit reads "-2 pts"
 * regardless of which sign convention its basePoints were stored with.
 */
const DayHabitEditor: React.FC<DayHabitEditorProps> = ({
  habits,
  selectedDate,
  selectedLabel,
  countForHabitOnDate,
  onMutated,
}) => {
  const { addHabitSubmission, resetHabitDay } = useGamification();

  // Habit ids with an in-flight write, so a slow network can't double-log a
  // tap. The stable mutable Set is the actual guard — it updates synchronously
  // inside the handler, so a fast double-tap that lands before React re-renders
  // is still caught. The state mirror only drives the disabled/dimmed row UI.
  const [inFlightIds] = useState(() => new Set<string>());
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const groupedHabits = useMemo<[string, Habit[]][]>(() => {
    const groups = new Map<string, Habit[]>();
    habits.forEach(h => {
      const list = groups.get(h.category) ?? [];
      list.push(h);
      groups.set(h.category, list);
    });
    return Array.from(groups.entries());
  }, [habits]);

  const runGuarded = useCallback(async (habitId: string, action: () => Promise<void>) => {
    if (inFlightIds.has(habitId)) return;
    inFlightIds.add(habitId);
    setBusyIds(new Set(inFlightIds));
    try {
      await action();
      onMutated();
    } finally {
      inFlightIds.delete(habitId);
      setBusyIds(new Set(inFlightIds));
    }
  }, [inFlightIds, onMutated]);

  const handleLog = useCallback((habit: Habit) => runGuarded(habit.id, async () => {
    // One unit per tap — Track-tab parity (threshold habits fill toward their
    // target tap by tap; incremental habits score per action). Noon keeps the
    // timestamp unambiguously inside the chosen local day.
    await addHabitSubmission(habit.id, 1, `${selectedDate}T12:00:00`);
    track('habit_past_day_logged', {
      daysAgo: differenceInCalendarDays(parseISO(getLocalDateString()), parseISO(selectedDate)),
      positive: habit.type === 'positive',
    });
  }), [addHabitSubmission, runGuarded, selectedDate]);

  const handleClearDay = useCallback((habit: Habit) => runGuarded(habit.id, async () => {
    await resetHabitDay(habit.id, selectedDate);
  }), [resetHabitDay, runGuarded, selectedDate]);

  if (habits.length === 0) {
    return (
      <EmptyState
        variant="dashed"
        icon={<CalendarDays size={28} />}
        title="No habits yet"
        description="Create a habit first, then come back to log past days."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between px-1">
        <h4 className="font-display font-semibold text-brand-800 dark:text-brand-100">
          {selectedLabel}
        </h4>
        <span className="text-xs font-medium text-brand-400 dark:text-brand-450">
          Tap to log · × clears the day
        </span>
      </div>

      {groupedHabits.map(([category, categoryHabits]) => (
        <div key={category}>
          <Eyebrow as="h3" className="mb-2 px-1">{category}</Eyebrow>
          <div className="surface-section overflow-hidden [&>*:first-child]:border-t-0">
            {categoryHabits.map(habit => {
              const isPositive = habit.type === 'positive';
              const dayCount = countForHabitOnDate(habit, selectedDate);
              const isBusy = busyIds.has(habit.id);
              const dayPoints = signedHabitPoints(habit);
              return (
                <div
                  key={habit.id}
                  className={cn(
                    'relative w-full px-4 py-3 hairline-divider flex items-center gap-3 text-left transition-colors duration-(--duration-fast)',
                    'hover:bg-brand-50 dark:hover:bg-brand-700/40',
                    isBusy && 'opacity-60'
                  )}
                >
                  {/* Row-wide tap target: logs one more unit for this day. */}
                  <button
                    type="button"
                    onClick={() => handleLog(habit)}
                    disabled={isBusy}
                    className="absolute inset-0 w-full h-full cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-warm-500/40 rounded-none"
                    aria-label={
                      dayCount > 0
                        ? `Log ${habit.title} again for ${selectedLabel} (currently ${dayCount})`
                        : `Log ${habit.title} for ${selectedLabel}`
                    }
                    style={{ zIndex: 1 }}
                  />

                  <span className="relative shrink-0" style={{ zIndex: 2 }}>
                    <span
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full border font-bold font-mono pointer-events-none',
                        dayCount > 0
                          ? isPositive
                            ? 'bg-money-pos border-money-pos text-white'
                            : 'bg-money-neg border-money-neg text-white'
                          : 'border-brand-300 dark:border-brand-600 text-brand-300 dark:text-brand-500'
                      )}
                      aria-hidden="true"
                    >
                      {dayCount > 0 ? dayCount : <Plus size={16} />}
                    </span>
                    {/* Clear-day ×: Track-tab reset parity, scoped to this date. */}
                    {dayCount > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleClearDay(habit);
                        }}
                        disabled={isBusy}
                        className="absolute -top-2 -right-2 p-2 -m-2 bg-white dark:bg-brand-700 border border-brand-200 dark:border-brand-600 rounded-full w-6 h-6 flex items-center justify-center text-brand-400 dark:text-brand-300 active:scale-90 hover:bg-money-bgNeg dark:hover:bg-money-neg/20 hover:text-money-neg dark:hover:text-money-negDark hover:border-money-neg/30 transition-colors focus:outline-hidden focus:ring-2 focus:ring-offset-1 focus:ring-money-neg/50"
                        aria-label={`Clear ${habit.title} for ${selectedLabel}`}
                        style={{ zIndex: 3 }}
                      >
                        <X size={12} strokeWidth={3} />
                      </button>
                    )}
                  </span>

                  <span className="min-w-0 flex-1 pointer-events-none" style={{ zIndex: 2 }}>
                    <span className={cn(
                      'block text-sm font-semibold truncate',
                      dayCount > 0 ? 'text-brand-900 dark:text-brand-50' : 'text-brand-800 dark:text-brand-100'
                    )}>
                      {habit.title}
                    </span>
                    <span className="mt-0.5 flex items-center gap-2 text-xxs font-medium text-brand-400 dark:text-brand-450">
                      <span className={cn(
                        'inline-flex items-center gap-0.5 font-bold',
                        isPositive
                          ? 'text-money-pos dark:text-money-posDark'
                          : 'text-money-neg dark:text-money-negDark'
                      )}>
                        <Star size={10} className="fill-current text-habit-gold" aria-hidden="true" />
                        {dayPoints > 0 ? `+${dayPoints}` : dayPoints} pts
                      </span>
                      {habit.period === 'weekly' && <Badge variant="neutral" size="sm">Weekly</Badge>}
                    </span>
                  </span>

                  <span
                    className={cn(
                      'relative shrink-0 text-xxs font-bold uppercase tracking-wide pointer-events-none',
                      dayCount > 0 ? 'text-accent-600 dark:text-accent-400' : 'text-brand-400 dark:text-brand-450'
                    )}
                    style={{ zIndex: 2 }}
                  >
                    {dayCount > 0 ? '+1 more' : 'Log'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <p className="px-1 text-xs text-brand-400 dark:text-brand-450">
        Edits apply to this day with the streak that applied then — daily, weekly, and total points adjust automatically.
      </p>
    </div>
  );
};

export default DayHabitEditor;
