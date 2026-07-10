import {
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  deleteField,
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
  goals: SavingsGoal[];
}) {
  const { db, householdId, goals } = deps;

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
   */
  const contributeToGoal = async (id: string, amount: number) => {
    if (!householdId) return;
    const rounded = roundMoney(amount);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      toast.error('Enter an amount greater than zero to contribute.');
      return;
    }
    const goal = goals.find(g => g.id === id);
    if (!goal) {
      toast.error('Could not find that savings goal.');
      return;
    }
    const newSaved = addMoney(goal.savedAmount, rounded);
    const patch: Record<string, unknown> = { savedAmount: newSaved };
    if (!goal.completedAt && newSaved >= goal.targetAmount) {
      patch.completedAt = new Date().toISOString();
    }
    await updateDoc(doc(db, `households/${householdId}/savingsGoals`, id), patch);
    toast.success('Contribution added');
  };

  return { addSavingsGoal, updateSavingsGoal, deleteSavingsGoal, contributeToGoal };
}
