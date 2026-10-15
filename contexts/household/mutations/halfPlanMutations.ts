import { doc, increment, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { Account, HalfPlan } from '@/types/schema';
import { roundMoney } from '@/utils/money';
import { halfPlanConverter } from '@/utils/firestoreConverters';
import { allocationTransfer } from '@/utils/halfPlan';

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
 * Unchecking reverses the move exactly.
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

    const transfer = allocationTransfer(allocation, accounts, defaultAccountId, done);
    if (transfer.kind === 'missing') {
      toast.error(transfer.reason);
      return;
    }

    const next: HalfPlan = {
      ...plan,
      allocations: plan.allocations.map(a => (a.id === allocationId ? { ...a, done } : a)),
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
