## 2024-05-23 - Standardizing Micro Typography
**Drift:** The codebase contains 60+ instances of the hardcoded class `text-[10px]`, creating "Snowflakes" and making global typography adjustments impossible.
**Fix:** Added `xxs: '10px'` to the Tailwind configuration and replaced all hardcoded instances with the semantic token `text-xxs`.

## 2024-05-24 - Standardizing Z-Index
**Drift:** The codebase contained scattered z-index values (`z-[60]`, `z-[70]`, `z-50`) creating a fragile stacking context and making it difficult to manage layer priority.
**Fix:** Added semantic z-index scale to Tailwind config (`z-sticky: 40`, `z-dropdown: 50`, `z-modal: 60`, `z-popover: 70`) and refactored all hardcoded instances to use these tokens.

## 2026-01-24 - Standardizing Dashed Buttons and Inputs
**Drift:** "Add New Item" buttons were using hardcoded `border-dashed` classes across multiple files, and modal inputs/selects were using raw HTML elements instead of shared components.
**Fix:** Added `dashed` variant to `Button` component and refactored `BudgetBuckets` and `BudgetAccounts` to use standard `Button`, `Input`, and `Select` components.
