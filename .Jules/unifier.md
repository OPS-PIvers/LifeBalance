## 2024-05-23 - Standardizing Micro Typography
**Drift:** The codebase contains 60+ instances of the hardcoded class `text-[10px]`, creating "Snowflakes" and making global typography adjustments impossible.
**Fix:** Added `xxs: '10px'` to the Tailwind configuration and replaced all hardcoded instances with the semantic token `text-xxs`.

## 2024-05-24 - Standardizing Z-Index
**Drift:** The codebase contained scattered z-index values (`z-[60]`, `z-[70]`, `z-50`) creating a fragile stacking context and making it difficult to manage layer priority.
**Fix:** Added semantic z-index scale to Tailwind config (`z-sticky: 40`, `z-dropdown: 50`, `z-modal: 60`, `z-popover: 70`) and refactored all hardcoded instances to use these tokens.

## 2026-01-24 - Standardizing Dashed Buttons and Inputs
**Drift:** "Add New Item" buttons were using hardcoded `border-dashed` classes across multiple files, and modal inputs/selects were using raw HTML elements instead of shared components.
**Fix:** Added `dashed` variant to `Button` component and refactored `BudgetBuckets` and `BudgetAccounts` to use standard `Button`, `Input`, and `Select` components.

## 2026-01-25 - Standardizing Icon Buttons
**Drift:** Icon-only action buttons (Edit, Delete, Navigation) were implemented as raw `<button>` tags with scattered styles (`p-1`, `p-2`, `rounded-lg`) and inconsistent hover effects across Budget components.
**Fix:** Added `icon-sm` size and `ghost-destructive` variant to `<Button />` and refactored `TransactionItem`, `BudgetBucketCard`, and `BudgetCalendar` to use the standardized component.

## 2025-02-28 - Standardizing Toggle Switches
**Drift:** `NotificationSettings` contained 5 instances of a complex, hardcoded toggle switch pattern with repeated Tailwind classes, creating maintenance overhead and inconsistency risks.
**Fix:** Created `components/ui/Switch.tsx` encapsulating the toggle logic and styles, and refactored `NotificationSettings` to use this shared component.

## 2025-03-01 - Standardizing Modal Close Buttons
**Drift:** Modal close buttons were implemented as hardcoded `<button>` elements with inconsistent styles (`bg-slate-100`, `bg-brand-100`, `text-gray-400`, `text-brand-400`), creating visual noise and maintenance overhead.
**Fix:** Refactored `AnalyticsModal`, `CaptureModal`, `BatchCategorizeModal`, `FeedbackModal`, `PointsBreakdownModal`, `SafeToSpendModal`, and `SmartHabitReorderModal` to use the standardized `<Button />` component with `ghost` or `subtle` variants.

## 2026-01-30 - Standardizing Status Badges
**Drift:** The codebase contained numerous instances of "Badge-like" elements (Pending status, Tester status, Action hints) implemented as raw `div` or `span` elements with repeated Tailwind classes (`rounded-full`, `px-2 py-1`, `text-xs`), creating visual inconsistencies.
**Fix:** Created `components/ui/Badge.tsx` with standardized variants (success, warning, danger, etc.) and refactored `TransactionItem`, `DeveloperConsole`, and `CaptureModal` to use this shared component.

## 2025-03-02 - Standardizing Points Breakdown Buttons
**Drift:** `PointsBreakdownModal` contained hardcoded increment/decrement buttons using raw `<button>` tags with manual borders and padding, inconsistent with the system's button styles.
**Fix:** Refactored the increment/decrement controls in `PointsBreakdownModal.tsx` to use the standardized `<Button />` component with `variant="secondary"` and `size="icon-sm"`.

## 2025-05-23 - Standardizing Shopping Settings Modal
**Drift:** `ShoppingSettingsModal` used custom underlined tabs and raw HTML `<button>`/`<input>` elements, creating inconsistent styling and maintenance overhead compared to the standard `Tabs`, `Button`, and `Input` components.
**Fix:** Refactored `ShoppingSettingsModal` to use the standardized `Tabs` (segmented style), `Button`, and `Input` components, unifying the UI pattern with `ListsPage` and reducing "snowflake" code.
