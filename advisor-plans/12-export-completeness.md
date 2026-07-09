# Plan 12: Complete the "Download my data" export — todos, meal plan, challenges, rewards, stores

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on.
> On any STOP condition, stop and report. When done, update this plan's
> status row in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- pages/Settings.tsx utils/exportUtils.ts`
> On mismatch with the "Current state" excerpt, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (additive JSON payload; no writes)
- **Depends on**: none
- **Category**: correctness / direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The Settings "Download my data" JSON backup exists to satisfy data portability (GDPR Art. 20) and user trust, but it silently omits several first-class collections: **todos** (an entire page/module), the **weekly meal plan**, **challenges**, **reward items**, and **stores**. A household that exports its data loses its task history and gamification setup without any indication. The 2026-06 planning index (`plans/README.md`) already flagged this as a known "~5-line follow-up" that was never done.

## Current state

- `pages/Settings.tsx:321-352` — `doExportJson(txList)` builds the payload:

```ts
      const exportData = {
        meta: {
          exportedAt: new Date().toISOString(),
          householdId,
          exportedBy: user?.uid
        },
        household: householdSettings,
        members: safeMembers,
        habits,
        transactions: txList,
        buckets,
        calendarItems,
        meals,
        shoppingList
      };

      generateJsonBackup(exportData);
```

  `safeMembers` (lines 324–328) strips `fcmTokens`, `email`, `telegramChatId` from each member — preserve this pattern.
- Settings already imports the slice hooks (`pages/Settings.tsx:1-9`): `useHouseholdCore`, `useGamification`, `useFinance`, `useMealPlan`, `useShopping` — but NOT `useTodos`. The missing data lives on these slices:
  - `useTodos()` → `todos`
  - `useMealPlan()` → the weekly meal plan array (check the exact field name in `contexts/household/types.ts` — likely `mealPlan`)
  - `useGamification()` → `challenges`, `rewards` (check exact names in `contexts/household/types.ts:330-380`)
  - `useShopping()` → `stores`
- `utils/exportUtils.ts` — `generateJsonBackup(data)` serializes and downloads; it takes an arbitrary object, so no change needed there *unless* you extract a pure payload builder (Step 1 does exactly that, to make this testable).
- Notes: member **points** are fields on the member docs, so they already export via `members`; `redemptionHistory` is a field on the household doc, already exported via `household`. Do not duplicate them.
- Conventions: `@/` alias for cross-directory imports; strict TS (`noUncheckedIndexedAccess`); tests colocated as `*.test.ts`.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Tests | `pnpm test` | all pass |
| Focused | `pnpm test -- exportUtils` | new tests pass |

## Scope

**In scope**:
- `pages/Settings.tsx` (import `useTodos`; pass new slices into the payload builder)
- `utils/exportUtils.ts` (add a pure `buildExportPayload(...)`)
- `utils/exportUtils.test.ts` (create or extend)
- `advisor-plans/README.md` (status row)

**Out of scope**:
- The CSV export (`doExportCsv`) — transactions-only by design; leave it.
- `contexts/**` — read-only consumers here; if a slice doesn't expose a needed array, that's a STOP, not a context change.
- Import/restore functionality — explicitly deferred (see Maintenance notes).

## Git workflow

- Branch: `advisor/12-export-completeness`
- Conventional commit, e.g. `feat(settings): include todos, meal plan, challenges, rewards, stores in data export`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a pure payload builder

In `utils/exportUtils.ts`, add an exported `buildExportPayload(input: { meta fields + all collections })` that returns the export object, including the member-sanitization (move the `safeMembers` destructuring in from Settings so it's tested). Extend the payload with `todos`, `mealPlan`, `challenges`, `rewards`, `stores`.

**Verify**: `pnpm lint` → exit 0.

### Step 2: Switch Settings to the builder

In `pages/Settings.tsx`, add `useTodos` to the existing context import, pull the five arrays from their slices, and replace the inline object in `doExportJson` with a `buildExportPayload(...)` call. Behavior otherwise unchanged (same toast, same `generateJsonBackup`).

**Verify**: `pnpm lint && pnpm test` → exit 0 (existing Settings tests green).

### Step 3: Tests

In `utils/exportUtils.test.ts`, following any existing test in `utils/` as the pattern (e.g. `utils/moduleVisibility.test.ts` for structure): assert the payload contains all 13 top-level keys (`meta, household, members, habits, transactions, buckets, calendarItems, meals, shoppingList, todos, mealPlan, challenges, rewards, stores` — note: 14 with meta); assert `fcmTokens`/`email`/`telegramChatId` are stripped from members; assert empty arrays pass through as `[]` (not `undefined`).

**Verify**: `pnpm test -- exportUtils` → all new tests pass; `pnpm test` → full suite green.

## Done criteria

- [ ] `pnpm lint` and `pnpm test` exit 0
- [ ] `grep -n "todos" pages/Settings.tsx` shows todos flowing into the export
- [ ] `buildExportPayload` exists in `utils/exportUtils.ts` with tests
- [ ] No files outside scope modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- A needed array is not exposed by the expected slice hook (report which; do not modify contexts).
- `MockHouseholdContext` parity: if Settings tests run against the mock provider and a new slice field is missing there, report rather than patching the mock beyond adding the same public field it already mirrors elsewhere. (Adding a missing mirror field to `contexts/MockHouseholdContext.tsx` IS allowed — CLAUDE.md requires mock parity — but only the field, no behavior.)

## Maintenance notes

- Any future top-level collection (new module) must be added to `buildExportPayload` — the key-count test will catch forgetting it only if the author updates the test; consider that the reviewer's checklist item.
- Import/restore (the symmetric operation) remains unbuilt — a future direction item, deliberately not in scope here.
