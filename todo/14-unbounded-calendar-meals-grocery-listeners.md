# 14 — Bound the remaining unbounded `onSnapshot` listeners (calendar / meals / grocery)

## Problem
PR #616 windowed the high-churn listeners (transactions, completed todos, bucket history) with
cursor pagination, but three collections are still loaded **in full on every cold start** and grow
without bound for long-lived households:

- `calendarItems` — recurring-bill templates **plus** every materialized paid instance and tombstone.
- `meals` — the entire recipe cookbook.
- `groceryCatalog` — one doc per unique item ever purchased (grows on every purchase).

## Current state
- `contexts/FirebaseHouseholdContext.tsx:798` — `query(collection(db, '.../calendarItems'))`, no filter.
- `contexts/FirebaseHouseholdContext.tsx:953` — `query(collection(db, '.../meals'))`, no filter.
- `contexts/FirebaseHouseholdContext.tsx:971` — `query(collection(db, '.../groceryCatalog'))`, no filter.
- The Safe-to-Spend / action-queue logic expands **recurring templates** into future occurrences,
  so any filter on `calendarItems` must keep all active templates regardless of age.

## Proposed approach
- **groceryCatalog** (lowest risk): `orderBy('purchaseCount','desc'), limit(200)` for the live
  listener; do an on-demand Firestore query when the user types in the shopping form for items
  outside the cached set. Add the index to `firestore.indexes.json`.
- **meals**: live listener `orderBy('lastCooked','desc'), limit(50)`; load the full cookbook lazily
  when the recipe browser (`CookbookModal`) opens (a new `loadAllMeals()` action mirroring
  `loadAllTransactions`). Meals referenced by the current `mealPlan` must be fetched by id if not in
  the windowed set.
- **calendarItems** (highest risk): keep **all** recurring templates; window only non-recurring /
  materialized instances (e.g. `where('date','>=', <~6 months ago>)`), or archive paid instances to
  a subcollection on paycheck approval. Requires a composite index and careful expansion review.

## Risks
- Recurring-bill expansion silently breaking if a template is filtered out (calendar).
- Cookbook / catalog search returning incomplete results if the on-demand path is missed.
- Index build/propagation; deploy ordering (ship indexes before the query change).

## Acceptance criteria
- Cold-start reads for these three collections are bounded regardless of household age.
- Recurring-bill expansion, Safe-to-Spend, the cookbook browser, and shopping-form search all behave
  identically to today for in-window data and degrade gracefully (lazy-load) outside it.
- New indexes declared in `firestore.indexes.json`; `pnpm lint:all` + `pnpm test` green; build clean.
