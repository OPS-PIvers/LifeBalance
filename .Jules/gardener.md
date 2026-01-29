# Gardener's Journal

## 2026-01-20 - Component Extraction from Large File
**Weed:** `TransactionMasterList.tsx` was growing too large (> 650 lines) and contained a fully defined nested component `TransactionItem`.
**Root Cause:** Organic growth of the component as features were added (filters, batch actions, etc.). This increases cognitive load and makes the file harder to maintain.
**Plan:** Extracted `TransactionItem` into a separate file (`components/budget/TransactionItem.tsx`) to improve readability and separation of concerns.

## 2026-02-18 - Unified Natural Language Parsing
**Weed:** Duplicated natural language parsing logic between `parseMagicAction` (single-item) and `parseNaturalLanguageCommand` (multi-item), with broken logic for 'unknown' types in `FirebaseHouseholdContext`.
**Root Cause:** Two different implementations for similar features (Modal vs Voice) led to divergence. The voice command handler failed to process commands where the type wasn't explicitly provided by the input source.
**Plan:** Refactored `parseNaturalLanguageCommand` to return a Discriminated Union and implemented "One Shot" parsing for unknown inputs, enabling robust handling of all voice commands and aligning the logic with the more efficient `parseMagicAction` pattern.

## 2025-05-18 - Refactored SafeToSpend Logic
**Weed:** `utils/safeToSpendCalculator.ts` contained duplicated logic for finding the next paycheck and commented-out "dead wood" imports. Logic for calculating unpaid bills was complex and inline.
**Root Cause:** Optimization efforts ("Bolt Optimization") introduced complexity inline, and duplicated logic likely arose from needing similar calculations in different contexts (one-shot vs optimized hook usage).
**Plan:** Extracted `findNextPaycheckFromExpanded` and `calculateUnpaidBillsInRange` helper functions. Removed dead imports. This standardizes the logic and makes the main calculation function much more readable while preserving performance optimizations.

## 2026-01-25 - CaptureModal Refactoring
**Weed:** `CaptureModal.tsx` was a "God Component" (> 1000 lines) handling multiple unrelated tabs and complex view states (Camera, Manual, Review) all in one file.
**Root Cause:** Feature accumulation (Transactions, Todos, Shopping, Magic Action) without separation of concerns.
**Plan:** Extracted `CaptureTransactionManual` into a separate component. Standardized manual entry logic and state management. Reduced complexity score of the parent modal.

## 2026-02-23 - MealPlanTab Modal Extraction
**Weed:** `MealPlanTab.tsx` was a "God Component" (> 960 lines) embedding three large modals (Add Meal, Previous Meals, AI Suggest) and their associated logic/state.
**Root Cause:** Feature creep where multiple interactions (Cookbook, AI, Shopping List) were all managed within the main calendar view component.
**Plan:** Extracted `MealFormModal`, `PreviousMealsModal`, and `AIMealModal` into separate components. Moved local form state into `MealFormModal`. This improved readability and separation of concerns, reducing the main file size significantly.
