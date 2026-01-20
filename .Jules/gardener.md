# Gardener's Journal

## 2026-01-20 - Component Extraction from Large File
**Weed:** `TransactionMasterList.tsx` was growing too large (> 650 lines) and contained a fully defined nested component `TransactionItem`.
**Root Cause:** Organic growth of the component as features were added (filters, batch actions, etc.). This increases cognitive load and makes the file harder to maintain.
**Plan:** Extracted `TransactionItem` into a separate file (`components/budget/TransactionItem.tsx`) to improve readability and separation of concerns.
