## 2025-02-08 - Transaction Filter Overflow
**Squeeze:** The horizontal row of transaction filters (`select` inputs) overflows on mobile screens (< 768px), requiring cumbersome horizontal scrolling and tiny touch targets.
**Reflow:** Hid the desktop filter bar on mobile (`hidden md:flex`) and replaced it with a single "Filters" button (`flex md:hidden`). This button opens a bottom `Drawer` containing vertically stacked, full-width select inputs for easier manipulation. Added a badge to the button to indicate active filter count.

## 2025-02-17 - Budget Tab Overflow
**Squeeze:** The horizontal list of tabs in the Budget view (Calendar, Buckets, Accounts, Transactions, History) overflows on mobile screens (< 768px), relying on horizontal scrolling with hidden scrollbars, which makes navigation difficult and undiscoverable.
**Reflow:** Implemented a responsive navigation pattern. On mobile (`md:hidden`), a native-like `Select` dropdown is used to switch views, preventing horizontal scrolling. On desktop (`hidden md:flex`), the standard `TabsList` is preserved. Both inputs are synchronized via controlled state.
