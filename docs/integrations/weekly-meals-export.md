# Weekly-Meals → LifeBalance Export Contract

This document defines the **exact JSON LifeBalance imports** from the
[`weekly-meals`](https://github.com/OPS-PIvers/weekly-meals) project, and ends
with a **copy-paste prompt** to hand the `weekly-meals` Claude so it builds an
export that drops straight in.

Good news: LifeBalance's importer mirrors your existing `app/data/week.json`
(`schemaVersion: 2`) **verbatim** — `stores` as a keyed object, `meals[]`,
`items[]`, and all. So "the export" is essentially "let the user **copy**
`week.json` to the clipboard," plus a few invariants below that keep the import
lossless.

> **This is a mobile, copy/paste workflow.** The whole loop happens on a phone:
> tap **Copy for LifeBalance** here → open LifeBalance → **Paste from clipboard**.
> Optimize for clipboard copy, not file download. LifeBalance's paste import is
> lenient — a wrapping ` ```json ` fence or surrounding text is tolerated — but a
> clean copy is best.

Ground truth in LifeBalance:
- Type: [`types/weeklyPlan.ts`](../../types/weeklyPlan.ts) (`WeeklyPlan`)
- Mapper: [`utils/weeklyPlanMapper.ts`](../../utils/weeklyPlanMapper.ts) (`mapWeeklyPlan`)
- Scheduler: [`utils/weeklyPlanSchedule.ts`](../../utils/weeklyPlanSchedule.ts) (`buildSchedule`)
- Importer UI: [`components/meals/WeeklyPlanModal.tsx`](../../components/meals/WeeklyPlanModal.tsx)

---

## The contract

### Top level

| Field | Type | Req? | How LifeBalance uses it |
|---|---|---|---|
| `schemaVersion` | `number` | rec. | Should be `2`. Validation anchor for the importer. |
| `weekOf` | `"YYYY-MM-DD"` | **yes\*** | The **Monday** of the week. Used as the start date — `meals[0]` is scheduled on `weekOf`, `meals[1]` on `weekOf + 1 day`, etc. \*If omitted, LifeBalance falls back to the currently-viewed week, but always send it. |
| `weekLabel` | `string` | no | Shown as the plan title in the preview/guide. |
| `subtitle` | `string` | no | Shown under the title. |
| `stores` | `{ [key]: { name, why? } }` | rec. | Keyed object. `name` is the human store name shown in the shopping list; `why` is an optional one-liner. Each `items[].store` must reference one of these keys. |
| `storeOrder` | `string[]` | no | Order stores appear in the shopping list. Defaults to insertion order. |
| `meals` | `Meal[]` | **yes** | Becomes recipes + scheduled dinners. **Array order = cook order = day order.** Import is rejected if this isn't an array. |
| `items` | `GroceryItem[]` | rec. | Becomes the shopping list (consolidated/deduped — see below). |

### `meals[]`

| Field | Type | Req? | How it's used |
|---|---|---|---|
| `name` | `string` | **yes** | Recipe name + the meal-plan entry's label. A meal with no `name` is useless on import. |
| `cuisine` | `string` | no | Becomes a tag; shown as the meal's kicker. |
| `effort` | `"Low"\|"Med"\|"High"` | no | Becomes a tag; shown in the week overview. Use these exact values. |
| `activeMin` | `number` | no | Hands-on minutes, shown in the stats strip. |
| `defaultServe` | `"HH:MM"` (24h) | rec. | **Must be 24-hour** (e.g. `"18:00"`, not `"6pm"`). Seeds the serve-time picker; the cook schedule is back-calculated from it. |
| `servesNote` | `string` | no | e.g. `"5–6 servings"`. Stats strip. |
| `blurb` | `string` | no | One-line description. |
| `ingredients` | `string[]` | rec. | Display strings like `"2 lb chicken thighs"`. Shown as mise-en-place. Parsed best-effort into name/quantity; **the shopping list comes from `items[]`, not these.** |
| `prep` | `Step[]` | rec. | Prep steps. See `Step`. |
| `cook` | `Step[]` | rec. | Cook steps. See `Step`. |
| `uses` | `{ item, from? }[]` | no | Cross-night hand-off carried IN. Shown as a tag/blocks. |
| `saves` | `{ item, to? }[]` | no | Cross-night hand-off saved OUT. |
| `leftovers` | `string[]` | no | Leftover/carryover notes. |

### `Step` (each entry in `prep[]` / `cook[]`)

| Field | Type | Req? | How it's used |
|---|---|---|---|
| `t` | `string` | **yes** | Step title. |
| `min` | `number` | **yes** | **Wall-clock minutes** the step occupies (include hands-off time, e.g. a 2h smoke is `120`). The scheduler sums these and works backwards from the serve time to stamp each step with an absolute clock time. Steps with wrong/missing `min` desync the timeline. |
| `det` | `string[]` | no | Detail bullets. |
| `kid` | `boolean` | no | "Kid can help" tag. |
| `off` | `boolean` | no | Hands-off tag (still counts toward `min`). |
| `timer` | `number` | no | Minutes; renders a "N min timer" chip. |

### `items[]` (the shopping list)

| Field | Type | Req? | How it's used |
|---|---|---|---|
| `n` | `string` | **yes** | Item name. Items without `n` are dropped. |
| `q` | `string` | no | Quantity, e.g. `"2 lb"`. |
| `sec` | `string` | rec. | Section. **Maps cleanly only for:** `meat`, `produce`, `dairy`, `frozen`, `pantry` (plus synonyms `seafood→Meat`, `bakery→Pantry`, `snacks`, `beverages`, `household`). Anything else becomes `Uncategorized`. |
| `store` | `string` | rec. | A **key into `stores`**. If the key isn't in `stores`, the raw key is shown as the name — so make sure every `store` key exists. |
| `p` | `number` | no | Price (dollars). Powers the shopping-list subtotals / grand total. |
| `note` | `string` | no | Carried onto the shopping item. |
| `warn` | `boolean` | no | "Double-check / substitution" flag. |
| `staple` | `boolean` | no | Pantry staple the household likely owns; labeled as such. |

---

## Invariants the export must hold (gotchas)

1. **`weekOf` is the Monday**, `"YYYY-MM-DD"`. Dinners are placed on consecutive days from it, in `meals[]` order.
2. **`meals[]` order is the cook/day order.** First meal = `weekOf`.
3. **`defaultServe` is 24-hour `"HH:MM"`.** A 12-hour string blanks the picker.
4. **Every `Step.min` is real wall-clock minutes**, including hands-off waits — that's what makes the cook timeline correct.
5. **Every `items[].store` key exists in `stores`.**
6. **Prefer the canonical `sec` values** so groceries don't fall into `Uncategorized`.
7. **`items[]` is the consolidated, deduped grocery list** across all meals (LifeBalance does NOT rebuild it from `meals[].ingredients`).
8. Keep `schemaVersion: 2` so the importer can validate the shape.

## Example (minimal but complete)

```json
{
  "schemaVersion": 2,
  "weekOf": "2026-06-08",
  "weekLabel": "Week of June 8, 2026",
  "subtitle": "Three dinners, cooked in order.",
  "stores": {
    "tj":     { "name": "Trader Joe's", "why": "Produce & value" },
    "target": { "name": "Target",       "why": "Pantry & dairy" }
  },
  "storeOrder": ["tj", "target"],
  "meals": [
    {
      "name": "Soy-Garlic Chicken Thighs",
      "cuisine": "Korean",
      "effort": "Low",
      "activeMin": 15,
      "defaultServe": "18:00",
      "servesNote": "5–6 servings",
      "blurb": "Sticky, weeknight-fast, big leftovers.",
      "ingredients": ["2 lb chicken thighs", "Kosher salt", "3 cloves garlic"],
      "prep": [
        { "t": "Pat chicken dry & salt", "min": 5, "det": ["Both sides"], "kid": true }
      ],
      "cook": [
        { "t": "Sear skin-side down", "min": 8 },
        { "t": "Add sauce & simmer",  "min": 12, "off": true, "timer": 12 }
      ],
      "saves": [{ "item": "Cooked chicken (2 cups)", "to": "Wed tacos" }],
      "leftovers": ["Pack 2 portions for lunches"]
    }
  ],
  "items": [
    { "n": "Chicken thighs", "q": "2 lb", "sec": "meat",    "store": "tj",     "p": 9.50 },
    { "n": "Garlic",         "q": "1 head","sec": "produce", "store": "tj",     "p": 0.79 },
    { "n": "Soy sauce",      "q": "1 btl", "sec": "pantry",  "store": "target", "p": 3.49, "staple": true }
  ]
}
```

---

## Copy-paste prompt for the `weekly-meals` Claude

> Paste everything in the box below into a Claude session in the `weekly-meals` repo.

```text
We have a companion app, LifeBalance, that imports this project's weekly plan as
JSON. I want to add an EXPORT affordance to this web app (app/index.html) so I
can hand a plan to LifeBalance losslessly.

This is a MOBILE, copy/paste workflow — everything happens on my phone. The
primary action is a "Copy for LifeBalance" button that copies the current week's
JSON to the CLIPBOARD (a file download is optional/secondary; I won't usually use
it on mobile). The copied JSON must match the contract below EXACTLY — it is
essentially our existing app/data/week.json (schemaVersion 2), so prefer
emitting that structure directly rather than inventing a new shape.

Hard requirements for the exported JSON:
- Top level: { schemaVersion: 2, weekOf, weekLabel, subtitle, stores, storeOrder,
  meals, items }.
- weekOf: the MONDAY of the week, "YYYY-MM-DD".
- stores: a keyed OBJECT { [key]: { name, why? } }. storeOrder: array of those keys.
- meals: an ARRAY; its order IS the cook order / day order (meals[0] is cooked on
  weekOf, meals[1] the next day, etc.). Each meal:
  { name (required), cuisine, effort ("Low"|"Med"|"High"), activeMin,
    defaultServe (24-hour "HH:MM", e.g. "18:00"), servesNote, blurb,
    ingredients (array of display strings like "2 lb chicken thighs"),
    prep[], cook[], uses[{item,from}], saves[{item,to}], leftovers[] }.
  Each prep/cook step: { t (title, required), min (WALL-CLOCK minutes including
    hands-off time, required), det[], kid?, off?, timer? }.
- items: the CONSOLIDATED, DEDUPED grocery list across all meals. Each item:
  { n (name, required), q (quantity), sec, store, p (price number), note, warn,
    staple }. `sec` should be one of: meat, produce, dairy, frozen, pantry.
    `store` MUST be a key that exists in `stores`.

Invariants to verify before writing the file/clipboard:
1. weekOf is a Monday in YYYY-MM-DD.
2. Every meal has a name; meals are in cook order.
3. Every defaultServe is 24-hour HH:MM.
4. Every step.min is real wall-clock minutes (a 2h smoke = 120).
5. Every items[].store key exists in stores.
6. items[] is deduped and is the single source of truth for groceries
   (don't rely on per-meal ingredients for the shopping list).
7. schemaVersion is 2.

Implementation notes:
- No build step / vanilla JS is fine; reuse the in-memory DATA/STATE the app
  already loads from week.json.
- PRIMARY action is clipboard copy via navigator.clipboard.writeText(JSON), with
  a clear "Copied!" confirmation and a textarea-select fallback for browsers that
  block the Clipboard API. A file download can be a secondary option.
- Add the button to the masthead or shopping summary; keep it mobile-first and
  consistent with DESIGN.md tokens.
- Add a short README note documenting the export and linking to this contract.

When done, show me the exact JSON your export produces for the current week so I
can paste it into LifeBalance to verify a round-trip.
```
