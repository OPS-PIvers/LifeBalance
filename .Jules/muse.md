## 2024-05-22 - Dashboard Polish
**Critique:** "Developer UI" detected in Dashboard widgets. Excessive use of inner borders (`border-b`) created visual noise. Default `shadow-sm` was too flat.
**Polish:** Applied "Glassmorphism" principles.
- Replaced solid white cards with `bg-white/80 backdrop-blur-xl`.
- Replaced heavy borders with `ring-1 ring-black/5` for optical crispness.
- Replaced default shadows with layered `shadow-glass` and `shadow-premium`.
- Improved typographic hierarchy by increasing header weights to `font-bold tracking-tight` and relaxing body text leading.
