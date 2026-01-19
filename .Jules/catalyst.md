# Catalyst Journal

## 2025-02-18 - Batch Mode Pattern Standardization **Discovery:** Multiple list views (`PantryTab`, `TransactionMasterList`) implement a "Selection Mode" pattern with a Floating Action Bar (FAB) and `Promise.allSettled` for batch operations. **Opportunity:** Standardize this pattern across all list-based views. Implemented it for `ShoppingListTab` to enable "Batch Purchase" and "Batch Delete", significantly reducing clicks for power users. This pattern relies on the atomic actions exposed by `FirebaseHouseholdContext` and scales well for client-side batching.
