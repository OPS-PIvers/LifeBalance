## 2024-05-23 - Standardizing Micro Typography
**Drift:** The codebase contains 60+ instances of the hardcoded class `text-[10px]`, creating "Snowflakes" and making global typography adjustments impossible.
**Fix:** Added `xxs: '10px'` to the Tailwind configuration and replaced all hardcoded instances with the semantic token `text-xxs`.
