# Unifier Journal

## 2025-02-18 - [Initial Audit] **Drift:** N/A **Fix:** Initial creation of journal.

## 2025-02-18 - [Modal Standardization] **Drift:** Repeated hardcoded modal structures (`fixed inset-0 z-[60]...`) across 14+ files. **Fix:** Created `components/ui/Modal.tsx` and refactored `CaptureModal` and `BucketFormModal` to use it.

## 2025-02-18 - [EditTransactionModal Standardization] **Drift:** `EditTransactionModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) and lacked backdrop click-to-close functionality. **Fix:** Refactored to use the shared `Modal` component, ensuring consistency and adding backdrop click behavior.

## 2025-02-18 - [AnalyticsModal Standardization] **Drift:** `AnalyticsModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) instead of the shared `Modal` component. **Fix:** Refactored `AnalyticsModal` to use the shared `Modal` component, ensuring consistency in z-index, backdrop, and behavior.

## 2025-02-18 - [HabitSubmissionLogModal Standardization] **Drift:** `HabitSubmissionLogModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) with manual mobile safe area padding. **Fix:** Refactored to use the shared `Modal` component, ensuring consistent z-index, backdrop behavior, and layout.

## 2025-02-18 - [BudgetCalendar Modal Standardization] **Drift:** `BudgetCalendar` utilized a legacy custom `div` overlay (`fixed inset-0 z-50...`) for its event creation modal, lacking standard features like backdrop click-to-close, escape key handling, and consistent z-index. **Fix:** Refactored to use the standardized `Modal` component, enabling keyboard accessibility and visual consistency while resolving a duplicate key warning in the calendar grid.

## 2025-02-23 - [Input/Select Standardization] **Drift:** Widespread usage of hardcoded `<input>` and `<select>` elements with inconsistent styling (e.g., `brand-500` vs `brand-400`, `ring` vs `border`) and repetitive Tailwind classes. **Fix:** Created `components/ui/Input.tsx` and `components/ui/Select.tsx` (using a shared `cn` utility) and refactored `EditTransactionModal`, `ToDosPage`, and `MemberModal` to use them.

## 2025-02-27 - [Button Standardization] **Drift:** `ActionQueueItem` contained hardcoded solid-color buttons (`bg-emerald-500`, `bg-rose-500`, `bg-amber-500`) instead of using the shared `Button` component, creating duplicate styles and inconsistency. `TopToolbar` used hardcoded `text-[9px]` instead of the design system token `text-xxs`. **Fix:** Added `success`, `warning`, and `destructive` variants to `components/ui/Button.tsx`. Refactored `ActionQueueItem` to use these variants. Replaced `text-[9px]` with `text-xxs` in `TopToolbar`.

## 2025-03-07 - [NotificationSettings Standardization] **Drift:** `NotificationSettings.tsx` used hardcoded `input`, `select`, and `button` elements, creating visual inconsistency and technical debt. **Fix:** Refactored to use shared `Button`, `Input`, and `Select` components. Enhanced `Input` and `Select` to support `containerClassName` for flexible sizing.
