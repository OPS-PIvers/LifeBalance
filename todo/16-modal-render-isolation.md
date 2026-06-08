# 16 — Modal render-isolation: narrow context slices + AI type imports

Two low-risk, repetitive cleanups deferred from the optimization pass because they touch many files
and individually carry little value — batch them into one mechanical PR.

## 16a — Modal slice migration
### Problem
~18 modal components consume the broad `useHousehold()` shim while needing only 1–2 domains, so any
domain change (shopping toggle, meal edit, habit toggle) re-renders every still-mounted modal.
`Dashboard` and `useActionQueue` were already migrated to granular slices; the modals were not.

### Current state
- `components/modals/*.tsx` — e.g. `CaptureModal.tsx`, `HabitCreatorWizard.tsx`, `BucketFormModal.tsx`
  call `useHousehold()` but use a narrow field set.
### Approach
- Replace `useHousehold()` with the narrowest applicable hook(s) (`useFinance` / `useGamification` /
  `useTodos` / `useShopping` / `useMealPlan` / `useHouseholdCore`) per modal, verifying field-by-field.
- Prefer `{isOpen && <Modal/>}` conditional mounting where a modal is currently always mounted.

## 16b — AI type imports off the boot path
### Problem
Several always-loaded components import type-only names (`MagicActionResponse`, `ReceiptData`,
`HabitPatternInsight`, `HabitReorganizationPlan`, …) from `services/geminiService` (the value module),
pulling the `@google/genai` SDK into their module graph. CLAUDE.md's stated intent is to import AI
types from `services/geminiService.types.ts`.
### Current state
- `components/modals/CaptureMagicAction.tsx:5`, `CaptureModal.tsx:7`, `SmartHabitAdjustModal.tsx:5`,
  `SmartHabitReorderModal.tsx:6`, `CaptureMenu.tsx:5`, `meals/ShoppingListTab.tsx:7`, `HabitCoach.tsx:3`.
- `ReceiptData` is declared in `geminiService.ts` and **not** re-exported from `.types`.
### Approach
- Move `ReceiptData` into `geminiService.types.ts` (re-export from `geminiService.ts`).
- Change the listed imports to `import type { … } from '@/services/geminiService.types'`.
- Keep genuine value imports (e.g. `reorganizeHabits`) in the main module (already lazy-loaded).

## Risks
- Low. Pure import/hook swaps; rely on `tsc` + existing tests. Watch for a modal that genuinely needs
  a broad field set (verify before narrowing).

## Acceptance criteria
- No modal consumes `useHousehold()` for a single-domain need; AI types imported from `.types`.
- `pnpm lint` + `pnpm test` + build green; bundle composition unchanged or improved.
