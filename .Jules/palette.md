## 2024-05-22 - Accessibility Fundamentals
**Learning:** Many interactive elements were missing visible focus states, making keyboard navigation difficult. Standard UI components (like Button) should enforce these styles globally.
**Action:** Audit all interactive components for `focus-visible` styles and enforce usage of the standard `Button` component over raw HTML buttons.

## 2024-06-03 - Modal Accessibility Patterns
**Learning:** Ad-hoc modal implementations frequently miss `aria-label` on icon-only close buttons, rendering them invisible to screen readers. Relying on the `X` icon visual is insufficient.
**Action:** Standardize a `ModalHeader` component or strictly enforce `aria-label="Close modal"` reviews for any icon-only button implementation.

## 2026-01-23 - Standardizing Form Error Accessibility
**Learning:** Visual error messages adjacent to inputs are insufficient for screen reader users without explicit programmatic association.
**Action:** Enforce `aria-describedby` linking input to error message ID and `aria-invalid="true"` on all form inputs in the design system.

## 2024-06-04 - Segmented Control Accessibility
**Learning:** Ad-hoc toggle buttons (Expense/Income) were inaccessible and lacked keyboard support. Using `aria-pressed` in a `group` context is a simple, effective pattern for mutually exclusive options when full radio semantics are too heavy.
**Action:** Use the new `SegmentedControl` component for any future toggle/choice groups to ensure consistent accessibility and focus management.

## 2025-05-15 - Inline Edit Accessibility
**Learning:** Clickable text elements (like "Edit Limit") are often implemented as spans for styling, but this excludes keyboard users. Adding `role="button"` is not enough; explicit key handlers and focus management are mandatory.
**Action:** When creating inline-editable text, always pair `onClick` with `onKeyDown` (Enter/Space) and ensure the element is focusable via `tabIndex={0}`.

## 2024-08-09 - Collapsible Component Accessibility
**Learning:** Collapsible header buttons created without standard `<Button>` components often lack standard keyboard focus indicators, making them difficult to use for keyboard navigators.
**Action:** Enforce standard `focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500` styles on interactive custom triggers to match the rest of the application's interactive elements.
