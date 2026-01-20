# Unifier Journal

## 2026-01-20 - Tabs / Segmented Controls
**Drift:** Found 3+ different implementations of "Tabs" or "Segmented Controls" (Habits, Budget, Meals, Modals). Some use `brand-100` background, others white. Some use `flex`, others `overflow`.
**Fix:** Created a standardized `Tabs` compound component (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) to unify these patterns under the dominant "Brand" style (Brand-100 container, White active pill).
