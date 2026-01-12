## Technical Debt Journal

### 2024-05-24 - Dead Code in Migration Utilities
**Weed:** Deprecated function `migrateTransactionsToPeriods` and unused logic in `payPeriodMigration.ts`.
**Root Cause:** Legacy migration logic from a previous pay period tracking system that was never fully removed.
**Plan:** Remove `migrateTransactionsToPeriods` and update `needsMigration` to check only buckets, simplifying the migration check in `FirebaseHouseholdContext`.

### 2024-05-24 - Magic Numbers in Calendar Recurrence
**Weed:** Magic numbers (e.g., `1000` for max iterations, `1` for Monday) in `utils/calendarRecurrence.ts`.
**Root Cause:** Hardcoded values in logic without semantic names.
**Plan:** Extract to named constants.
