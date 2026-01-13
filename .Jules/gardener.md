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
