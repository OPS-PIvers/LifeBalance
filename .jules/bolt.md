## 2024-05-22 - [Context Double-Render Elimination]
**Learning:** `FirebaseHouseholdContext` was using `useState` + `useEffect` to derive state from other state (e.g., `bucketSpentMap` depending on `transactions`). This caused a cascade of re-renders: 1st render (transactions update) -> Effect runs -> State update -> 2nd render (bucketSpentMap update).
**Action:** Replace `useState` + `useEffect` chains for derived state with direct derivation or `useMemo`. This cuts render cycles in half for critical data updates.
