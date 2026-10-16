import { format, parseISO, subMonths } from 'date-fns';
import {
  Account,
  BudgetBucket,
  CalendarItem,
  CREDIT_CARD_CATEGORY,
  HalfAllocation,
  HalfPlan,
  INCOME_CATEGORY,
  Transaction,
} from '@/types/schema';
import { sumMoney } from '@/utils/money';
import { fundedHalfId, type PayHalf } from '@/utils/payPeriodHalves';

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
 * @param half The half (its first and last day, inclusive). Bills count by
 *   due date inside it; income counts toward the half it FUNDS
 *   (`fundedHalfId`), so the paycheck that lands Sep 27 pays for Oct 1–15.
 * @param expanded Expanded calendar items covering the half, plus about a
 *   week either side (for the paychecks that fund it): occurrences plus paid
 *   instance docs. A paid item counts at what was actually paid (its
 *   stored amount); an unpaid one at its planned amount.
 * @param plan The saved plan for the half, if any.
 * @param bucketIds Buckets that still exist; planned amounts for deleted
 *   buckets are ignored rather than silently counted.
 */
export function summarizeHalf(
  half: PayHalf,
  expanded: CalendarItem[],
  plan: HalfPlan | undefined,
  bucketIds: ReadonlySet<string>
): HalfSummary {
  const live = expanded
    .filter(i => !i.isDeleted)
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const paychecks = live.filter(i => i.type === 'income' && fundedHalfId(i.date) === half.id);
  const bills = live.filter(i => i.type === 'expense' && inRange(i.date, half.start, half.end));

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

/** What checking off an allocation does to account balances. */
export type AllocationTransfer =
  | { kind: 'move'; deltas: Record<string, number> }
  /** Nothing to move ("other" lines just get checked off). */
  | { kind: 'none' }
  /** A side of the transfer has no account to land in. */
  | { kind: 'missing'; reason: string };

const activeOfType = (accounts: Account[], type: Account['type']) =>
  accounts.filter(a => a.type === type && !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/**
 * The balance changes for marking an allocation done (`done: true`) or undone.
 * Checking is the household's default account when that is a checking
 * account, else its first checking account; savings is the line's own
 * account, else the first savings account; a card payment needs its card.
 *
 *   to-savings    checking −x, savings +x
 *   from-savings  savings −x, checking +x
 *   card-extra    checking −x, card debt −x
 *
 * Undoing applies the exact opposite, so a mis-tap can be taken back.
 */
export function allocationTransfer(
  allocation: HalfAllocation,
  accounts: Account[],
  defaultAccountId: string | undefined,
  done: boolean
): AllocationTransfer {
  if (allocation.kind === 'other' || allocation.amount === 0) return { kind: 'none' };
  const preferred = accounts.find(a => a.id === defaultAccountId && a.type === 'checking' && !a.archived);
  const checking = preferred ?? activeOfType(accounts, 'checking')[0];
  if (!checking) return { kind: 'missing', reason: 'Add a checking account first' };

  const own = accounts.find(a => a.id === allocation.accountId && !a.archived);
  const x = done ? allocation.amount : -allocation.amount;

  if (allocation.kind === 'card-extra') {
    if (own?.type !== 'credit') return { kind: 'missing', reason: 'Pick which card this payment goes to' };
    return { kind: 'move', deltas: { [checking.id]: -x, [own.id]: -x } };
  }
  const savings = own?.type === 'savings' ? own : activeOfType(accounts, 'savings')[0];
  if (!savings) return { kind: 'missing', reason: 'Add a savings account first' };
  return allocation.kind === 'to-savings'
    ? { kind: 'move', deltas: { [checking.id]: -x, [savings.id]: x } }
    : { kind: 'move', deltas: { [savings.id]: -x, [checking.id]: x } };
}

/** One due day on the sheet: a date and the bills that land on it. */
export interface SheetDay {
  date: string;
  bills: CalendarItem[];
}

/** The half's bills grouped by date — only days that have one (phone layout B). */
export function dueDays(summary: HalfSummary): SheetDay[] {
  const byDate = new Map<string, CalendarItem[]>();
  for (const bill of summary.bills) {
    byDate.set(bill.date, [...(byDate.get(bill.date) ?? []), bill]);
  }
  return [...byDate.entries()].map(([date, bills]) => ({ date, bills }));
}

/**
 * The line that brings Left to assign to $0: a short half is covered from
 * savings, a long one sends the rest to savings. When the plan already has a
 * line of that kind, it grows instead of a second one appearing. Null when
 * the half is already fully assigned.
 */
export function balancingPlan(plan: HalfPlan, summary: HalfSummary, newId: () => string): HalfPlan | null {
  const gap = summary.leftToAssign;
  if (gap === 0) return null;
  const kind: HalfAllocation['kind'] = gap < 0 ? 'from-savings' : 'to-savings';
  const amount = Math.abs(gap);
  const existing = plan.allocations.find(a => a.kind === kind && !a.done);
  const allocations = existing
    ? plan.allocations.map(a => (a === existing ? { ...a, amount: sumMoney([a.amount, amount]) } : a))
    : [...plan.allocations, { id: newId(), kind, label: gap < 0 ? 'From savings' : 'Leftover to savings', amount }];
  return { ...plan, allocations };
}

/**
 * What each bucket has actually spent during a half: transactions dated in
 * the half whose category names the bucket (the same name matching, income
 * and credit-card exclusions as `calculateBucketSpent`), verified and pending
 * alike. Keyed by bucket id.
 */
export function halfBucketActuals(
  buckets: BudgetBucket[],
  transactions: Transaction[],
  range: { start: string; end: string }
): Map<string, number> {
  const idsByName = new Map<string, string[]>();
  for (const b of buckets) {
    const key = b.name.toLowerCase();
    idsByName.set(key, [...(idsByName.get(key) ?? []), b.id]);
  }
  const amounts = new Map<string, number[]>();
  for (const tx of transactions) {
    if (!tx.category || tx.category === INCOME_CATEGORY || tx.category === CREDIT_CARD_CATEGORY) continue;
    if (tx.date < range.start || tx.date > range.end) continue;
    for (const id of idsByName.get(tx.category.toLowerCase()) ?? []) {
      amounts.set(id, [...(amounts.get(id) ?? []), tx.amount]);
    }
  }
  return new Map(buckets.map(b => [b.id, sumMoney(amounts.get(b.id) ?? [])]));
}

/** A way to fix a budget that ran over, keeping Left to assign where it was. */
export interface OverrunFix {
  /** 'savings' covers it from savings; 'bucket' moves room from `fromBucketId`. */
  kind: 'savings' | 'bucket';
  fromBucketId?: string;
  plan: HalfPlan;
}

/**
 * The fixes on offer when `bucketId` has spent more than planned this half.
 * Each raises that budget by the overrun and funds it — from savings (a
 * "From savings" line) or from another budget with at least that much
 * planned and unspent — so the half stays exactly as assigned as it was.
 * Only live budgets (`bucketIds`, the same set `summarizeHalf` counts) can
 * give: lowering a deleted budget's leftover plan entry would free nothing.
 */
export function overrunFixes(
  plan: HalfPlan,
  bucketId: string,
  actuals: ReadonlyMap<string, number>,
  newId: () => string,
  bucketIds: ReadonlySet<string>
): OverrunFix[] {
  const planned = plan.budgets[bucketId] ?? 0;
  const over = sumMoney([actuals.get(bucketId) ?? 0, -planned]);
  if (over <= 0) return [];
  const raised = { ...plan.budgets, [bucketId]: sumMoney([planned, over]) };

  const existing = plan.allocations.find(a => a.kind === 'from-savings' && !a.done);
  const fromSavings: OverrunFix = {
    kind: 'savings',
    plan: {
      ...plan,
      budgets: raised,
      allocations: existing
        ? plan.allocations.map(a => (a === existing ? { ...a, amount: sumMoney([a.amount, over]) } : a))
        : [...plan.allocations, { id: newId(), kind: 'from-savings', label: 'From savings', amount: over }],
    },
  };

  const fromBuckets = Object.entries(plan.budgets)
    .filter(([id, amount]) => id !== bucketId && bucketIds.has(id) && sumMoney([amount, -(actuals.get(id) ?? 0)]) >= over)
    .map(([id, amount]): OverrunFix => ({
      kind: 'bucket',
      fromBucketId: id,
      plan: { ...plan, budgets: { ...raised, [id]: sumMoney([amount, -over]) } },
    }));

  return [fromSavings, ...fromBuckets];
}
