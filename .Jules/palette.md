# Palette's Journal

## 2024-05-22 - Accessibility in Non-Standard Controls
**Learning:** Interactive elements implemented as `div`s with `onClick` are a common pattern here that completely excludes keyboard and screen reader users.
**Action:** When finding clickable `div`s, prefer converting to semantic `<button>` elements over adding `role="button"` and `tabIndex` to the `div`, as buttons provide native keyboard support and focus behavior for free.

## 2024-05-25 - Standardizing Modals for Accessibility
**Learning:** Custom implementations of modals (using fixed divs with overlays) often miss critical accessibility features like `role="dialog"`, focus trapping, and Escape key handling.
**Action:** Replace custom modal implementations with the shared `<Modal>` component which handles these a11y requirements centrally, ensuring a consistent and accessible experience for all dialogs.
