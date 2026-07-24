# Lint and Type Error Suppressions Audit

**Last Updated:** 2026-07-04

**WARNING:** This document tracks all ESLint and TypeScript error suppressions in the codebase. These suppressions are **technical debt** and should be eliminated whenever possible.

## Policy

🚨 **CRITICAL RULE:** It is **NEVER** acceptable to suppress lint or type errors if there is ANY other way to fix the actual underlying issue.

Suppressions should only exist for:
1. **Legitimate edge cases** where the linter/type checker is wrong
2. **Third-party library issues** beyond our control
3. **Temporary workarounds** with a clear plan and timeline to fix properly

## Current Suppressions

### Status: No blanket suppressions; 22 granular ones remain (re-audited 2026-07-10, Plan 23)

`pnpm lint` is green (0 errors, 0 warnings — the one `react-hooks/incompatible-library` warning that
`eslint-plugin-react-hooks@7` reports on `useVirtualizer` is turned off by config; see **Accepted
Configurations** §4). There are **zero** blanket `/* eslint-disable */` files and **zero**
`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`.

Refresh this audit with:
```bash
grep -rn "eslint-disable" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

#### Current granular `eslint-disable-next-line` inventory (22 total)

**`react-refresh/only-export-components` — 12× (legitimate pattern per policy — keep):**
context/hook exports in `contexts/AuthContext.tsx` (×2), `contexts/ThemeContext.tsx` (×1), and
`contexts/FirebaseHouseholdContext.tsx` (×9, one per exported slice hook).

**`react-hooks/set-state-in-effect` — 6× (each carries a justification comment — review when touched):**
- `components/modals/HabitSubmissionLogModal.tsx:65` — intentional load-on-open
- `components/modals/BucketFormModal.tsx:37` — form state reset on open
- `components/modals/DeveloperConsole.tsx:141` — intentional load-on-open
- `contexts/FirebaseHouseholdContext.tsx:893` — intentional cross-household state teardown
- `contexts/FirebaseHouseholdContext.tsx:1512` — intentional listener-window re-baseline
- `components/transactions/TransactionCommentThread.tsx:64` (Plan 23) — intentional load-on-open, mirrors HabitSubmissionLogModal

**`@typescript-eslint/no-explicit-any` — 4× (test-only — eliminate when next editing the file):**
all in `pages/Habits.Export.test.tsx` (lines 132, 150, 173, 175).

### Historical Fixes

#### Pages
- [x] `pages/Login.tsx` - **FIXED** (Removed blanket suppression, fixed types)
- [x] `pages/HouseholdSetup.tsx` - **FIXED** (Removed blanket suppression, fixed types)
- [x] `pages/MigrateSubmissions.tsx` - **FIXED** (Removed blanket suppression)
- [x] `pages/Habits.tsx` - **FIXED** (Removed blanket suppression)

#### Services
- [x] `services/authService.ts` - **FIXED** (Removed blanket suppression, improved error handling types)
- [x] `services/notificationService.tsx` - **FIXED** (Removed blanket suppression, fixed navigator/window types)
- [x] `services/householdService.ts` - **FIXED** (Removed blanket suppression, improved error handling types)

#### Contexts
- [x] `contexts/AuthContext.tsx` - **FIXED** (Removed blanket suppression)
- [x] `contexts/MockHouseholdContext.tsx` - **FIXED** (Removed blanket suppression, fixed unused vars)
- [x] `contexts/FirebaseHouseholdContext.tsx` - **FIXED** (Fixed hook dependencies, removed any types)

#### Utils
- [x] `utils/exportUtils.ts` - **FIXED**
- [x] `utils/habitLogic.ts` - **FIXED**
- [x] `utils/firestoreSanitizer.ts` - **FIXED**
- [x] `utils/freezeBankValidator.ts` - **FIXED**
- [x] `utils/migrations/challengeMigration.ts` - **FIXED**
- [x] `utils/migrations/freezeBankMigration.ts` - **FIXED**

#### Components
- [x] `components/meals/ShoppingSettingsModal.tsx` - **FIXED** (Fixed state updates in effect)
- [x] `components/meals/MealPlanTab.tsx` - **FIXED**
- [x] `components/meals/ShoppingListTab.tsx` - **FIXED**
- [x] `components/settings/NotificationSettings.tsx` - **FIXED**
- [x] `components/dashboard/ActionQueueItem.tsx` - **FIXED** (Disabled prop-types for TS)
- [x] `components/modals/*` - **FIXED** (All modals cleaned)

### Accepted Configurations

The following rules have been globally adjusted in `eslint.config.js` to align with the project's TypeScript usage:

1.  **`react/prop-types`**: Disabled (`off`). We rely on TypeScript interfaces for prop validation.
2.  **`@typescript-eslint/no-unused-vars`**: Configured to ignore variables starting with `_` (e.g., `_prev`, `_error`).
3.  **`react-refresh/only-export-components`**: Suppressed inline for Context files where exporting non-components (like context objects) is necessary.
4.  **`react-hooks/incompatible-library`**: Disabled (`off`) for `components/budget/TransactionMasterList.tsx`
    only — the single `@tanstack/react-virtual` `useVirtualizer` consumer. Third-party library issue
    (policy §2): the hook returns an internally-mutable object that `eslint-plugin-react-hooks@7`'s
    recommended set flags as "Compilation Skipped: Use of incompatible library".
    Upstream: [TanStack/virtual#1119](https://github.com/TanStack/virtual/issues/1119) (open).
    It is a **warning**, not an error, and `eslint .` runs without `--max-warnings`, so this removes
    permanent noise rather than unblocking CI. The rule ships in the v7 recommended preset regardless of
    React Compiler, which this project does **not** run (no `babel-plugin-react-compiler`), so the
    skipped-memoization consequence does not apply here.
    **Remove when:** TanStack/virtual#1119 is resolved upstream. **Revisit if:** React Compiler is
    adopted — the warning becomes real then and needs a `'use no memo'` fix, not a disable.
