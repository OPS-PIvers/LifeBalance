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

### Status: CLEAN 🎉

All blanket `/* eslint-disable */` suppressions and `any` types identified in the previous audit have been resolved. The codebase is currently lint-free.

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
