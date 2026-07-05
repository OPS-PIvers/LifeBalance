import {
  collection,
  query,
  onSnapshot,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { mealConverter, mealPlanItemConverter } from '@/utils/firestoreConverters';
import { Meal, MealPlanItem } from '@/types/schema';

/**
 * Attaches the meals + meal-plan listeners (verbatim move from
 * FirebaseHouseholdContext's main listener effect). `mealPlanRange` is the
 * live-window bound (current week +/- 1) read from `mealPlanWindowRef.current`
 * at the time the effect ran; weeks outside it are fetched on demand via
 * `refreshMealPlanWeek`/`ensureMealPlanWeek` (kept in mealMutations.ts).
 */
export function attachMealListeners({
  db,
  householdId,
  mealPlanRange,
  setMeals,
  setMealPlanWindow,
}: {
  db: Firestore;
  householdId: string;
  mealPlanRange: { start: string; end: string };
  setMeals: (meals: Meal[]) => void;
  setMealPlanWindow: (items: MealPlanItem[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // Meals listener
  const mealsQuery = query(collection(db, `households/${householdId}/meals`).withConverter(mealConverter));
  unsubscribers.push(
    onSnapshot(mealsQuery, (snapshot) => {
      setMeals(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('[meals] listener failed:', error);
    })
  );

  // Meal Plan listener — live window of the current week ± 1. Weeks the user
  // navigates to outside this range are fetched on demand via ensureMealPlanWeek().
  const mealPlanQuery = query(
    collection(db, `households/${householdId}/mealPlan`).withConverter(mealPlanItemConverter),
    where('date', '>=', mealPlanRange.start),
    where('date', '<=', mealPlanRange.end)
  );
  unsubscribers.push(
    onSnapshot(mealPlanQuery, (snapshot) => {
      setMealPlanWindow(snapshot.docs.map(doc => doc.data()));
    }, (error) => {
      console.error('Error listening to mealPlan:', error);
    })
  );

  return unsubscribers;
}
