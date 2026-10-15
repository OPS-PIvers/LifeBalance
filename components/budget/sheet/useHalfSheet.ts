import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import type { CalendarItem, HalfAllocation, HalfAllocationKind, HalfPlan } from '@/types/schema';
import { useFinance } from '@/contexts/FirebaseHouseholdContext';
import { balancingPlan, halfBucketActuals, overrunFixes, type HalfSummary } from '@/utils/halfPlan';
import { isRecurringId, occurrenceAmount, parseRecurringId } from '@/utils/calendarRecurrence';
import { resolveTargetAccount } from '@/utils/accountImpact';
import type { PayHalf } from '@/utils/payPeriodHalves';

export const ALLOCATION_LABELS: Record<HalfAllocationKind, string> = {
  'to-savings': 'To savings',
  'from-savings': 'From savings',
  'card-extra': 'Extra card payment',
  other: 'Other',
};

const newId = () => crypto.randomUUID();
/** Mutations toast their own errors; the sheet just carries on. */
const quietly = (p: Promise<unknown>) => void p.catch(() => undefined);

/** A recurring row's new amount, waiting on "which months?". */
export interface PendingAmount {
  item: CalendarItem;
  amount: number;
}

/**
 * Everything a half's sheet does, shared by the desktop table and the phone
 * list: paying bills, typed amounts (asking "Just this month" or "This and
 * future months" for a repeating one), adding, renaming, moving and deleting
 * rows, planned budgets, and allocation lines.
 */
export function useHalfSheet(half: PayHalf, plan: HalfPlan, summary: HalfSummary, isSeed: boolean) {
  const {
    accounts,
    buckets,
    calendarItems,
    transactions,
    defaultAccountId,
    addCalendarItem,
    updateCalendarItem,
    setOccurrenceAmount,
    editCalendarEntry,
    deleteCalendarItem,
    payCalendarItem,
    saveHalfPlan,
    setAllocationDone,
  } = useFinance();
  const [pending, setPending] = useState<PendingAmount | null>(null);

  const actuals = useMemo(() => halfBucketActuals(buckets, transactions, half), [buckets, transactions, half]);
  const save = (next: HalfPlan) => quietly(saveHalfPlan(next));

  /** What a row was planned at. A paid occurrence of a repeating bill keeps
   *  only what was paid, so its plan comes from the series. */
  const planned = (item: CalendarItem): number => {
    if (!item.isPaid || !item.parentRecurringId) return item.amount;
    const template = calendarItems.find(i => i.id === item.parentRecurringId);
    return template ? occurrenceAmount(calendarItems, template, item.date) : item.amount;
  };

  const pay = (item: CalendarItem, actualAmount?: number) => {
    const account = resolveTargetAccount(item.accountId, accounts, defaultAccountId);
    if (!account) return;
    quietly(payCalendarItem(item.id, account.id, actualAmount === undefined ? undefined : { actualAmount }));
  };

  /** A typed amount: one-off rows change now; repeating rows ask which months. */
  const changeAmount = (item: CalendarItem, amount: number | undefined) => {
    if (amount === undefined || amount === item.amount) return;
    if (isRecurringId(item.id)) setPending({ item, amount });
    else quietly(updateCalendarItem({ ...item, amount }));
  };

  /**
   * Applies the pending amount to the months chosen. `edits` are a new name
   * or date saved in the same go: they are written AFTER the amount (and a
   * moved occurrence carries the new amount), so no write overwrites another.
   */
  const applyPending = async (scope: 'one' | 'future', edits: { title?: string; date?: string } = {}) => {
    if (!pending) return;
    const { item, amount } = pending;
    setPending(null);
    const moved = !!edits.date && edits.date !== item.date;
    try {
      if (scope === 'one') {
        // A moved occurrence becomes a one-off on its new date at the new amount.
        if (moved) await editCalendarEntry(item.id, { ...edits, amount });
        else {
          await setOccurrenceAmount(item.id, amount);
          if (edits.title) await editCalendarEntry(item.id, { title: edits.title });
        }
        return;
      }
      const template = calendarItems.find(i => i.id === parseRecurringId(item.id)?.templateId);
      if (template) await updateCalendarItem({ ...template, amount }, { amountFrom: item.date });
      if (moved) await editCalendarEntry(item.id, { ...edits, amount });
      else if (edits.title) await editCalendarEntry(item.id, { title: edits.title });
    } catch {
      // The mutation already told the user.
    }
  };

  const addBill = (date: string, title: string, amount: number, type: CalendarItem['type'] = 'expense') =>
    addCalendarItem({ id: newId(), title: title.trim(), amount: Math.abs(amount), date, type, isPaid: false });

  const rename = (item: CalendarItem, title: string) => {
    if (title.trim() && title.trim() !== item.title) quietly(editCalendarEntry(item.id, { title: title.trim() }));
  };

  const setBudget = (bucketId: string, amount: number | undefined) => {
    const budgets = { ...plan.budgets };
    if (amount === undefined) delete budgets[bucketId];
    else budgets[bucketId] = amount;
    save({ ...plan, budgets });
  };

  const updateAllocation = (id: string, patch: Partial<HalfAllocation>) =>
    save({ ...plan, allocations: plan.allocations.map(a => (a.id === id ? { ...a, ...patch } : a)) });

  const addAllocation = (kind: HalfAllocationKind) => {
    const card = kind === 'card-extra' ? accounts.find(a => a.type === 'credit' && !a.archived) : undefined;
    save({
      ...plan,
      allocations: [
        ...plan.allocations,
        { id: newId(), kind, label: ALLOCATION_LABELS[kind], amount: 0, ...(card ? { accountId: card.id } : {}) },
      ],
    });
  };

  const removeAllocation = (id: string) => save({ ...plan, allocations: plan.allocations.filter(a => a.id !== id) });

  const setDone = (id: string, done: boolean) => quietly(setAllocationDone(plan, id, done));

  /** Brings Left to assign to $0 from (or into) savings. */
  const balance = () => {
    const next = balancingPlan(plan, summary, newId);
    if (next) save(next);
  };

  const fixesFor = (bucketId: string) => (isSeed ? [] : overrunFixes(plan, bucketId, actuals, newId));

  /** "Just October" / "This and future months" for the pending row. */
  const pendingMonth = pending ? format(parseISO(pending.item.date), 'MMMM') : '';

  return {
    isSeed,
    accounts,
    buckets,
    actuals,
    pending,
    pendingMonth,
    setPending,
    applyPending,
    planned,
    pay,
    changeAmount,
    addBill,
    rename,
    editCalendarEntry,
    deleteCalendarItem,
    setBudget,
    updateAllocation,
    addAllocation,
    removeAllocation,
    setDone,
    balance,
    fixesFor,
    save,
  };
}

export type HalfSheetApi = ReturnType<typeof useHalfSheet>;
