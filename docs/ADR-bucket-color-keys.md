# ADR: Persist BudgetBucket colors as semantic keys, not raw Tailwind classes

- **Status:** Accepted (2026-06-30)
- **Scope:** `BudgetBucket.color`

## Context

A budget bucket's identity color was persisted as a **raw Tailwind class string**
(`"bg-emerald-500"`) directly on the Firestore document, chosen from a hard-coded
list in `BucketFormModal`. The render sites interpolated that string straight into
`className`.

This is the one genuinely non-presentational item from the UI-10x audit: budget
**data** carried presentation classes that bypass the token system, can never be
themed or dark-tuned, and are brittle (a class rename in render code would silently
break stored data). Every other "raw palette" finding in that sweep was render-only
and fixed in place; this one touches persisted data, so it was carved out for its
own change.

## Decision

Persist a stable **semantic key** (`"emerald"`) and define the actual class in one
place — mirroring the existing `data/storeColors.ts` (stores already store a
`STORE_COLORS` key).

- New `data/bucketColors.ts`: `BUCKET_COLORS` (key → `{ id, label, bg }`),
  `BUCKET_COLOR_KEYS`, `DEFAULT_BUCKET_COLOR`, `normalizeBucketColorKey()`,
  `bucketColorClass()`. The eight keys map 1:1 to the eight legacy
  `bg-<name>-500` options, so colors are preserved exactly.
- `BucketFormModal` writes the **key**; its swatches render `BUCKET_COLORS[key].bg`.
- `BudgetBucketCard` resolves the key → class via `bucketColorClass(bucket.color)`
  at its two render sites (the dot and the progress-bar fill).
- `BudgetBucket.color` stays typed `string` (legacy docs may still hold a raw
  class); the type comment documents that it is a `BUCKET_COLORS` key normalized
  on read.

## Migration strategy: backfill-on-read (no destructive bulk rewrite)

`budgetBucketConverter.fromFirestore` normalizes `color` via
`normalizeBucketColorKey`, so **in-memory buckets always carry the key**, whatever
the stored form. Combined with the picker writing keys, this means:

- New buckets store the key.
- Existing buckets that still store a raw class are normalized to a key on every
  read and re-persisted as a key the next time they're edited.
- `normalizeBucketColorKey` / `bucketColorClass` accept **both** forms forever, so
  nothing breaks at any point in the transition and an unrecognized value falls
  back to `DEFAULT_BUCKET_COLOR`.

A one-shot bulk rewrite of stored docs is therefore **not required** (and avoided —
a write-on-load side-effect across all households is riskier than it's worth). If a
hard data cleanup is ever wanted, it's a trivial follow-up (read each bucket, write
`normalizeBucketColorKey(color)` back once).

## Consequences

- The persisted value is now a stable key; the class lives in one module and can be
  dark-tuned there later (a deliberate categorical *data palette*, exempt from the
  two-accent chrome rule, like data-viz).
- Zero visual change — every key resolves to the identical `bg-<name>-500` class.
- The legacy `bg-<name>-500` literals still appear as string values in
  `data/bucketColors.ts`, so Tailwind continues to generate those utilities (no
  safelist needed).
