## 2024-05-22 - Initial Aesthetic Audit

**Critique:** "Amateur" markers found in `Dashboard.tsx` and `BudgetCalendar.tsx`.
- **Dashboard Pay Modal:** Inline implementation uses default "Developer UI" styling (flat white background, standard borders, weak hierarchy).
- **Budget Calendar:**
    - Grid cells feel "boxy" and harsh with default borders.
    - Selected state uses a generic brand color instead of a sophisticated neutral (Slate-900).
    - "Detail List" items lack depth and breathing room (p-3 is too tight).
    - Icons use standard circles instead of modern squircles.

**Polish:** Applying "Muse" principles.
- **Glassmorphism:** Adding `backdrop-blur-xl` and `bg-white/90` to modals and cards.
- **Squircle Everything:** Converting `rounded-full` icons to `rounded-2xl`.
- **Slate Supremacy:** shifting primary text from `brand-800` (often a mixed blue/gray) to `slate-900` for crispness.
- **Breathing Room:** Increasing padding from `p-3` to `p-4` in list items.
