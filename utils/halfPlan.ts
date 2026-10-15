import { format, parseISO, subMonths } from 'date-fns';
import { CalendarItem, HalfAllocation, HalfPlan } from '@/types/schema';
import { sumMoney } from '@/utils/money';

/**
 * The every-dollar-gets-a-job math for one half (one pay period):
 *
 *   Left to assign = Paychecks − Dated bills − Spending budgets − Allocations
 *                    (+ From savings, an allocation that brings money back in)
 *
 * The goal is $0. Negative means the half is short (cover it from savings or
 * trim a budget); positive means money with no job yet. This is the PLAN; the
 * live Safe-to-Spend figure (balance − unpaid bills − pending) is separate and
 * deliberately not merged with it.
 */
export interface HalfSummary {
  paychecks: CalendarItem[];
  paycheckTotal: number;
  bills: CalendarItem[];
  billTotal: number;
  budgetTotal: number;
  /** Allocations that take money out (card extra, to savings, other). */
  allocationsOut: number;
  /** "From savings" lines, which bring money in. */
  fromSavings: number;
  leftToAssign: number;
}

const inRange = (date: string, start: string, end: string) => date >= start && date <= end;

/**
 * @param range The half's first and last day (inclusive).
 * @param expanded Expanded calendar items covering the range: occurrences plus
 *   paid instance docs. A paid item counts at what was actually paid (its
 *   stored amount); an unpaid one at its planned amount.
 * @param plan The saved plan for the half, if any.
 * @param bucketIds Buckets that still exist; planned amounts for deleted
 *   buckets are ignored rather than silently counted.
 */
export function summarizeHalf(
  range: { start: string; end: string },
  expanded: CalendarItem[],
  plan: HalfPlan | undefined,
  bucketIds: ReadonlySet<string>
): HalfSummary {
  const inHalf = expanded
    .filter(i => !i.isDeleted && inRange(i.date, range.start, range.end))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const paychecks = inHalf.filter(i => i.type === 'income');
  const bills = inHalf.filter(i => i.type === 'expense');

  const paycheckTotal = sumMoney(paychecks.map(i => i.amount));
  const billTotal = sumMoney(bills.map(i => i.amount));
  const budgetTotal = sumMoney(
    Object.entries(plan?.budgets ?? {})
      .filter(([bucketId]) => bucketIds.has(bucketId))
      .map(([, amount]) => amount)
  );
  const allocations = plan?.allocations ?? [];
  const allocationsOut = sumMoney(allocations.filter(a => a.kind !== 'from-savings').map(a => a.amount));
  const fromSavings = sumMoney(allocations.filter(a => a.kind === 'from-savings').map(a => a.amount));

  const leftToAssign = sumMoney([
    paycheckTotal,
    -billTotal,
    -budgetTotal,
    -allocationsOut,
    fromSavings,
  ]);

  return { paychecks, paycheckTotal, bills, billTotal, budgetTotal, allocationsOut, fromSavings, leftToAssign };
}

/** Whether a half is fully assigned (Left to assign is exactly $0). */
export function isFullyAssigned(summary: HalfSummary): boolean {
  return summary.leftToAssign === 0;
}

/**
 * The starting plan for a half nobody has planned yet: budgets and
 * allocations copied from the SAME half last month (the Nov 1 half copies
 * the Oct 1 half), falling back to the most recent earlier plan. Copied
 * allocations start unchecked with fresh ids. "From savings" lines are NOT
 * copied — they covered last month's shortfall, and carrying them forward
 * would hide whether this half is short at all.
 *
 * Returns an empty plan when nothing earlier exists.
 */
export function seedHalfPlan(halfId: string, plans: HalfPlan[], newId: () => string): HalfPlan {
  const sameSlotLastMonth = format(subMonths(parseISO(halfId), 1), 'yyyy-MM-dd');
  const source =
    plans.find(p => p.id === sameSlotLastMonth) ??
    [...plans].filter(p => p.id < halfId).sort((a, b) => b.id.localeCompare(a.id))[0];
  if (!source) return { id: halfId, budgets: {}, allocations: [] };
  const allocations: HalfAllocation[] = source.allocations
    .filter(a => a.kind !== 'from-savings')
    .map(({ done: _done, ...a }) => ({ ...a, id: newId() }));
  return { id: halfId, budgets: { ...source.budgets }, allocations };
}
