# Bolt's Journal

## 2024-05-22 - [Context Double-Render Elimination]
**Learning:** `FirebaseHouseholdContext` was using `useState` + `useEffect` to derive state from other state (e.g., `bucketSpentMap` depending on `transactions`). This caused a cascade of re-renders: 1st render (transactions update) -> Effect runs -> State update -> 2nd render (bucketSpentMap update).
**Action:** Replace `useState` + `useEffect` chains for derived state with direct derivation or `useMemo`. This cuts render cycles in half for critical data updates.

## 2026-01-15 - [Firestore Snapshot Reference Instability]
**Learning:** Firestore `onSnapshot` listeners create new object references for all documents in the array on every update, even for unchanged documents. This defeats `React.memo` unless a custom comparator is used to check primitive fields.
**Action:** Always implement a custom `arePropsEqual` function when memoizing components that receive Firestore data objects as props.

## 2026-01-16 - Memoizing Lists with Active State
**Learning:** When rendering a list where only one item can be active (expanded) at a time, passing the `activeId` to every child causes the entire list to re-render when the selection changes.
**Action:** Calculate the boolean `isActive` state in the parent's map loop (e.g., `isExpanded={expandedId === item.id}`) and pass that boolean to the memoized child. This ensures that only the two affected items (previous active and new active) re-render, while the rest of the list remains referentially stable.
