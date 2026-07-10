import {
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  deleteField,
  runTransaction,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { SavingsGoal } from '@/types/schema';
import { addMoney, roundMoney } from '@/utils/money';

/**
 * Plan 24 (savings goals / sinking funds) mutations: addSavingsGoal /
 * updateSavingsGoal / deleteSavingsGoal / contributeToGoal.
 *
 * v1 = manual contributions only. `contributeToGoal` does a single doc
 * `savedAmount += x` update (cents-safe via `utils/money.ts`) and sets
 * `completedAt` when the new total reaches the target. HARD INVARIANT: none of
 * this ever touches an Account balance or a Transaction, so goals cannot feed
 * `utils/safeToSpendCalculator.ts` — see CLAUDE.md.
 */
export function makeSavingsGoalMutations(deps: {
  db: Firestore;
  householdId: string | null;
}) {
  const { db, householdId } = deps;

  const addSavingsGoal = async (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'completedAt'>) => {
    if (!householdId) return;
    await addDoc(collection(db, `households/${householdId}/savingsGoals`), {
      ...goal,
      savedAmount: roundMoney(goal.savedAmount),
      targetAmount: roundMoney(goal.targetAmount),
      createdAt: new Date().toISOString(),
    });
    toast.success('Savings goal created');
  };

  const updateSavingsGoal = async (id: string, updates: Partial<Pick<SavingsGoal, 'name' | 'targetAmount' | 'dueDate' | 'ownerId' | 'color'>>) => {
    if (!householdId) return;
    const patch: Record<string, unknown> = { ...updates };
    if (typeof updates.targetAmount === 'number') {
      patch.targetAmount = roundMoney(updates.targetAmount);
    }
    // Allow explicitly clearing dueDate/ownerId/color by passing an empty string.
    if (updates.dueDate === '') patch.dueDate = deleteField();
    if (updates.ownerId === '') patch.ownerId = deleteField();
    if (updates.color === '') patch.color = deleteField();
    await updateDoc(doc(db, `households/${householdId}/savingsGoals`, id), patch);
    toast.success('Savings goal updated');
  };

  const deleteSavingsGoal = async (id: string) => {
    if (!householdId) return;
    await deleteDoc(doc(db, `households/${householdId}/savingsGoals`, id));
    toast.success('Savings goal deleted');
  };

  /**
   * Manual "Add to goal" contribution. Validates amount > 0, adds it to the
   * goal's savedAmount in integer cents, and stamps completedAt the moment the
   * total first reaches the target (never un-sets it if later edits raise the
   * target back above savedAmount — that reopening is a v2 concern).
   *
   * Runs in a `runTransaction` so two devices contributing at once can't
   * lost-update each other: the add is computed from the value read INSIDE the
   * transaction (not the stale in-memory `goals` array), and the completedAt
   * decision uses that same authoritative total.
   */
  const contributeToGoal = async (id: string, amount: number) => {
    if (!householdId) return;
    const rounded = roundMoney(amount);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      toast.error('Enter an amount greater than zero to contribute.');
      return;
    }
    const ref = doc(db, `households/${householdId}/savingsGoals`, id);
    try {
      await runTransaction(db, async txn => {
        const snap = await txn.get(ref);
        if (!snap.exists()) throw new Error('missing-goal');
        const data = snap.data() as Pick<
          SavingsGoal,
          'savedAmount' | 'targetAmount' | 'completedAt'
        >;
        const newSaved = addMoney(data.savedAmount ?? 0, rounded);
        const patch: Record<string, unknown> = { savedAmount: newSaved };
        if (!data.completedAt && newSaved >= data.targetAmount) {
          patch.completedAt = new Date().toISOString();
        }
        txn.update(ref, patch);
      });
      toast.success('Contribution added');
    } catch (error) {
      // A genuinely-missing goal is a handled, user-facing case; any other
      // failure (e.g. a denied write) is a real error — surface a distinct
      // message and RETHROW so the caller keeps the contribution form open
      // instead of silently clearing it as if the write succeeded.
      if (error instanceof Error && error.message === 'missing-goal') {
        toast.error('Could not find that savings goal.');
        return;
      }
      toast.error('Could not add your contribution. Please try again.');
      throw error;
    }
  };

  return { addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, contributeToGoal };
}
