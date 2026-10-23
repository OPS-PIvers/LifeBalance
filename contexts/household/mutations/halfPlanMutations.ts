import { collection, doc, increment, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { Account, CalendarItem, HalfPlan } from '@/types/schema';
import { roundMoney } from '@/utils/money';
import { halfPlanConverter } from '@/utils/firestoreConverters';
import { allocationToggle, withAllocationDone } from '@/utils/halfPlan';
import { findOccurrenceOverride, isRecurringId, parseRecurringId, seriesAmountOn } from '@/utils/calendarRecurrence';

/** The stored form of a plan: amounts cent-rounded and positive, labels
 *  trimmed, stamped with who wrote it. */
function toStoredPlan(plan: HalfPlan, uid: string): HalfPlan {
  const budgets = Object.fromEntries(
    Object.entries(plan.budgets).map(([bucketId, amount]) => [bucketId, roundMoney(amount)])
  );
  const allocations = plan.allocations.map(a => ({
    id: a.id,
    kind: a.kind,
    label: a.label.trim().slice(0, 100),
    amount: roundMoney(Math.abs(a.amount)),
    ...(a.accountId ? { accountId: a.accountId } : {}),
    ...(a.done ? { done: true } : {}),
    ...(a.done && a.moved
      ? { moved: Object.fromEntries(Object.entries(a.moved).map(([id, d]) => [id, roundMoney(d)])) }
      : {}),
  }));
  return { id: plan.id, budgets, allocations, updatedAt: new Date().toISOString(), updatedBy: uid };
}

/**
 * Pay-period sheet: saves one half's plan (budgets per bucket + allocation
 * lines) as a whole document at `halfPlans/{nominal payday}`. A whole-doc
 * write keeps the allocation list consistent; two people editing the same
 * half at once is last-write-wins, like the rest of the household's lists.
 * Silent on success so the sheet can save as the user edits.
 */
export function makeHalfPlanMutations(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
}) {
  const { db, householdId, user } = deps;

  const saveHalfPlan = async (plan: HalfPlan) => {
    if (!householdId || !user) return;
    try {
      await setDoc(
        doc(db, `households/${householdId}/halfPlans`, plan.id).withConverter(halfPlanConverter),
        toStoredPlan(plan, user.uid)
      );
    } catch (error) {
      console.error('[saveHalfPlan] Failed:', error);
      toast.error(describeError(error, 'save this pay period\'s plan'));
      throw error;
    }
  };

  return { saveHalfPlan };
}

/**
 * Checks an allocation line off (or back on) and moves the money it names in
 * the SAME batch: "To savings" moves checking → savings, "From savings" the
 * other way, a card's extra payment lowers checking and the card's debt (see
 * `allocationTransfer`). The check mark and the balances can never disagree.
 * Unchecking reverses exactly what the check recorded in `moved` (see
 * `allocationToggle`), so a changed card or default account can't redirect it.
 */
export function makeSetAllocationDone(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  accounts: Account[];
  defaultAccountId: string | undefined;
}) {
  const { db, householdId, user, accounts, defaultAccountId } = deps;

  const setAllocationDone = async (plan: HalfPlan, allocationId: string, done: boolean) => {
    if (!householdId || !user) return;
    const allocation = plan.allocations.find(a => a.id === allocationId);
    if (!allocation || !!allocation.done === done) return;

    const transfer = allocationToggle(allocation, accounts, defaultAccountId, done);
    if (transfer.kind === 'missing') {
      toast.error(transfer.reason);
      return;
    }

    const next: HalfPlan = {
      ...plan,
      allocations: plan.allocations.map(a => (a.id === allocationId ? withAllocationDone(a, done, transfer) : a)),
    };
    const batch = writeBatch(db);
    batch.set(
      doc(db, `households/${householdId}/halfPlans`, plan.id).withConverter(halfPlanConverter),
      toStoredPlan(next, user.uid)
    );
    if (transfer.kind === 'move') {
      for (const [accountId, delta] of Object.entries(transfer.deltas)) {
        batch.update(doc(db, `households/${householdId}/accounts`, accountId), {
          balance: increment(roundMoney(delta)),
          lastUpdated: serverTimestamp(),
        });
      }
    }
    try {
      await batch.commit();
    } catch (error) {
      console.error('[setAllocationDone] Failed:', error);
      toast.error(describeError(error, done ? 'move this money' : 'undo this transfer'));
      throw error;
    }
  };

  return { setAllocationDone };
}

/** What a pasted month adds to the household (see utils/sheetPaste.ts). */
export interface SheetImport {
  /** Bills the app doesn't have yet: one-off expenses on their dates. */
  newBills: { title: string; amount: number; date: string }[];
  /** Bills the app has at a different amount: changed for that date only. */
  amountChanges: { item: CalendarItem; amount: number }[];
  /** The halves' plans with the sheet's budgets and allocation lines. */
  plans: HalfPlan[];
}

/**
 * Brings a month pasted from the household's Google Sheet in, in ONE batch:
 * new bills, one-month amount changes ("Just this month" overrides for a
 * recurring bill, the amount itself for an unpaid one-off) and the halves'
 * plans. All or nothing, so a failed import leaves nothing half-added to
 * retry on top of. Paid bills are never re-priced: their amount is what was
 * actually paid.
 */
export function makeImportSheetMonth(deps: {
  db: Firestore;
  householdId: string | null;
  user: { uid: string } | null;
  calendarItems: CalendarItem[];
}) {
  const { db, householdId, user, calendarItems } = deps;

  const importSheetMonth = async ({ newBills, amountChanges, plans }: SheetImport) => {
    if (!householdId || !user) return;
    const col = `households/${householdId}/calendarItems`;
    const batch = writeBatch(db);

    for (const bill of newBills) {
      batch.set(doc(collection(db, col)), {
        title: bill.title.trim().slice(0, 100),
        amount: roundMoney(Math.abs(bill.amount)),
        date: bill.date,
        type: 'expense',
        isPaid: false,
        isRecurring: false,
        createdBy: user.uid,
      });
    }

    for (const { item, amount } of amountChanges) {
      if (item.isPaid) continue;
      const rounded = roundMoney(Math.abs(amount));
      const parsed = isRecurringId(item.id) ? parseRecurringId(item.id) : null;
      if (!parsed) {
        batch.update(doc(db, col, item.id), { amount: rounded });
        continue;
      }
      const template = calendarItems.find(i => i.id === parsed.templateId);
      if (!template) continue;
      const override = findOccurrenceOverride(calendarItems, template.id, parsed.date);
      if (override) {
        batch.update(doc(db, col, override.id), { amount: rounded });
      } else if (rounded !== seriesAmountOn(template, parsed.date)) {
        batch.set(doc(collection(db, col)), {
          title: template.title,
          amount: rounded,
          date: parsed.date,
          type: template.type,
          isPaid: false,
          isRecurring: false,
          isOverride: true,
          parentRecurringId: template.id,
          createdBy: user.uid,
        });
      }
    }

    for (const plan of plans) {
      batch.set(
        doc(db, `households/${householdId}/halfPlans`, plan.id).withConverter(halfPlanConverter),
        toStoredPlan(plan, user.uid)
      );
    }

    try {
      await batch.commit();
      const parts = [
        newBills.length > 0 && `${newBills.length} bill${newBills.length === 1 ? '' : 's'} added`,
        amountChanges.length > 0 && `${amountChanges.length} amount${amountChanges.length === 1 ? '' : 's'} updated`,
        plans.length > 0 && 'budgets set',
      ].filter(Boolean);
      toast.success(parts.length > 0 ? `Imported: ${parts.join(', ')}` : 'Nothing new to import');
    } catch (error) {
      console.error('[importSheetMonth] Failed:', error);
      toast.error(describeError(error, 'import this month'));
      throw error;
    }
  };

  return { importSheetMonth };
}
