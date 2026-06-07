# 12 — Split `MealsContext` into meal-plan vs shopping slices

## Problem
The meals slice bundles three independently-updating arrays — `meals`, `mealPlan`,
`groceryCatalog`, `shoppingList` (plus `stores`) — into one context value. Checking
off a single shopping item updates `shoppingList`, which produces a new `mealsValue`
reference and re-renders **every** `useMeals()` consumer, including the large
`MealPlanTab` (~950 lines) and `ShoppingListTab` (~700 lines) even when only one is
visible.

This is the same over-subscription problem the main context split (todo 01) already
addressed for the five top-level slices — meals just wasn't sub-divided.

## Current state
- `contexts/FirebaseHouseholdContext.tsx` `mealsValue` (~L3545–3585; re-grep):
  includes `meals`, `shoppingList`, `mealPlan`, `groceryCatalog`, `stores`, and all
  meal/shopping actions.
- `components/meals/MealPlanTab.tsx` reads `meals` + `mealPlan` (+ `groceryCatalog`).
- `components/meals/ShoppingListTab.tsx` reads `shoppingList` (+ `groceryCatalog`,
  `stores`).
- `components/budget/TransactionMasterList.tsx` reads only `stores` from `useMeals()`.

## Proposed approach
1. Split into `MealPlanContext` (`meals`, `mealPlan` + their actions) and
   `ShoppingContext` (`shoppingList`, `groceryCatalog`, `stores` + their actions).
2. Provide `useMealPlan()` / `useShopping()` hooks; keep a thin `useMeals()`
   compatibility shim during migration (mirror the existing slice pattern).
3. Migrate the meal/shopping/transaction components to the granular hooks.
4. Consider exposing `stores` via a tiny `useStores()` so `TransactionMasterList`
   stops subscribing to shopping churn.

## Risks
- Many consumers to update; behavior must stay identical.
- Provider nesting/order changes in the context tree.

## Acceptance criteria
- Toggling a shopping item does not re-render `MealPlanTab` (verify with a render
  counter / React DevTools profiler).
- All meals/shopping features behave identically; tests green.
- `pnpm lint && pnpm test` green.
