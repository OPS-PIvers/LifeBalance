# Plan 040 — Bound the three unbounded Firestore listeners (calendar / meals / grocery)

> **Status:** TODO · **Tag:** `[C→H]` (Claude builds each PR; a human watches the
> calendarItems index build and the production deploy) · **Risk:** MED overall,
> **HIGH for the calendarItems slice** · **Effort:** L (ship as **three independent
> PRs**, smallest-risk first) · **Planned against commit:** `4a971fc`
>
> Source findings: `todo/14-unbounded-calendar-meals-grocery-listeners.md`,
> `plans/audit/04-architecture-perf.md` (PERF-02, PERF-07),
> `plans/audit/01-roadmap-verification.md` (TECH-DEBT-01).

## Why this matters

`contexts/FirebaseHouseholdContext.tsx` opens an `onSnapshot` listener per collection
on every cold start. PR #616 already windowed the high-churn collections
(transactions, completed todos, bucket history) with `limit()` + on-demand loaders.
**Three collections are still loaded in full, forever, on every session start** and
grow without bound as a household ages:

- `calendarItems` — recurring-bill **templates** *plus* every materialized paid
  instance and tombstone.
- `meals` — the entire recipe cookbook.
- `groceryCatalog` — one doc per unique item ever purchased (grows on every purchase).

At small scale this is fine; at real-user scale it is the **dominant per-session read
cost** and a monetization blocker (PERF-02 is ranked #2 in the perf audit). A household
with two years of calendar items, hundreds of recipes, and a large grocery catalog
re-downloads all of it on every cold start — latency + Firebase read $$.

This is **not** a quick win. Each collection needs its own windowing strategy *and* an
on-demand path so nothing the UI relies on silently disappears. Read every "Trap"
callout below before writing code.

## The two traps that make this HIGH-risk

1. **`orderBy(field)` silently drops documents where `field` is missing or null.**
   This is core Firestore behavior, not a bug. If you bound `groceryCatalog` with
   `orderBy('purchaseCount','desc')` and some catalog docs have no `purchaseCount`,
   **those items vanish from the live listener** — and therefore from shopping
   autocomplete — even though they exist. Same for `meals` ordered by `lastCooked`
   (a meal never cooked has no `lastCooked` → it disappears from the cookbook). You
   MUST either guarantee the ordering field is present on every doc (write-path default
   **+ a one-time backfill**) or treat the bounded listener purely as a "recent/popular"
   cache backed by an on-demand full fetch that the UI falls back to. Do **both** where
   feasible.

2. **Atomic deploy: you cannot "ship the index first" inside one PR.** Production
   deploys run a single `firebase deploy` (rules + indexes + functions + hosting
   together — see `plans/PRD.md` §2). A query that needs a **composite** index will
   throw `FAILED_PRECONDITION: The query requires an index` in production until the
   index finishes building, which can take minutes. So any slice that needs a new
   composite index ships as **two** PRs: **PR-A adds only the index** to
   `firestore.indexes.json` (deploy, then a human watches it reach *Enabled* in the
   Firebase console → Firestore → Indexes), **PR-B changes the query**. Single-field
   `orderBy` uses **automatic** indexes (no `firestore.indexes.json` entry, available
   immediately), so the grocery and meals slices do **not** need this two-PR dance —
   only calendarItems does.

## Current state (anchors as of `4a971fc`; line numbers drift — match on the code)

All three are bare `query(collection(...))` with a converter and no filter/limit, in the
main subscription `useEffect` of `contexts/FirebaseHouseholdContext.tsx`:

```ts
// ~line 857  — calendarItems (HIGH risk to bound)
const calQuery = query(collection(db, `households/${householdId}/calendarItems`).withConverter(calendarItemConverter));

// ~line 1015 — meals
const mealsQuery = query(collection(db, `households/${householdId}/meals`).withConverter(mealConverter));

// ~line 1035 — groceryCatalog
const groceryCatalogQuery = query(collection(db, `households/${householdId}/groceryCatalog`).withConverter(groceryCatalogItemConverter));
```

## The exemplars to copy (already in this file — do not invent a new pattern)

PR #616 established the exact patterns. **Follow them.**

- **Limit + on-demand full load** (the model for `groceryCatalog` and `meals`):
  bucket history at **~833–837** uses `query(coll, orderBy('periodStartDate','desc'),
  limit(BUCKET_HISTORY_LIMIT))` for the live listener, and **`loadAllBucketHistory()`
  at ~1445** does `getDocs(query(coll, orderBy('periodStartDate','desc')))` (no limit)
  on demand. Insights at **~1319–1324 / `loadAllInsights()` ~1464** is the same shape.
  Mirror the naming: a `GROCERY_CATALOG_LIMIT` / `MEALS_LIMIT` const beside the existing
  `BUCKET_HISTORY_LIMIT` / `INSIGHTS_LIMIT`, and a `loadAllMeals()` /
  `loadAllGroceryCatalog()` callback mirroring `loadAllBucketHistory`'s structure
  (including its `try/catch` + the context-interface plumbing in the `Pick<>` unions
  and the `coreValue`/value memos).
- **Date-windowed listener + pagination** (the model for `calendarItems` instances):
  transactions at **~1380 / ~1406 / `loadAllTransactions()` ~1423** use
  `where('date','>=',windowStart), orderBy('date','desc')` live, with cursor pagination
  and a full-load fallback. Completed-todos at **~1487** shows a **composite** filter
  `where('isCompleted','==',true), where('completedAt','<',ts), orderBy('completedAt','desc')`
  — and its matching composite index already lives in `firestore.indexes.json` (the
  `todos` (isCompleted, completedAt) entry). That index entry is the template for any
  calendarItems composite index you add.

## Scope — three independent PRs, ship in this order (risk ascending)

> Each PR must keep `pnpm lint`, `pnpm test`, and `pnpm run build` green and ship behind
> tests. The required CI `validate` job is the gate. Do **one PR at a time**, merged and
> deploy-verified, before starting the next — never bundle two slices.

### PR 1 — `groceryCatalog` (LOWEST risk; no new index)

1. Add `GROCERY_CATALOG_LIMIT = 200` beside the other limit consts.
2. Change `groceryCatalogQuery` to
   `query(coll.withConverter(...), orderBy('purchaseCount','desc'), limit(GROCERY_CATALOG_LIMIT))`.
   **Trap 1 applies:** first confirm every `groceryCatalog` doc has a numeric
   `purchaseCount`. Inspect the write path (search the repo for where groceryCatalog
   docs are created/incremented — e.g. on purchase/restock) and the
   `groceryCatalogItemConverter` in `utils/firestoreConverters.ts`. If `purchaseCount`
   can be absent, **make the converter's `fromFirestore` default it to `0`** AND add a
   one-time backfill (mirror `utils/migrations/` if a migration helper exists) — OR
   order by a field guaranteed present. Do not bound the listener until items missing
   the ordering field cannot be dropped.
3. Wire an on-demand path for items outside the cached top-200: when the user types in
   the shopping/add-item form, run a targeted Firestore query (e.g.
   `where('nameLower','>=',q), where('nameLower','<=',q+''), limit(N)`) or a
   `loadAllGroceryCatalog()` that the autocomplete falls back to. Identify the consumer
   first (search for where the grocery catalog feeds suggestions — likely
   `components/meals/ShoppingListTab.tsx` or a catalog hook) and confirm it degrades
   gracefully. If no consumer reads the full catalog set for search, document that and
   the on-demand path may be deferred — but say so explicitly.
4. **Test:** extend `utils/firestoreConverters` tests for the `purchaseCount` default,
   and add/extend a context or hook test asserting the bounded query shape. Manually
   verify in Test Mode (`?test=true`) that the shopping catalog still suggests items.

### PR 2 — `meals` (MED risk; no new index, but the mealPlan-by-id trap)

1. Add `MEALS_LIMIT = 50`. Change `mealsQuery` to
   `orderBy('lastCooked','desc'), limit(MEALS_LIMIT)`. **Trap 1 applies hard here** —
   most meals will have no `lastCooked` until cooked, so a naive bound hides the bulk of
   the cookbook. Default `lastCooked` in the converter and/or fall back to a
   guaranteed-present field (e.g. `createdAt`); decide and document.
2. Add `loadAllMeals()` (mirror `loadAllBucketHistory`) and have the recipe browser /
   cookbook modal call it on open so the full cookbook is always reachable. Find the
   cookbook consumer (search for the meals list / `CookbookModal` / `MealPlanTab`).
3. **mealPlan-by-id trap:** meals referenced by the current weekly `mealPlan` may fall
   outside the windowed 50. The meal planner must still resolve them — fetch any
   missing referenced meal docs **by id** (`getDoc` per missing `mealId`) and merge them
   into the in-memory meals map, or the planner will render "unknown meal". Implement
   and test this explicitly.
4. **Test:** converter default for `lastCooked`; a test that a `mealPlan` referencing an
   out-of-window meal still resolves its name. Manual Test-Mode check of the meal planner
   + cookbook.

### PR 3 — `calendarItems` (HIGH risk; **needs a composite index → two sub-PRs + human watch**)

> **Recurring-bill expansion and Safe-to-Spend depend on having *every* active recurring
> template, regardless of age.** A filter that drops a template silently breaks bill
> projection and corrupts the core financial metric in production. This is the most
> dangerous change in the backlog. A human MUST watch the index build and the deploy.

Recommended design (least risky): **split into two listeners** rather than one filtered
query.
  - **Templates listener (unbounded but inherently small):** `where('isRecurring','==',true)`
    — keep ALL recurring templates, no date filter, no limit. There are few of these and
    they must never be dropped. (Confirm the field name on `CalendarItem` that marks a
    recurring template — inspect `types/schema.ts` and `calendarItemConverter`; it may be
    `isRecurring`, a `recurrence` enum, or a `frequency` field. Use the real one.)
  - **Instances listener (date-windowed):** non-recurring / materialized instances filtered
    to `where('isRecurring','==',false), where('date','>=', cutoffISO)` where `cutoff` is
    ~6 months ago, `orderBy('date','desc')`. This combination needs a **composite index**
    on `calendarItems` (isRecurring ASC, date DESC) — model it on the existing `todos`
    (isCompleted, completedAt) entry in `firestore.indexes.json`.
  - Add a `loadAllCalendarItems()` for any view that needs the full history (e.g. budget
    history); audit every reader of `calendarItems` (Safe-to-Spend memo,
    `useExpandedCalendarItems`, `UpcomingBillsWidget`, `BudgetCalendar`, action queue)
    and confirm none of them rely on having old *materialized* instances in the live set.

Sub-PR sequencing (because of Trap 2):
  - **PR 3a — index only:** add the `calendarItems` composite index to
    `firestore.indexes.json`. Merge → deploy → **human watches it reach *Enabled*** in the
    Firebase console (Firestore → Indexes). No code change in this PR.
  - **PR 3b — the query split:** only after 3a's index is Enabled, change the listener(s).
    Ship behind tests. **Human watches this deploy** and immediately smoke-checks
    Safe-to-Spend + upcoming bills on a real household (the values must be byte-identical
    to before for in-window data).

**STOP conditions for PR 3 — report back instead of improvising if any hold:**
- You cannot determine the exact field that distinguishes a recurring template from a
  materialized instance with certainty.
- Any current reader of `calendarItems` needs old materialized instances in the *live*
  set (not just on-demand).
- Bounding would change any Safe-to-Spend or upcoming-bills value for in-window data in
  the existing tests. (Run `utils/safeToSpendCalculator` tests and the calendar/expansion
  tests; they must stay green unchanged.)

## Out of scope (do not touch)
- The already-windowed listeners (transactions, completed todos, bucket history, insights).
- Any `firestore.rules` change (none is needed here; rules changes are a separate
  high-blast-radius track behind Plan 010's rules tests).
- The notification Cloud Functions and the quickAdd habit scan (PERF-03 / `todo/19` is a
  separate plan).
- Archiving paid instances to a subcollection (a heavier alternative to date-windowing;
  out of scope unless date-windowing proves insufficient — then write it up separately).

## Global acceptance criteria (per `todo/14`)
- Cold-start reads for `calendarItems`, `meals`, `groceryCatalog` are **bounded
  regardless of household age**.
- Recurring-bill expansion, Safe-to-Spend, the cookbook browser, and shopping-form search
  behave **identically to today for in-window data** and degrade gracefully (lazy-load)
  outside it. No item the UI relies on silently disappears (Trap 1).
- Any new composite index is declared in `firestore.indexes.json` and **was deployed +
  built before** the query that needs it (Trap 2).
- `pnpm lint:all` + `pnpm test` green; `pnpm run build` clean; each slice has tests for
  its converter default + on-demand fallback.

## Maintenance notes
- New code that reads any of these three collections must use the on-demand loader for
  full-set needs, never assume the live listener holds everything. Add a comment at each
  bounded listener pointing to its `loadAll*`.
- If a future feature filters/sorts these collections differently, it likely needs a new
  composite index — add it in a prior index-only PR (Trap 2).
- Keep the ordering-field defaults in the converters; removing them re-opens Trap 1.
