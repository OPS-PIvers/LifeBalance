# Plan 08 — FirebaseHouseholdContext File Decomposition

**Impact:** MED (the 4,861-line file is the #1 merge-conflict and review-blind-spot zone;
every feature touches it) · **Effort:** L (3–5 days, mechanical but wide)
· **Risk:** MED (no behavior change intended, but it's the money file — sequence after
Plan 07 exists) · **Confidence:** MED (the split is safe; the payoff is DX, not users)

## Context an executor needs

`contexts/FirebaseHouseholdContext.tsx` is **4,861 lines** and still growing (~1,000 lines
added since mid-June). Important: the **runtime architecture is already right** — state is
exposed through domain-sliced contexts (`useFinance`, `useGamification`, `useMealPlan`,
`useShopping`, `useTodos`, `useHouseholdCore`; see CLAUDE.md State Management) and only
`pages/MigrateSubmissions.tsx` still uses the legacy `useHousehold()` shim. This plan does
**not** change providers, context values, listener behavior, or render behavior. It is a
*file* decomposition: one provider component whose implementation is spread across
focused, testable modules.

Do NOT confuse this with re-architecting state (that shipped in PR #615/#632). If a step
here would change a dependency array, a memo boundary, or a context value identity — stop;
that's out of scope.

## Target layout

```
contexts/household/
  index.tsx                  // FirebaseHouseholdProvider — composes the pieces; exports unchanged
  listeners/                 // one module per collection listener group
    financeListeners.ts      // accounts, buckets, transactions(windowed), calendarItems, payPeriods
    gamificationListeners.ts // habits, points, challenges, rewards, freezeBank
    mealListeners.ts / shoppingListeners.ts / todoListeners.ts / coreListeners.ts
  mutations/                 // the writeBatch mutation families, as plain functions
    financeMutations.ts      // addTransaction, updateTransactionCategory, payCalendarItem, ...
    habitMutations.ts        // (much already lives in hooks/useHabitActions.tsx — leave that)
    kidMutations.ts          // buildKidMemberDoc (:3883-3915), addKidProfile, ...
    mealMutations.ts / ...
  selectors.ts               // safeToSpendBreakdown memo input prep, derived values
  types.ts                   // the slice value interfaces (currently inline)
contexts/FirebaseHouseholdContext.tsx   // thin re-export shim so ALL existing imports keep working
```

Mutations become **pure-ish factories**: `makeFinanceMutations(deps)` where `deps` is
`{ db, householdId, getState refs, ... }` — the provider wires them into `useCallback`s
exactly as today. This is what makes them unit-testable with a mocked Firestore (the
existing batch-atomicity tests show the mocking style — find them via
`grep -rln "writeBatch" --include="*.test.*"`).

## Method (the only safe way to do this)

- **Move, don't edit.** Each PR moves one family verbatim; the diff should be
  reviewable as pure motion (`git diff --color-moved=dimmed-zebra`). Resist every
  improve-while-moving temptation; file follow-ups instead.
- One PR per family, CI-gated, in this order (blast-radius ascending):
  1. types + selectors (pure code, no hooks)
  2. todo + meal/shopping listeners & mutations
  3. gamification
  4. core/members/kid
  5. finance (last — it's the money)
- After each PR: `pnpm lint && pnpm test && pnpm run build` + the Plan 07 E2E suite +
  a Test-Mode manual smoke (`/#/login?test=true`).
- `contexts/MockHouseholdContext.tsx` (1,052 lines) gets the same treatment ONLY if free;
  otherwise leave it — parity of the public surface is what matters, not file shape.
- The ESLint `no-restricted-imports` rule bans `../` imports — all new cross-module
  imports use `@/contexts/household/...`.

## Why now (and why after Plans 03/07)

Plans 02/03/04 all add code to this file. Do the decomposition **after** Plan 03's PR-1
(which touches the same mutation families) to avoid a rebase war, and only once Plan 07's
E2E suite exists to catch behavioral drift the unit tests can't see. If schedule pressure
forces a choice, drop this plan before any other — it's the one with no user-visible
payoff.

## Verification & done criteria

- Zero changes to any `*.test.ts(x)` assertions (test *imports* may re-point).
- Bundle check: `pnpm run build` chunk sizes within noise of baseline (record before/after
  in the PR body) — the vite config's chunk groups match on module paths
  (see vite.config.ts comment); confirm `contexts/household/**` doesn't accidentally
  shift chunks.
- `wc -l contexts/household/*.tsx contexts/household/**/*.ts` — no file over ~800 lines.
- The re-export shim keeps every existing `@/contexts/FirebaseHouseholdContext` import
  compiling; follow-up (optional) migrates imports and deletes the shim.

## Out of scope

Any state-management change, listener bounding (plans/040), new features, Mock context
rewrite, hook extraction beyond what already exists.
