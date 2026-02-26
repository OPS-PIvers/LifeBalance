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

## 2025-02-18 - [Modal Standardization] **Drift:** Repeated hardcoded modal structures (`fixed inset-0 z-[60]...`) across 14+ files. **Fix:** Created `components/ui/Modal.tsx` and refactored `CaptureModal` and `BucketFormModal` to use it.
## 2025-02-18 - [EditTransactionModal Standardization] **Drift:** `EditTransactionModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) and lacked backdrop click-to-close functionality. **Fix:** Refactored to use the shared `Modal` component, ensuring consistency and adding backdrop click behavior.
## 2025-02-18 - [AnalyticsModal Standardization] **Drift:** `AnalyticsModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) instead of the shared `Modal` component. **Fix:** Refactored `AnalyticsModal` to use the shared `Modal` component, ensuring consistency in z-index, backdrop, and behavior.
## 2025-02-18 - [HabitSubmissionLogModal Standardization] **Drift:** `HabitSubmissionLogModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) with manual mobile safe area padding. **Fix:** Refactored to use the shared `Modal` component, ensuring consistent z-index, backdrop behavior, and layout.
## 2025-02-27 - [Button Standardization] **Drift:** `ActionQueueItem` contained hardcoded solid-color buttons (`bg-emerald-500`, `bg-rose-500`, `bg-amber-500`) instead of using the shared `Button` component, creating duplicate styles and inconsistency. `TopToolbar` used hardcoded `text-[9px]` instead of the design system token `text-xxs`. **Fix:** Added `success`, `warning`, and `destructive` variants to `components/ui/Button.tsx`. Refactored `ActionQueueItem` to use these variants. Replaced `text-[9px]` with `text-xxs` in `TopToolbar`.

## 2025-03-03 - Standardizing Global Overlay Z-Indices
**Drift:** `App.tsx` used hardcoded "magic number" z-indices (`z-[9999]`, `zIndex: 99999`) for the Test Mode banner and Toast notifications, breaking the semantic stacking context.
**Fix:** Added `banner: '55'` and `toast: '110'` to the Tailwind z-index scale and refactored `App.tsx` to use `z-banner` and `z-toast` tokens.

## 2025-03-05 - Standardizing Z-Index and Typography
**Drift:** `HabitCard.tsx` relied on inline `style={{ zIndex: ... }}` to manage complex stacking contexts, while `ActionQueueItem.tsx` and `App.tsx` used hardcoded values like `text-[8px]` and `z-[9999]`, violating the design system tokens.
**Fix:** Refactored `HabitCard.tsx` to use standard Tailwind classes (`z-0`, `z-10`, `z-20`, `z-sticky`, `z-dropdown`) and replaced hardcoded tokens in `ActionQueueItem` (`text-xxs`) and `App` (`z-popover`).

## 2025-03-06 - Standardizing Collapsible Sections and Card Utilities
**Drift:** The `Settings` page used a custom `SettingsSection` component with hardcoded styles and logic for accordion-like behavior. Additionally, `components/ui/Card.tsx` duplicated the `cn` utility logic instead of importing the shared `utils/cn.ts` helper.
**Fix:** Created `components/ui/CollapsibleCard.tsx` to standardize the accordion pattern, refactored `Settings.tsx` to use it, and updated `Card.tsx` to use the shared `cn` utility.

## 2026-02-08 - Standardized TransactionMasterList Buttons
**Drift:** `TransactionMasterList` contained 15+ instances of raw `<button>` elements with hardcoded Tailwind classes, duplicating logic found in the `Button` component and creating maintenance overhead.
**Fix:** Refactored `TransactionMasterList.tsx` to use the standardized `<Button />` component with `ghost`, `subtle`, `primary`, and `destructive` variants, ensuring consistent focus states and visual style.

## 2026-03-08 - Standardizing Progress Bars
**Drift:** The codebase contained multiple instances of hardcoded progress bars with inconsistent styling (height, border radius, colors) and repeated inline styles for width calculation.
**Fix:** Created `components/ui/ProgressBar.tsx` with standardized sizes (`xs` to `xl`) and refactored `BudgetBucketCard`, `CategorySpendWidget`, `ChallengeWidget`, `BudgetAccounts`, `BudgetHistory`, and `SafeToSpendModal` to use this shared component.
