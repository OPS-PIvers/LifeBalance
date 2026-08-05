import { addDays, format, isSaturday, isSunday, nextSaturday, parseISO } from 'date-fns';
import { getLocalDateString } from '@/utils/dateHelpers';

/** One due-date shortcut offered by a triage surface. */
export interface QuickPick {
  key: string;
  label: string;
  /** `yyyy-MM-dd`, always a LOCAL calendar date. */
  date: string;
}

/**
 * Due-date shortcuts shared by every to-do triage surface (the uncategorized
 * `TodoTriageDrawer` and the "Saved for later" `PromoteToDoSheet`), so the two
 * can't drift into offering different dates for the same word.
 *
 * All four are derived from `getLocalDateString()` (never the UTC day — see
 * CLAUDE.md). "This weekend" is the coming Saturday, or today when it already
 * IS the weekend.
 *
 * Callers re-invoke this per open rather than computing it once at module load,
 * so a session left running past midnight never hands out yesterday's "Today".
 */
export const buildQuickPicks = (): QuickPick[] => {
  const today = parseISO(getLocalDateString());
  const weekend = isSaturday(today) || isSunday(today) ? today : nextSaturday(today);
  return [
    { key: 'today', label: 'Today', date: format(today, 'yyyy-MM-dd') },
    { key: 'tomorrow', label: 'Tomorrow', date: format(addDays(today, 1), 'yyyy-MM-dd') },
    { key: 'weekend', label: 'This weekend', date: format(weekend, 'yyyy-MM-dd') },
    { key: 'next-week', label: 'Next week', date: format(addDays(today, 7), 'yyyy-MM-dd') },
  ];
};
