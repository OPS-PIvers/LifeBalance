# Palette's Journal

## 2024-05-22 - Accessibility in Non-Standard Controls
**Learning:** Interactive elements implemented as `div`s with `onClick` are a common pattern here that completely excludes keyboard and screen reader users.
**Action:** When finding clickable `div`s, prefer converting to semantic `<button>` elements over adding `role="button"` and `tabIndex` to the `div`, as buttons provide native keyboard support and focus behavior for free.
