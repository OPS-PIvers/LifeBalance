# Lint and Type Error Suppressions Audit

**Last Updated:** 2026-01-19

**WARNING:** This document tracks all ESLint and TypeScript error suppressions in the codebase. These suppressions are **technical debt** and should be eliminated whenever possible.

## Policy

🚨 **CRITICAL RULE:** It is **NEVER** acceptable to suppress lint or type errors if there is ANY other way to fix the actual underlying issue.

Suppressions should only exist for:
1. **Legitimate edge cases** where the linter/type checker is wrong
2. **Third-party library issues** beyond our control
3. **Temporary workarounds** with a clear plan and timeline to fix properly

## Current Suppressions

### File-Level Suppressions (`/* eslint-disable */`)

These are the **WORST** offenders - blanket disabling all linting for entire files:

#### Pages
- [x] `pages/Login.tsx` - **NEEDS FIXING**
- [x] `pages/HouseholdSetup.tsx` - **NEEDS FIXING**
- [x] `pages/MigrateSubmissions.tsx` - **NEEDS FIXING**
- [x] `pages/Habits.tsx` - **NEEDS FIXING**

#### Services
- [x] `services/authService.ts` - **NEEDS FIXING**
- [x] `services/notificationService.tsx` - **NEEDS FIXING**
- [x] `services/householdService.ts` - **NEEDS FIXING**

#### Contexts
- [x] `contexts/AuthContext.tsx` - **NEEDS FIXING**
- [x] `contexts/MockHouseholdContext.tsx` - **NEEDS FIXING**

#### Utils
- [x] `utils/exportUtils.ts` - **NEEDS FIXING**
- [x] `utils/habitLogic.ts` - **NEEDS FIXING**
- [x] `utils/firestoreSanitizer.ts` - **NEEDS FIXING**
- [x] `utils/freezeBankValidator.ts` - **NEEDS FIXING**
- [x] `utils/migrations/challengeMigration.ts` - **NEEDS FIXING**
- [x] `utils/migrations/freezeBankMigration.ts` - **NEEDS FIXING**

#### Hooks
- [x] `hooks/useGroceryOptimizer.ts` - **NEEDS FIXING**

#### Components - Meals
- [x] `components/meals/ShoppingSettingsModal.tsx` - **NEEDS FIXING**
- [x] `components/meals/MealPlanTab.tsx` - **NEEDS FIXING**
- [x] `components/meals/ShoppingListTab.tsx` - **NEEDS FIXING**

#### Components - Settings
- [x] `components/settings/NotificationSettings.tsx` - **NEEDS FIXING**

#### Components - Dashboard
- [x] `components/dashboard/ActionQueueItem.tsx` - `/* eslint-disable react/prop-types */` - **NEEDS FIXING**

#### Components - Modals
- [x] `components/modals/BucketFormModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/ChallengeHubModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/PointsBreakdownModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/RewardsModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/HabitFormModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/SafeToSpendModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/AnalyticsModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/HabitSubmissionLogModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/CaptureModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/HabitCreatorWizard.tsx` - **NEEDS FIXING**
- [x] `components/modals/GroceryCatalogModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/InsightsArchiveModal.tsx` - **NEEDS FIXING**
- [x] `components/modals/YearlyGoalFormModal.tsx` - **NEEDS FIXING**

### Test File Suppressions

Test files with blanket `@typescript-eslint/no-explicit-any` suppression:

- [x] `pages/ToDosPage.test.tsx` - **ACCEPTABLE** (test file, but should still be reviewed)
- [x] `pages/HabitsExport.test.tsx` - **ACCEPTABLE** (test file, but should still be reviewed)
- [x] `utils/calendarRecurrence.test.ts` - **NEEDS FIXING**
- [x] `utils/habitLogic.test.ts` - **NEEDS FIXING**
- [x] `utils/inviteCodeGenerator.test.ts` - **ACCEPTABLE** (test file)
- [x] `components/budget/BudgetBuckets.test.tsx` - **ACCEPTABLE** (test file)
- [x] `components/modals/AnalyticsModal.test.tsx` - **ACCEPTABLE** (test file, but has multiple inline suppressions)

### Inline Suppressions

#### Legitimate (Acceptable)

These suppressions are likely justified:

**`react-refresh/only-export-components`**
- `contexts/FirebaseHouseholdContext.tsx:212` - Context export pattern
- `contexts/FirebaseHouseholdContext.tsx:2914` - Hook export pattern

These are **ACCEPTABLE** because context files legitimately export non-component items (context, provider, hook). This is a standard React pattern that triggers false positives.

#### Questionable (Needs Review)

**`@typescript-eslint/no-unused-vars`**
- `pages/Settings.tsx:241` - **NEEDS REVIEW** - Why is a variable unused?
- `utils/challengeCalculator.ts:182` - **NEEDS REVIEW** - Why is a variable unused?
- `contexts/FirebaseHouseholdContext.tsx:1825` - **NEEDS REVIEW** - Why is a variable unused?

**`@typescript-eslint/no-explicit-any`**
- `App.tsx:84` - **NEEDS FIXING** - Type the data properly
- `contexts/MockAuthContext.tsx:45` - **NEEDS REVIEW** - Can this be typed?
- `contexts/FirebaseHouseholdContext.tsx:386` - **NEEDS FIXING** - Type Firestore data
- `contexts/FirebaseHouseholdContext.tsx:1673` - **NEEDS FIXING** - Type Firestore data
- `contexts/FirebaseHouseholdContext.tsx:1695` - **NEEDS FIXING** - Type Firestore data
- `contexts/FirebaseHouseholdContext.tsx:1774` - **NEEDS FIXING** - Type Firestore data
- `components/analytics/CustomTooltip.tsx:8` - **NEEDS REVIEW** - Can Recharts tooltip be typed?
- `components/analytics/CustomTooltip.tsx:16` - **NEEDS REVIEW** - Can Recharts tooltip be typed?

**`react-hooks/exhaustive-deps`**
- `components/modals/SmartHabitAdjustModal.tsx:44` - **NEEDS FIXING** - Fix dependencies properly (like we just did!)

**`react-hooks/preserve-manual-memoization`**
- `components/budget/BudgetCalendar.tsx:39` - **NEEDS REVIEW** - Is this manual memoization actually necessary?

## Summary Statistics

- **Total files with blanket suppressions:** 38
- **Total inline suppressions:** 20+
- **Legitimate suppressions:** 2 (react-refresh exports)
- **Technical debt suppressions:** 56+

## Action Items

1. **Prioritize fixing blanket `/* eslint-disable */` statements** - These hide ALL errors and are dangerous
2. **Review all `@typescript-eslint/no-unused-vars`** - These often indicate dead code
3. **Type all `any` usages** - TypeScript is useless without proper types
4. **Fix hook dependency arrays** - These can cause subtle bugs and stale closures
5. **Enable linting in CI/CD** - Currently these suppressions allow broken code to merge

## How to Fix Suppressions

### For Files with `/* eslint-disable */`:

1. Remove the blanket suppression
2. Run `npm run lint` to see actual errors
3. Fix each error individually
4. If a specific line truly needs suppression, use `eslint-disable-next-line` with a comment explaining WHY
5. Never re-add blanket suppressions

### For `@typescript-eslint/no-explicit-any`:

1. Define proper TypeScript interfaces/types
2. Use generics where appropriate
3. Import types from libraries when available
4. Use `unknown` instead of `any` when type is truly unknown, then narrow with type guards

### For `react-hooks/exhaustive-deps`:

1. Add the missing dependencies
2. If the hook intentionally should not re-run, restructure the code (e.g., use refs, move logic outside component)
3. Never suppress without understanding the implications

### For `@typescript-eslint/no-unused-vars`:

1. Remove the unused variable
2. If it's required by a function signature but not used, prefix with `_` (e.g., `_unusedParam`)
3. ESLint should allow `_` prefixed vars by default

## Historical Context

From `.jules/gardener.md`:
> **Weed:** "Rot Pattern" - Blanket `/* eslint-disable */` in `contexts/FirebaseHouseholdContext.tsx`.
> **Plan:** Removed the blanket disable. Fixed unused variables (`progress`, `id`). Added `householdSettings` and `buckets` to `useEffect` dependency arrays to prevent stale closures. Used granular `eslint-disable-next-line` for legacy migration functions involving `any`.

This shows that blanket suppressions have been identified as "Rot Pattern" and actively removed before. We should continue this work.
