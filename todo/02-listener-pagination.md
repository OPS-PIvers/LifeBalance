# Handoff: Bound the unbounded Firestore `onSnapshot` listeners (pagination/windowing)

**Status:** Not started · **Priority:** High (read cost + scalability) · **Risk:** Medium (changes user-visible behavior)

---

## Problem

[`contexts/FirebaseHouseholdContext.tsx`](../contexts/FirebaseHouseholdContext.tsx) opens ~17
real-time `onSnapshot` listeners (listener block roughly lines 308–765), and several fetch **entire
collections** with no `limit()` and no date filter. The unbounded ones:

- `transactions` — highest cost; grows without bound.
- `bucketHistory` — `orderBy('periodStartDate','desc')` with no `limit()`.
- `todos`, `mealPlan` — full collection.
- `insights` — `orderBy('generatedAt','desc')` with no `limit()`.

A household with 1,000+ transactions pays 1,000+ document reads **per session, per listener
attachment**, hurts cold-start time on mobile, and the cost scales linearly with data age forever.

> Note: the composite/collection **indexes** these queries need were already added in PR #614
> (`firestore.indexes.json`: `bucketHistory`, `insights`, `submissions`). This work is about
> bounding the result sets, not the indexes.

---

## Why this needs a decision (deferred reason)

Bounding the reads **changes what the user sees** — e.g., the transaction list would show the
current pay period (or most-recent N) instead of all history, with a "load older" affordance. That
is a product/UX call, not a pure refactor, so it should be designed deliberately rather than
bundled into a mechanical optimization PR.

**Decision needed:** for each collection, what is the default window?
- Transactions: current pay period? last 90 days? last 100 rows?
- bucketHistory / insights: last N (e.g. 12 periods / 20 insights)?
- todos: active (incomplete) + completed within last N days?
- mealPlan: current week ± 1?

---

## Proposed approach

### A. Window the live listeners to a sensible default

Add `where`/`orderBy`/`limit` to the high-cardinality listeners. Examples (tune to the decision
above):

```ts
// transactions: current period only (live)
query(txCollection, where('payPeriodId', '==', currentPeriodId))
// or recent window:
query(txCollection, orderBy('date', 'desc'), limit(100))

// bucketHistory / insights: cap the live tail
query(historyCol, orderBy('periodStartDate', 'desc'), limit(12))
query(insightsCol, orderBy('generatedAt', 'desc'), limit(20))
```

Keep the listener **live** for the active window (real-time sync still matters for current data).

### B. "Load older" via cursor pagination (on demand, not live)

For history beyond the live window, fetch with `getDocs` + `startAfter(lastDoc)` on a button press,
appending to local state. These older pages don't need real-time listeners.

### C. UI affordances

- Transaction list (`components/budget/TransactionMasterList.tsx`): a "Load older" button or
  period selector; show which window is active.
- Make sure search/filter UX accounts for the fact that not all rows are loaded (either filter the
  loaded window, or switch to a server query when a filter is active).

### D. Stabilize listener churn (cheap win, do alongside)

The listener effect currently depends on `[householdId, user]` (~line 765). A new `user` object
reference (token refresh, profile refetch) tears down and re-subscribes all ~17 listeners. Change
the dependency to `user?.uid` so listeners only re-subscribe when the actual user changes.

---

## Risks & gotchas

- **Derived totals must stay correct.** `safeToSpend`, bucket-spent, and points are computed from
  collections in memory. If transactions are windowed, ensure these aggregates either (a) operate
  on a complete enough window (e.g. current period, which is what they need anyway), or (b) are
  computed server-side / from a maintained aggregate. Verify `utils/safeToSpendCalculator.ts` and
  `utils/bucketSpentCalculator.ts` only need the active period — if so, windowing transactions to
  the current period is actually *correct*, not just cheaper.
- **Filtering/search** over a partial dataset can mislead users — handle explicitly (see C).
- **Composite indexes** for any new `where + orderBy` combos must be added to
  `firestore.indexes.json` (Firestore will error with an index-creation link if missing).
- **Test Mode** (`MockHouseholdContext`) should mimic the same windowing API so behavior matches.

## Acceptance criteria

- [ ] Default cold load reads a bounded number of docs regardless of household age (verify in the
      Firestore usage tab or with a seeded large dataset).
- [ ] "Load older" correctly appends without duplicates and without breaking real-time updates to
      the live window.
- [ ] `safeToSpend` / bucket-spent / points remain correct under windowing (unit tests + manual).
- [ ] Listener dependency changed to `user?.uid`; no re-subscribe storm on token refresh.
- [ ] New indexes (if any) added to `firestore.indexes.json`.
- [ ] `pnpm lint` clean, `pnpm test` green, `pnpm run build` succeeds; Test Mode still works.
