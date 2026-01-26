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

## 2026-01-28 - [Context Action Circular Dependencies]
**Learning:** When memoizing context actions with `useCallback`, functions calling other internal functions (e.g., `payCalendarItem` calling `handlePaycheckApproval`) creates a dependency chain. If the callee is defined *after* the caller, strict linting (no-use-before-define) or runtime TDZ (Temporal Dead Zone) issues occur if included in the dependency array.
**Action:** Reorder function definitions in large context files so that dependencies are defined *before* they are used in `useCallback` dependency arrays. For `FirebaseHouseholdContext`, this meant moving Pay Period actions to the top.

## 2026-02-14 - [Input State Isolation in Lists]
**Learning:** When an editable field exists within a list item, lifting that state to the parent (to coordinate 'only one editing at a time') causes the entire list to re-render on every keystroke.
**Action:** Lift the 'isEditing' boolean to the parent to enforce singleton editing, but keep the 'currentValue' state local to the child component. Use a derived state pattern (syncing state when prop changes) or `key` resetting to initialize the local state when editing begins. This ensures only the active item re-renders while typing.

## 2026-02-19 - [Conditional Prop Dependency in Memoization]
**Learning:** Components receiving frequent global updates (e.g., `transactions` list from Firestore) will re-render constantly even if `React.memo` is used, because the global array reference changes. If the component only displays this data in a specific state (e.g., `isExpanded`), validating it in `arePropsEqual` unconditionally defeats the optimization.
**Action:** In `arePropsEqual`, strictly ignore changes to expensive data props if the component's state (e.g., `!isExpanded`) makes them invisible. Only check them when the data is actually being rendered. This prevents background updates from thrashing the UI for collapsed list items.

## 2026-02-23 - [Date Object Reference Instability]
**Learning:** Helper functions like `startOfWeek(new Date())` return new Date object instances on every render. If these are passed as dependencies to `useMemo` (e.g., for expensive list filtering), they break memoization and force re-calculation on every render.
**Action:** Memoize date range boundaries (start/end dates) using `useMemo` dependent on the stable anchor date (e.g., `currentMonth`), or pass primitive timestamps to dependency arrays.
