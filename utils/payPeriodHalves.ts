import { format, parseISO, subDays } from 'date-fns';
import { CalendarItem } from '@/types/schema';
import { scheduledOccurrences } from '@/utils/calendarRecurrence';

/**
 * One "half": a pay period running from one payday to the day before the
 * next. Its id is the NOMINAL payday — the date the paychecks are scheduled
 * for, even when a weekend moved them earlier — which is also the HalfPlan id.
 */
export interface PayHalf {
  id: string;
  /** First day of the half: the earliest date one of its paychecks lands. */
  start: string;
  /** Last day, inclusive: the day before the next half starts. Null when the
   *  window holds no later paycheck to end it. */
  end: string | null;
}

/**
 * The nominal payday of a paycheck occurrence. An expanded occurrence carries
 * `nominalDate` when a weekend moved it; a PAID instance doc doesn't (it stores
 * only the date it was paid), so its template's schedule is consulted to find
 * which scheduled date it was moved from.
 */
export function nominalPaydayOf(item: CalendarItem, templatesById: ReadonlyMap<string, CalendarItem>): string {
  if (item.nominalDate) return item.nominalDate;
  const template = item.parentRecurringId ? templatesById.get(item.parentRecurringId) : undefined;
  if (!template?.isRecurring || !template.frequency || !template.weekendShift) return item.date;
  const paid = parseISO(item.date);
  const match = scheduledOccurrences(template.date, template.frequency, template, paid, paid)[0];
  return match?.nominalDate ?? item.date;
}

/** Whether an item is an occurrence of a REPEATING paycheck. One-off income
 *  (a bonus, a refund) lands inside a half but never starts one. */
function isRecurringPaycheck(item: CalendarItem, templatesById: ReadonlyMap<string, CalendarItem>): boolean {
  if (item.type !== 'income' || item.isDeleted) return false;
  if (item.parentRecurringId) return templatesById.get(item.parentRecurringId)?.isRecurring === true;
  return item.isRecurring === true;
}

/**
 * Splits the timeline into halves at each repeating paycheck.
 *
 * @param expanded Expanded calendar items for the window (expandCalendarItems
 *   output: occurrences plus paid instance docs). Expand a few weeks past the
 *   last half you need, so it has a next paycheck to end it.
 * @param rawItems The household's stored calendar items, for template lookup.
 *
 * Paychecks sharing a nominal payday (both earners paid on the 1st) open ONE
 * half, which starts on the earliest date any of them lands.
 */
export function buildPayHalves(expanded: CalendarItem[], rawItems: CalendarItem[]): PayHalf[] {
  const templatesById = new Map(rawItems.filter(i => i.isRecurring && !i.parentRecurringId).map(i => [i.id, i]));
  const startByNominal = new Map<string, string>();
  for (const item of expanded) {
    if (!isRecurringPaycheck(item, templatesById)) continue;
    const nominal = nominalPaydayOf(item, templatesById);
    const current = startByNominal.get(nominal);
    if (current === undefined || item.date < current) startByNominal.set(nominal, item.date);
  }
  const ordered = [...startByNominal.entries()]
    .map(([id, start]) => ({ id, start }))
    .sort((a, b) => (a.start === b.start ? a.id.localeCompare(b.id) : a.start.localeCompare(b.start)));
  return ordered.map((half, i) => {
    const next = ordered[i + 1];
    return {
      ...half,
      end: next ? format(subDays(parseISO(next.start), 1), 'yyyy-MM-dd') : null,
    };
  });
}

/** The half containing `date`, if the list covers it. */
export function findHalfContaining(halves: PayHalf[], date: string): PayHalf | undefined {
  return halves.find(h => h.start <= date && (h.end === null || date <= h.end));
}
