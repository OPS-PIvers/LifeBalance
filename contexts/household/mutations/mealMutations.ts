import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import toast from 'react-hot-toast';
import { parseISO } from 'date-fns';
import { mealPlanItemConverter } from '@/utils/firestoreConverters';
import { Meal, MealPlanItem } from '@/types/schema';
import { sanitizeFirestoreData } from '@/utils/firestoreSanitizer';
import { getWeekRange } from '@/utils/listenerWindows';
import { track } from '@/services/analytics';
import type { User } from 'firebase/auth';

/**
 * Pure-ish factory for the meal + meal-plan mutation family
 * (`makeMealMutations`), moved verbatim out of FirebaseHouseholdContext.
 * `deps` mirrors exactly what the closures previously captured from the
 * provider's scope, so the provider can wire these into its existing
 * `useCallback`s with UNCHANGED dependency arrays.
 */
export function makeMealMutations(deps: {
  db: Firestore;
  householdId: string | null;
  user: User | null;
  mealPlanRef: { current: MealPlanItem[] };
  loadedMealPlanWeeksRef: { current: Set<string> };
  mealPlanWindowRef: { current: { start: string; end: string } };
  setMealPlanExtra: (updater: (prev: MealPlanItem[]) => MealPlanItem[]) => void;
}) {
  const { db, householdId, user, mealPlanRef, loadedMealPlanWeeksRef, mealPlanWindowRef, setMealPlanExtra } = deps;

  const addMeal = async (meal: Omit<Meal, 'id'>, options?: { suppressToast?: boolean }): Promise<string> => {
    if (!householdId || !user) throw new Error("Not authenticated");
    try {
      const sanitizedMeal = sanitizeFirestoreData(meal);
      const docRef = await addDoc(collection(db, `households/${householdId}/meals`), {
        ...sanitizedMeal,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      if (!options?.suppressToast) toast.success('Meal added');
      return docRef.id;
    } catch (error) {
      console.error('[addMeal] Failed:', error);
      toast.error('Failed to add meal');
      throw error;
    }
  };

  const updateMeal = async (meal: Meal) => {
    if (!householdId) return;
    try {
      const { id, ...mealData } = meal;
      const sanitizedData = sanitizeFirestoreData(mealData);
      await updateDoc(doc(db, `households/${householdId}/meals`, id), {
        ...sanitizedData,
        updatedAt: serverTimestamp(),
      });
      toast.success('Meal updated');
    } catch (error) {
      console.error('[updateMeal] Failed:', error);
      toast.error('Failed to update meal');
    }
  };

  const deleteMeal = async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, `households/${householdId}/meals`, id));
      toast.success('Meal deleted');
    } catch (error) {
      console.error('[deleteMeal] Failed:', error);
      toast.error('Failed to delete meal');
    }
  };

  // Fetch a single week of meal-plan entries that falls outside the live window,
  // replacing any previously-loaded entries for that week (so edits stay correct).
  const refreshMealPlanWeek = async (date: Date) => {
    if (!householdId) return;
    const { start, end } = getWeekRange(date);
    const live = mealPlanWindowRef.current;
    // Inside the live window — the real-time listener already covers it.
    if (start >= live.start && end <= live.end) return;
    try {
      const snap = await getDocs(query(
        collection(db, `households/${householdId}/mealPlan`).withConverter(mealPlanItemConverter),
        where('date', '>=', start),
        where('date', '<=', end)
      ));
      const page = snap.docs.map(doc => doc.data());
      loadedMealPlanWeeksRef.current.add(start);
      setMealPlanExtra(prev => [...prev.filter(i => i.date < start || i.date > end), ...page]);
    } catch (error) {
      console.error('[refreshMealPlanWeek] Failed:', error);
    }
  };

  // Public helper: load a navigated-to week once (no-op if already loaded/live).
  const ensureMealPlanWeek = async (date: Date) => {
    const { start, end } = getWeekRange(date);
    const live = mealPlanWindowRef.current;
    if (start >= live.start && end <= live.end) return;
    if (loadedMealPlanWeeksRef.current.has(start)) return;
    await refreshMealPlanWeek(date);
  };

  const addMealPlanItem = async (item: Omit<MealPlanItem, 'id'>, options?: { suppressToast?: boolean, throwOnError?: boolean }) => {
    if (!householdId || !user) return;
    try {
      await addDoc(collection(db, `households/${householdId}/mealPlan`), {
        ...item,
        createdAt: serverTimestamp(),
      });
      track('meal_planned');
      // Keep non-live weeks in sync (the live listener only covers current week ± 1).
      await refreshMealPlanWeek(parseISO(item.date));
      if (!options?.suppressToast) {
        toast.success('Added to plan');
      }
    } catch (error) {
      console.error('[addMealPlanItem] Failed:', error);
      if (!options?.suppressToast) {
        toast.error('Failed to add to plan');
      }
      if (options?.throwOnError) {
        throw error;
      }
    }
  };

  const updateMealPlanItem = async (id: string, updates: Partial<MealPlanItem>) => {
    if (!householdId) return;
    try {
      const previous = mealPlanRef.current.find(i => i.id === id);
      await updateDoc(doc(db, `households/${householdId}/mealPlan`, id), {
        ...updates,
      });
      // Refresh both the old and new week if either lies outside the live window.
      if (previous?.date) await refreshMealPlanWeek(parseISO(previous.date));
      if (updates.date && updates.date !== previous?.date) await refreshMealPlanWeek(parseISO(updates.date));
      toast.success('Plan updated');
    } catch (error) {
      console.error('[updateMealPlanItem] Failed:', error);
      toast.error('Failed to update plan');
    }
  };

  const deleteMealPlanItem = async (id: string) => {
    if (!householdId) return;
    try {
      const previous = mealPlanRef.current.find(i => i.id === id);
      await deleteDoc(doc(db, `households/${householdId}/mealPlan`, id));
      if (previous?.date) await refreshMealPlanWeek(parseISO(previous.date));
      toast.success('Removed from plan');
    } catch (error) {
      console.error('[deleteMealPlanItem] Failed:', error);
      toast.error('Failed to remove from plan');
    }
  };

  return {
    addMeal, updateMeal, deleteMeal,
    refreshMealPlanWeek, ensureMealPlanWeek,
    addMealPlanItem, updateMealPlanItem, deleteMealPlanItem,
  };
}
