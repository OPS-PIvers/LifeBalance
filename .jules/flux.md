## 2025-02-08 - Transaction Filter Overflow
**Squeeze:** The horizontal row of transaction filters (`select` inputs) overflows on mobile screens (< 768px), requiring cumbersome horizontal scrolling and tiny touch targets.
**Reflow:** Hid the desktop filter bar on mobile (`hidden md:flex`) and replaced it with a single "Filters" button (`flex md:hidden`). This button opens a bottom `Drawer` containing vertically stacked, full-width select inputs for easier manipulation. Added a badge to the button to indicate active filter count.
