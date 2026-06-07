# Lint and Type Error Suppressions Audit

**Last Updated:** 2026-06-07

**WARNING:** This document tracks all ESLint and TypeScript error suppressions in the codebase. These suppressions are **technical debt** and should be eliminated whenever possible.

## Policy

🚨 **CRITICAL RULE:** It is **NEVER** acceptable to suppress lint or type errors if there is ANY other way to fix the actual underlying issue.

Suppressions should only exist for:
1. **Legitimate edge cases** where the linter/type checker is wrong
2. **Third-party library issues** beyond our control
3. **Temporary workarounds** with a clear plan and timeline to fix properly

## Current Suppressions

### Status: No blanket suppressions; a few granular ones remain

`pnpm lint` is green (0 errors, 0 warnings). There are **zero** blanket `/* eslint-disable */`
files and **zero** `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`. A 2026-06-07 pass removed the
six blanket-disabled files that a prior version of this doc had incorrectly marked resolved
(`components/modals/CaptureModal.tsx`, `components/modals/AnalyticsModal.tsx`,
`components/settings/NotificationSettings.tsx`, `utils/migrations/freezeBankMigration.ts`,
`utils/freezeBankValidator.ts`, `pages/MigrateSubmissions.tsx`) and fixed the `as any` casts they
were hiding (`AnalyticsModal`, `CaptureModal`) plus two `react-hooks/exhaustive-deps` suppressions
(`SmartHabitAdjustModal`, `SmartHabitReorderModal`, fixed via a `habitsRef` snapshot).

#### Remaining granular `eslint-disable-next-line` (pre-existing tech debt — fix when touched)

Legitimate (per policy — keep):
- `react-refresh/only-export-components` on context/hook exports: `contexts/AuthContext.tsx`,
  `contexts/ThemeContext.tsx`, `contexts/FirebaseHouseholdContext.tsx` — standard React pattern.

Candidates to eliminate when next editing these files:
- `@typescript-eslint/no-explicit-any`: `components/analytics/CustomTooltip.tsx` (×2, recharts
  payload typing), `hooks/useGroceryOptimizer.ts` (×2, dynamic AI response), `utils/firestoreSanitizer.ts`,
  `contexts/MockAuthContext.tsx` — type the third-party/dynamic shapes with `unknown` + guards.
- `react-hooks/set-state-in-effect`: `components/modals/BucketFormModal.tsx`,
  `components/meals/ShoppingListTab.tsx`, `components/budget/BudgetBucketCard.tsx` — restructure to
  derive state instead of setting it in an effect.
- `@typescript-eslint/no-unused-vars`: `pages/Settings.tsx` (intentional destructure-omit).

These were out of scope for the optimization pass (granular, pre-existing, and in third-party/
dynamic-data boundaries); they are tracked here so they're addressed as those files are touched.

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
