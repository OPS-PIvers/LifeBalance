import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { useHouseholdCore } from '@/contexts/FirebaseHouseholdContext';
import { pastClosedWeeks, type RecapWeekRange } from '@/utils/recapWeek';
import { isoWeekStartDate } from '@/utils/dateHelpers';
import { RECAP_ARCHIVE_WEEKS } from '@/components/dashboard/recapVisibility';

/**
 * ARCH-1 — "Past weeks" archive: a browsable, non-expiring list of the most
 * recent `RECAP_ARCHIVE_WEEKS` CLOSED weeks. Unlike the ephemeral Dashboard
 * card (gone after `WEEKLY_RECAP_FRESHNESS_MS` or a dismiss tap), a row here
 * stays reachable for as long as it's within the archive's horizon — tapping
 * one resolves that week (stored doc if one exists, else derived from live
 * client state — see `useRecapForWeek`) and opens the SAME `WeeklyRecapDrawer`
 * every other recap entry point uses.
 *
 * This component only lists weeks and reports a selection; it does not know
 * whether the selected week has resolved yet — the caller (`WeeklyRecapCard`)
 * owns that via `useRecapForWeek` and passes `pendingWeek` back down so the
 * tapped row can show a spinner instead of going visibly inert while a
 * derived week's transactions load (or an on-demand stored-doc fetch
 * resolves), plus `errorWeek` for the case where that load FAILED. A failure
 * has to be visible HERE and not only in a toast: the toast may already have
 * been dismissed by the time the user looks back at the row, and an
 * indefinite spinner reads as "still working" forever. The failed row stays
 * enabled — tapping it is the retry.
 */
interface RecapArchiveDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectWeek: (isoWeek: string) => void;
  /** The isoWeek currently being resolved (post-tap, pre-drawer-open), or null. */
  pendingWeek: string | null;
  /** The isoWeek whose resolution failed and can be retried by tapping, or null. */
  errorWeek: string | null;
}

const weekLabel = (range: RecapWeekRange): string => {
  const start = isoWeekStartDate(range.isoWeek);
  return start ? `Week of ${format(start, 'MMM d')}` : range.isoWeek;
};

export const RecapArchiveDrawer: React.FC<RecapArchiveDrawerProps> = ({
  isOpen,
  onClose,
  onSelectWeek,
  pendingWeek,
  errorWeek,
}) => {
  const { recaps } = useHouseholdCore();
  const storedWeeks = useMemo(() => new Set(recaps.map(r => r.isoWeek)), [recaps]);

  // Computed only while open — this app's drawers stay mounted through their
  // exit animation (LazyMount convention), so recomputing on every open
  // rather than memoizing across the component's whole lifetime keeps "today"
  // fresh if the drawer is reopened on a later day.
  const weeks = useMemo(() => (isOpen ? pastClosedWeeks(RECAP_ARCHIVE_WEEKS) : []), [isOpen]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Past weeks">
      <ul className="divide-y divide-brand-100 dark:divide-brand-700/60">
        {weeks.map(range => {
          const isPending = pendingWeek === range.isoWeek;
          const isError = errorWeek === range.isoWeek;
          return (
            <li key={range.isoWeek}>
              <button
                type="button"
                onClick={() => onSelectWeek(range.isoWeek)}
                disabled={isPending}
                className="flex w-full min-h-11 items-center justify-between gap-3 py-3 text-left disabled:opacity-70 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 rounded-btn"
                aria-label={
                  isError
                    ? `Retry loading weekly recap for ${range.isoWeek}`
                    : `Open weekly recap for ${range.isoWeek}`
                }
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-brand-900 dark:text-brand-100">
                    {weekLabel(range)}
                  </span>
                  {isError && (
                    <span className="block text-xs font-medium text-money-neg dark:text-money-negDark">
                      Couldn&rsquo;t load — tap to retry
                    </span>
                  )}
                </span>
                {isPending ? (
                  <Loader2 size={16} className="animate-spin text-brand-400 dark:text-brand-450" aria-hidden="true" />
                ) : isError ? (
                  <RotateCcw size={16} className="shrink-0 text-money-neg dark:text-money-negDark" aria-hidden="true" />
                ) : (
                  <ChevronRight
                    size={16}
                    className={
                      storedWeeks.has(range.isoWeek)
                        ? 'text-accent-600 dark:text-accent-400'
                        : 'text-brand-400 dark:text-brand-450'
                    }
                    aria-hidden="true"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Drawer>
  );
};
