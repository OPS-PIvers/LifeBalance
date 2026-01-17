# Bolt's Journal

## 2024-05-22 - Initial Entry
**Learning:** Initializing the journal.
**Action:** Will log critical learnings here.

## 2026-01-16 - Memoizing Lists with Active State
**Learning:** When rendering a list where only one item can be active (expanded) at a time, passing the `activeId` to every child causes the entire list to re-render when the selection changes.
**Action:** Calculate the boolean `isActive` state in the parent's map loop (e.g., `isExpanded={expandedId === item.id}`) and pass that boolean to the memoized child. This ensures that only the two affected items (previous active and new active) re-render, while the rest of the list remains referentially stable.
