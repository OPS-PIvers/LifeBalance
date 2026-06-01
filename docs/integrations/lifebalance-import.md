# LifeBalance: Weekly-Meals Import — Handoff

**For a future Claude session in the LifeBalance repo.** Point that session at
this file.

> **Paste is the primary path.** This is a mobile, copy/paste workflow (copy
> `week.json` in the weekly-meals app → **Paste from clipboard** in LifeBalance).
> A mobile-friendly paste import is already built (see below). File-upload / URL
> fetch are **optional** niceties, not the main flow — don't prioritize them.

## What already exists (don't rebuild)

The end-to-end pipeline is already in place — this work is mostly UX + hardening.

| Piece | File | Status |
|---|---|---|
| Interchange type (`WeeklyPlan`, mirrors `week.json` v2) | [`types/weeklyPlan.ts`](../../types/weeklyPlan.ts) | ✅ done |
| Plan → LifeBalance mapper (meals, dinners, shopping) | [`utils/weeklyPlanMapper.ts`](../../utils/weeklyPlanMapper.ts) | ✅ done |
| Cook scheduler / clock math | [`utils/weeklyPlanSchedule.ts`](../../utils/weeklyPlanSchedule.ts) | ✅ done |
| Native renderer (Week / Recipe / Shopping / Cook Mode) | [`components/meals/MealGuide.tsx`](../../components/meals/MealGuide.tsx) | ✅ done |
| "Plan My Week" flow: generate **or import → preview → apply** | [`components/meals/WeeklyPlanModal.tsx`](../../components/meals/WeeklyPlanModal.tsx) | ✅ mobile paste import built |

`WeeklyPlanModal` already ships a **mobile-first paste import**:
- A **"Paste from clipboard"** button (`navigator.clipboard.readText()`, with a
  long-press fallback toast) plus a manual textarea.
- **Lenient parsing** (`extractJson`): strips a wrapping ` ```json ` fence and
  falls back to the outermost `{ … }` if there's surrounding chat text.
- **Specific errors**: invalid JSON vs. no-meals vs. empty clipboard.
- `handleApply` creates meals (suppressed toasts), schedules them as consecutive
  dinners from the selected week, and **dedupes shopping items** against the
  existing unpurchased list via `normalizeToKey` with a continued `order`
  sequence. Reuse it — don't reinvent the apply path.

The exact JSON contract LifeBalance consumes is in
[`weekly-meals-export.md`](./weekly-meals-export.md). Read it first.

## What's worth building next (incremental)

The paste flow works. These are optional refinements, roughly in priority order:

1. **Stronger, pure validation helper.** `importPlan` currently checks JSON
   parse + non-empty `meals`. Extract a pure `utils/weeklyPlanValidate.ts`
   (with unit tests) reused by both import and AI-generate that also:
   - requires each meal to have a `name`;
   - warns (doesn't reject) when `schemaVersion !== 2`;
   - validates `weekOf` parses as a date when present;
   - normalizes `defaultServe`: if not 24-hour `HH:MM`, drop it so the
     scheduler's 18:00 fallback applies (the renderer already guards the input);
   - soft-warns when an `items[].store` key is missing from `stores`, or a `sec`
     value is outside the known set (maps to `Uncategorized`).
2. **Pre-apply summary.** In the preview, show "3 dinners → Mon–Wed · 18 grocery
   items (2 already on your list)" so the user knows what'll happen before
   tapping apply.
3. **(Optional, low priority) URL fetch / file upload.** Only if desired —
   mobile users will almost always paste. If added, keep paste primary.

## Edge cases / decisions worth surfacing to the user

- **Day placement.** `mapWeeklyPlan` schedules meals on **consecutive days from
  the selected week's Monday**, all typed `dinner`. If you want the user to pick
  a start day or specific nights, add it to the mapper (`opts.startDate` already
  exists) and the preview. Don't silently change the default.
- **Re-import / overlap.** Applying is idempotent-ish on groceries (dedup by
  normalized name) but **not on meals** — re-applying creates duplicate recipes.
  Consider detecting an already-imported `weekOf` and offering "replace vs add."
- **Partial failure.** `handleApply` has no rollback; if a meal write fails
  mid-batch, earlier meals persist as orphans. Consider a best-effort cleanup or
  a clearer error state.

## Acceptance criteria

- [ ] **Paste** a real `weekly-meals` `week.json` (copied on mobile, possibly
      inside a ` ```json ` fence), see it in the Meal Guide preview, apply it,
      and confirm the meals land on the right days and the shopping list has no
      duplicates.
- [ ] Malformed / empty / old-schema JSON shows a specific, friendly error.
- [ ] Any new validator has unit tests; `npm run build`, `tsc`, `eslint`, and the
      full test suite pass. **No eslint/ts suppressions** (project hard rule —
      see CLAUDE.md).

## Quick orientation commands

```bash
# The contract + example JSON to test against:
sed -n '1,200p' docs/integrations/weekly-meals-export.md

# The pieces you'll touch / reuse:
$EDITOR components/meals/WeeklyPlanModal.tsx        # import mode + handleApply
$EDITOR utils/weeklyPlanMapper.ts                   # mapWeeklyPlan(plan, { startDate })
$EDITOR types/weeklyPlan.ts                         # WeeklyPlan shape
```
