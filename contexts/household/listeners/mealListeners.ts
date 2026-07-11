import {
  collection,
  query,
  onSnapshot,
  where,
  orderBy,
  limit,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { mealConverter, mealPlanItemConverter } from '@/utils/firestoreConverters';
import { MEALS_LIMIT } from '@/utils/listenerWindows';
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
  setMealsWindow,
  setMealPlanWindow,
}: {
  db: Firestore;
  householdId: string;
  mealPlanRange: { start: string; end: string };
  setMealsWindow: (meals: Meal[]) => void;
  setMealPlanWindow: (items: MealPlanItem[]) => void;
}): Unsubscribe[] {
  const unsubscribers: Unsubscribe[] = [];

  // Meals listener — bounded to the most recently created recipes so the cold
  // load doesn't scale with the cookbook's lifetime size. Ordered by
  // `createdAt` (always written by addMeal) rather than the sparse `lastCooked`
  // — Firestore drops docs missing the orderBy field, so ordering by the
  // reliably-present field loses the fewest recipes. Legacy pre-`createdAt`
  // meals fall outside the window; they — and anything past the limit — remain
  // reachable via `loadAllMeals()` (cookbook view) and the by-id resolution of
  // meals referenced by mealPlan entries. Single-field orderBy: no composite
  // index needed.
  const mealsQuery = query(
    collection(db, `households/${householdId}/meals`).withConverter(mealConverter),
    orderBy('createdAt', 'desc'),
    limit(MEALS_LIMIT)
  );
  unsubscribers.push(
    onSnapshot(mealsQuery, (snapshot) => {
      setMealsWindow(snapshot.docs.map(doc => doc.data()));
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
