# LifeBalance: Weekly-Meals Import — Handoff

**For a future Claude session in the LifeBalance repo.** Point that session at
this file. Goal: turn the current paste-only import into an easy, robust import
of a `weekly-meals` plan (download/URL/paste) with friendly validation.

## What already exists (don't rebuild)

The end-to-end pipeline is already in place — this work is mostly UX + hardening.

| Piece | File | Status |
|---|---|---|
| Interchange type (`WeeklyPlan`, mirrors `week.json` v2) | [`types/weeklyPlan.ts`](../../types/weeklyPlan.ts) | ✅ done |
| Plan → LifeBalance mapper (meals, dinners, shopping) | [`utils/weeklyPlanMapper.ts`](../../utils/weeklyPlanMapper.ts) | ✅ done |
| Cook scheduler / clock math | [`utils/weeklyPlanSchedule.ts`](../../utils/weeklyPlanSchedule.ts) | ✅ done |
| Native renderer (Week / Recipe / Shopping / Cook Mode) | [`components/meals/MealGuide.tsx`](../../components/meals/MealGuide.tsx) | ✅ done |
| "Plan My Week" flow: generate **or import (paste) → preview → apply** | [`components/meals/WeeklyPlanModal.tsx`](../../components/meals/WeeklyPlanModal.tsx) | ⚠️ paste-only |

`WeeklyPlanModal.handleApply` already: creates meals (suppressed toasts),
schedules them as consecutive dinners from the selected week, and **dedupes
shopping items** against the existing unpurchased list via `normalizeToKey`
with a continued `order` sequence. Reuse it — don't reinvent the apply path.

The exact JSON contract LifeBalance consumes is in
[`weekly-meals-export.md`](./weekly-meals-export.md). Read it first.

## What to build

Upgrade the **Import** branch of `WeeklyPlanModal` (currently `mode === 'import'`,
a textarea + `JSON.parse`) into three input methods, then route into the
existing `setPlan(...) → preview → handleApply` flow:

1. **Upload a `.json` file** — file picker, read as text, parse. Primary path
   (matches the `weekly-meals` "download week-export.json" export).
2. **Fetch from a URL** — paste a link (e.g. the GitHub Pages
   `…/app/data/week.json` raw URL); fetch + parse. Handle CORS/network errors
   gracefully. (Optional but high-value — enables near one-tap sync.)
3. **Paste JSON** — keep the existing textarea as a fallback.

A small segmented control (Upload / URL / Paste) at the top of the import mode
is enough.

## Validation to add (harden `handleImport`)

Today it only checks `Array.isArray(parsed.meals)`. Add a small validator
(consider `utils/weeklyPlanValidate.ts` + unit tests) that returns friendly,
specific errors instead of a generic toast:

- Reject non-objects / `JSON.parse` failures with "Couldn't read that file."
- Require `meals` to be a non-empty array; require each meal to have a `name`.
- Warn (don't reject) when `schemaVersion !== 2`.
- Default `weekOf` to the selected week if missing (already done) — but if
  present, validate it parses as a date.
- Normalize `defaultServe`: if not 24-hour `HH:MM`, drop it so the scheduler's
  18:00 fallback applies cleanly (the renderer already guards the input).
- Surface a soft warning if any `items[].store` key is missing from `stores`,
  or if `sec` values fall outside the known set (they'll map to `Uncategorized`).

Keep validation in a pure, tested helper so it's reusable by both the import and
the AI-generate paths.

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

- [ ] Import a real `weekly-meals` `week-export.json` via **file upload**, see it
      in the Meal Guide preview, apply it, and confirm the meals land on the
      right days and the shopping list has no duplicates.
- [ ] URL import works against the GitHub Pages `week.json` (or fails gracefully).
- [ ] Malformed/empty/old-schema JSON shows a specific, friendly error.
- [ ] New validator has unit tests; `npm run build`, `tsc`, `eslint`, and the
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
