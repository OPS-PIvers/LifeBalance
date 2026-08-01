import React, { useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import { cn } from '@/utils/cn';
import { getLocalDateString } from '@/utils/dateHelpers';
import {
  groupPointsLedgerByDate,
  type PointsLedgerEntry,
} from '@/utils/pointsLedger';

interface PointsLedgerListProps {
  /** Already-built ledger — see utils/pointsLedger.ts for the sum invariant. */
  entries: readonly PointsLedgerEntry[];
  /** Copy shown when the row's total came from nothing in this period. */
  emptyLabel: string;
  /** "Today" (yyyy-MM-dd, local); injectable so tests can pin the date labels. */
  today?: string;
  className?: string;
}

/**
 * `+12` / `−3` / `0`. The minus is U+2212, matching the habit calendar's own
 * legend (a hyphen reads as a dash beside tabular figures).
 */
const formatSignedPoints = (points: number): string => {
  if (points > 0) return `+${points}`;
  if (points < 0) return `−${Math.abs(points)}`;
  return '0';
};

/**
 * The itemized list behind an expanded scoreboard row — every habit that moved
 * that row's total, grouped under the date it was completed on.
 *
 * Shared by BOTH scoreboard surfaces (the Dashboard's `ScoreboardWidget` and
 * the TopToolbar's `PointsBreakdownDrawer`) so a row's receipt reads the same
 * wherever the scoreboard appears. Purely presentational: it takes a built
 * ledger and never scores anything itself, which is what keeps the one scoring
 * path in `utils/pointsLedger.ts`.
 *
 * A line can legitimately read `0`: a threshold habit's second completion in
 * the same period earns nothing extra, and dropping it would leave a tap the
 * user remembers making unaccounted for. Those lines are muted rather than
 * colored, so the eye still lands on what actually moved the number.
 */
const PointsLedgerList: React.FC<PointsLedgerListProps> = ({
  entries,
  emptyLabel,
  today = getLocalDateString(),
  className,
}) => {
  const days = useMemo(() => groupPointsLedgerByDate(entries), [entries]);

  if (days.length === 0) {
    return (
      <p className={cn('text-xxs text-brand-500 dark:text-brand-400', className)}>{emptyLabel}</p>
    );
  }

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {days.map(day => (
        <li key={day.date}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-500 dark:text-brand-400">
              {day.date === today ? 'Today' : format(parseISO(day.date), 'EEE, MMM d')}
            </span>
            <span className="font-mono text-[10px] font-semibold tabular-nums text-brand-500 dark:text-brand-400">
              {formatSignedPoints(day.points)}
            </span>
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {day.entries.map(entry => (
              <li
                key={`${entry.habitId}-${entry.source}`}
                className="flex items-baseline gap-2"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-brand-700 dark:text-brand-200">
                  {entry.habitTitle}
                </span>
                {entry.units > 1 && (
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-brand-500 dark:text-brand-400">
                    {`×${entry.units}`}
                  </span>
                )}
                <span
                  className={cn(
                    'shrink-0 font-mono text-xs font-semibold tabular-nums',
                    entry.points > 0 && 'text-money-pos dark:text-money-posDark',
                    entry.points < 0 && 'text-money-neg dark:text-money-negDark',
                    entry.points === 0 && 'text-brand-450 dark:text-brand-450',
                  )}
                >
                  {formatSignedPoints(entry.points)}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
};

export default PointsLedgerList;
