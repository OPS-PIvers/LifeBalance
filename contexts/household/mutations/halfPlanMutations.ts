import { doc, setDoc, type Firestore } from 'firebase/firestore';
import toast from 'react-hot-toast';
import { describeError } from '@/utils/errorMessages';
import { HalfPlan } from '@/types/schema';
import { roundMoney } from '@/utils/money';
import { halfPlanConverter } from '@/utils/firestoreConverters';

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
    try {
      await setDoc(
        doc(db, `households/${householdId}/halfPlans`, plan.id).withConverter(halfPlanConverter),
        { id: plan.id, budgets, allocations, updatedAt: new Date().toISOString(), updatedBy: user.uid }
      );
    } catch (error) {
      console.error('[saveHalfPlan] Failed:', error);
      toast.error(describeError(error, 'save this pay period\'s plan'));
      throw error;
    }
  };

  return { saveHalfPlan };
}
