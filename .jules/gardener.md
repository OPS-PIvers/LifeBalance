## Technical Debt Journal

### 2026-01-12 - Dead Code in Migration Utilities
**Weed:** Deprecated function `migrateTransactionsToPeriods` and unused logic in `payPeriodMigration.ts`.
**Root Cause:** Legacy migration logic from a previous pay period tracking system that was never fully removed.
**Plan:** Remove `migrateTransactionsToPeriods` and update `needsMigration` to check only buckets, simplifying the migration check in `FirebaseHouseholdContext`.

### 2026-01-12 - Magic Numbers in Calendar Recurrence
**Weed:** Magic numbers (e.g., `1000` for max iterations, `1` for Monday) in `utils/calendarRecurrence.ts`.
**Root Cause:** Hardcoded values in logic without semantic names.
**Plan:** Extract to named constants.

### 2026-02-14 - Refactored Calendar Recurrence Logic
**Weed:** Entangled logic and magic numbers in `utils/calendarRecurrence.ts`.
**Root Cause:** "Optimization" logic (jump-to-start) was mixed with generation logic, making the function hard to read and test. Magic numbers like `1` (Monday) and `1000` (max iterations) were hardcoded.
**Plan:** Extracted `calculateStartDate` and `getNextOccurrence` helper functions. Defined `MONDAY` and `MAX_ITERATIONS` constants. Added comprehensive unit tests in `utils/calendarRecurrence.test.ts`.

### 2026-02-14 - InsightWidget Complexity Trap
**Weed:** "Complexity Trap" in `components/dashboard/InsightWidget.tsx`.
**Root Cause:** The component was handling complex action execution logic (bucket updates, habit creation, etc.) alongside UI rendering.
**Plan:** Extracted `handleAction` logic into a custom hook `hooks/useInsightActions.ts` and added unit tests.

### 2026-02-26 - FirebaseHouseholdContext Linting Bypass
**Weed:** "Rot Pattern" - Blanket `/* eslint-disable */` in `contexts/FirebaseHouseholdContext.tsx`.
**Root Cause:** Rapid development and legacy migration logic (using `any`) led to disabling all lint checks to suppress errors, hiding potential bugs and unused variables.
**Plan:** Removed the blanket disable. Fixed unused variables (`progress`, `id`). Added `householdSettings` and `buckets` to `useEffect` dependency arrays to prevent stale closures. Used granular `eslint-disable-next-line` for legacy migration functions involving `any`.

### 2026-02-27 - Magic Strings in Calendar Recurrence IDs
**Weed:** "Magic Strings" - Recurring calendar items relied on fragile string splitting with `'-202'` and manual checks in `FirebaseHouseholdContext.tsx` and `BudgetCalendar.tsx`.
**Root Cause:** Logic for synthetic ID generation was leaked into consumers instead of being encapsulated.
**Plan:** Encapsulated ID generation and parsing into `generateRecurringId`, `isRecurringId`, and `parseRecurringId` in `utils/calendarRecurrence.ts`. Updated consumers to use these helpers.
