# Unifier Journal

## 2025-02-18 - [Initial Audit] **Drift:** N/A **Fix:** Initial creation of journal.

## 2025-02-18 - [Modal Standardization] **Drift:** Repeated hardcoded modal structures (`fixed inset-0 z-[60]...`) across 14+ files. **Fix:** Created `components/ui/Modal.tsx` and refactored `CaptureModal` and `BucketFormModal` to use it.

## 2025-02-18 - [EditTransactionModal Standardization] **Drift:** `EditTransactionModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) and lacked backdrop click-to-close functionality. **Fix:** Refactored to use the shared `Modal` component, ensuring consistency and adding backdrop click behavior.

## 2025-02-18 - [AnalyticsModal Standardization] **Drift:** `AnalyticsModal` was using a hardcoded modal structure (`fixed inset-0 z-[60]...`) instead of the shared `Modal` component. **Fix:** Refactored `AnalyticsModal` to use the shared `Modal` component, ensuring consistency in z-index, backdrop, and behavior.
