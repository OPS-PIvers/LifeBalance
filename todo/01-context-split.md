# Handoff: Split the monolithic `FirebaseHouseholdContext`

**Status:** Not started · **Priority:** Highest (single biggest render-perf win) · **Risk:** High (large blast radius)

---

## Problem

The entire app's state lives in one React context:
[`contexts/FirebaseHouseholdContext.tsx`](../contexts/FirebaseHouseholdContext.tsx) (~2,996 lines).

Two compounding issues:

1. **One giant context value (~70+ fields + ~40 action callbacks).** Every component that calls
   `useHousehold()` subscribes to *all* of it. Adding a single transaction re-renders the meal
   planner, habit tracker, and to-do list — none of which use transactions.

2. **The `useMemo` wrapping the context value has a ~90-entry dependency array**, so it is
   effectively never memoized — the value object gets a new reference on essentially every render,
   defeating `React.memo` on any consumer.

These are the root cause behind much of the "everything re-renders" behavior. Fixing it is the
highest-leverage performance change available, but it touches nearly every consumer file, which is
why it was deferred to its own PR.

### Evidence / where to look

- Provider + 17–20 `onSnapshot` listeners and `setState` calls: `FirebaseHouseholdContext.tsx`
  (listener block roughly lines 308–765).
- The monolithic `contextValue = useMemo(() => ({...}), [...~90 deps])` near the bottom
  (roughly lines 2843–2972).
- Consumers: `grep -rln "useHousehold" --include="*.tsx" .` — finance pages/components, habits,
  meals, todos, dashboard widgets, modals, layout.

---

## Proposed approach

Split by **domain**, keep a **backward-compatible shim**, then migrate consumers incrementally so
each step stays green and reviewable.

### Step 1 — Extract domain contexts (no consumer changes yet)

Create separate contexts, each with its own `useMemo`'d value and **tight** dependency arrays:

- `FinanceContext` — `accounts`, `buckets`, `transactions`, `calendarItems`, `currentPeriodId`,
  `bucketSpentMap`, `safeToSpend`, and their actions.
- `GamificationContext` — `habits`, `dailyPoints`, `weeklyPoints`, `totalPoints`, `challenges`,
  `activeChallenge`, `rewards`, `freezeBank`, and actions.
- `MealsContext` — `meals`, `mealPlan`, `shoppingList`, `groceryCatalog`, and actions.
- `TodosContext` — `todos` and actions.
- `HouseholdCoreContext` — `householdId`, `members`, `isLoading`, `insight`, `insightsHistory`,
  settings, and household-level actions.

Keep the single provider component that owns the Firestore listeners (or split those too — see
[02-listener-pagination.md](./02-listener-pagination.md)), but feed each slice into its own
context provider. Each slice's `useMemo` should depend **only** on the state it exposes.

### Step 2 — Granular hooks

Export `useFinance()`, `useGamification()`, `useMeals()`, `useTodos()`, `useHouseholdCore()`.
Follow the existing `react-refresh/only-export-components` exception pattern already used for hooks.

### Step 3 — Compatibility shim

Keep `useHousehold()` as a composed hook that reads all slices and returns the old shape, so files
not yet migrated keep working. This lets the split land **without** rewriting every consumer in one
PR.

> ⚠️ The shim itself will re-render on any slice change (it reads all of them). The perf win only
> materializes for consumers that switch to the **granular** hooks. Prioritize migrating the
> heavy/often-re-rendering consumers (below); the long tail can move over time.

### Step 4 — Migrate heavy consumers to granular hooks

These are the components that currently suffer cross-domain re-renders most:

- `components/meals/MealPlanTab.tsx`, `components/meals/ShoppingListTab.tsx` → `useMeals()`
- `pages/ToDosPage.tsx` → `useTodos()` (+ `useHouseholdCore()` for members)
- `components/budget/TransactionMasterList.tsx`, `pages/Budget.tsx` → `useFinance()`
- `pages/Habits.tsx`, `components/habits/*` → `useGamification()`
- Dashboard widgets → whichever single slice each needs

### Alternative

If the multi-context approach feels heavy, a state library with **selector-based subscriptions**
(e.g. Zustand) achieves the same "only re-render on the slice you read" outcome with less
boilerplate. Trade-off: introduces a new dependency and a second state paradigm alongside Context.
Given the app already centralizes everything in Context, splitting Context is the
lower-churn-of-concept path; pick based on team preference.

---

## Risks & gotchas

- **Cross-domain derived state.** `safeToSpend` depends on finance data only — clean. But verify
  nothing in one slice secretly reads another (e.g., an action that touches both habits and
  transactions, like verifying a transaction that increments a related habit — see
  `updateTransactionCategory`). Such actions may need to live in a coordinating layer or accept
  the other slice's setter.
- **Provider nesting order** must respect dependencies (core/household outermost).
- **Test Mode parity.** `contexts/MockHouseholdContext.tsx` mirrors the real context's shape and
  **must** be split/updated in lockstep, or Test Mode breaks. Keep the same hook names.
- **StrictMode double-invoke** and listener setup/teardown — preserve existing cleanup semantics.

## Acceptance criteria

- [ ] `pnpm lint` clean, `pnpm test` green, `pnpm run build` succeeds.
- [ ] `useHousehold()` shim keeps un-migrated consumers working (no behavior change).
- [ ] At least the heavy consumers listed in Step 4 use granular hooks.
- [ ] Verified re-render reduction: editing a transaction does **not** re-render `MealPlanTab` /
      `ToDosPage` (confirm with React DevTools Profiler or `why-did-you-render` locally).
- [ ] `MockHouseholdContext` updated to match; Test Mode (`/#/login?test=true`) still works.
- [ ] Each domain context's `useMemo` deps are minimal (no 90-entry arrays).

## Suggested PR slicing

1. PR A: extract contexts + granular hooks + compatibility shim + Mock parity (no consumer changes).
2. PR B+: migrate consumer groups (meals, then todos, then finance, then habits), one reviewable
   batch at a time.
