# 11 — `syncHouseholdPoints` recomputes (and can re-write) on every habit toggle

## Problem
The `syncHouseholdPoints` effect depends on `householdSettings?.points` (and, via the
habits slice, on `habits`). Every habit toggle writes incremented points to the
household doc → the `householdSettings` snapshot fires → the effect re-runs. Inside
the effect, `calculatePointsForDate` (O(habits)) and `calculatePointsForDateRange`
(O(habits × completedDates), constructing a `new Set(completedDates)` per
`streakEndingOn` call) run **before** the short-circuit guard. For a user with many
habits and long histories this is meaningful wasted work on every toggle.

Worse, when the effect *does* write reset markers (`lastDailyPointsReset` /
`lastWeeklyPointsReset`), that write re-triggers the `householdSettings` listener,
which re-runs the effect — a write→listener→effect cycle that is only damped by the
guard.

## Current state
- `contexts/FirebaseHouseholdContext.tsx` `syncHouseholdPoints` effect
  (~L1526–1597 pre-Wave 2; re-grep): full recompute precedes the
  `if (!needsUpdate && resetMarkersUpToDate) return;` short-circuit.
- `utils/habitLogic.ts` `streakEndingOn` (~L109–120) allocates a Set per call;
  `calculatePointsForDateRange` (~L326–375) calls it per completion per habit.
- `checkPointsReset` (midnight scheduler) also writes the same reset markers,
  producing duplicate writes with the sync effect.

## Proposed approach
1. Move the cheap short-circuit **before** the expensive recompute: compare the
   stored `points.{daily,weekly,total}` against a stable "last synced" ref and bail
   without recomputing when nothing changed.
2. Remove the dependency on `habits` from the sync path — `toggleHabit` already
   atomically increments points via its batch, so the corrective sync only needs to
   run at session start and on day/week boundaries, not on every toggle. Gate it
   with a `useRef` so it runs at most once per load + on scheduler ticks.
3. Optionally memoize `streakEndingOn` results in a `Map<habitId, Map<date, streak>>`
   invalidated when `habits` changes.

## Risks
- Points accuracy is critical — the sync is the *corrective* path, so changing when
  it runs must not let real drift go uncorrected. Keep it running on the midnight
  scheduler and on login.
- Coordinate with item 10 (auto-reset) — both touch the points-recalc path.

## Acceptance criteria
- Toggling a habit does not trigger a household-points **write** from the sync
  effect (only `toggleHabit`'s own batch writes).
- Daily/weekly/total still self-correct on login and at midnight (existing behavior).
- `pnpm lint && pnpm test` green; add a test or instrumentation proving the effect
  no longer recomputes on toggle.
