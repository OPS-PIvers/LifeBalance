# Plan 016 — Safe-to-Spend: pool + bucket-tracking breakdown

**Written against commit:** `388fd11` (drift-check before you start: `git log --oneline -1`; if the
files cited below have moved substantially, re-read them before trusting the excerpts).

**Depends on:** nothing. **Related:** Plan 015 (money-model decision) — this extends the same
Safe-to-Spend surface but does **not** change the verified-balance model 015 locked in.

**Risk:** LOW-MED. No Firestore rules change, **no data migration** — pure calculation + display.
One behavioral change to the live Safe-to-Spend number (see Step 1) that some households will see.

**Tag:** `[C]` — ships via PR → CI `validate` → merge → auto-deploy. No human switch.

---

## 1. Why this exists (context an executor needs)

**Safe-to-Spend (StS)** is the app's core financial number, shown permanently in the top toolbar
([components/layout/TopToolbar.tsx](../components/layout/TopToolbar.tsx)) and computed in
[utils/safeToSpendCalculator.ts](../utils/safeToSpendCalculator.ts). Today:

```
StS = checking balance − unpaid bills (this paycheck → next) − pending spend
```

The product owner's model, confirmed in a design interview, is a **"pool + tracking overlay"** model:

- **Checking is one pool; all of it is safe to spend.** Budget buckets do **not** reserve or subtract
  money from StS. (The existing StS formula already reflects this — buckets are not in it.)
- **Buckets are a tracking overlay** — subdivisions that show *where* the pool is going, tweakable
  month to month to save more. A lens, not a vault.
- **Tapping the StS figure should reveal the distribution** — how the pool splits across buckets
  (remaining room in each) plus the unallocated leftover.

This is explicitly **NOT** an envelope model. Do not make buckets reduce StS. If you find yourself
subtracting bucket limits from the headline number, STOP — that is the wrong model and the opposite of
what was decided.

Two problems to fix:

1. **A real bug in today's number.** A calendar bill whose title matches a bucket name is currently
   *excluded* from the unpaid-bills term ([safeToSpendCalculator.ts:130-149](../utils/safeToSpendCalculator.ts#L130)),
   to "avoid double-counting" against a bucket term **that was never implemented**. So a bucketed bill
   is subtracted by *neither* term and silently vanishes — StS reads too high. Since buckets don't
   reserve anything, every unpaid bill must subtract. Removing this matching fixes the number.

2. **No visibility.** StS gives no window into buckets, which is the owner's main complaint. We add a
   breakdown drawer that decomposes the pool: `StS = Σ bucket remaining room + leftover`.

### The decomposition (the new feature)

```
Checking            $2,000
− Unpaid bills       −$300
− Pending             −$0
= Safe to Spend    $1,700          ← headline, unchanged in spirit
   ├ Groceries      $150 left
   ├ Entertainment  $200 left
   ├ Gas            −$50 over       (red — overspent bucket)
   └ Unallocated    $1,400          ← leftover = StS − Σ max(0, remaining)
```

**Decision record (do not re-litigate — these were resolved in the interview):**

| # | Decision |
|---|----------|
| D1 | Buckets never reduce StS. StS stays a checking-based pool. |
| D2 | Per-bucket **remaining** = `limit − spent`, where `spent` = **verified + pending**. |
| D3 | `spent` counts **checking-drawing** spend only — credit-card purchases must NOT shrink remaining. Today `bucketSpentMap` already excludes credit (see §4), so this is satisfied by construction; a comment must lock the intent for the future credit-decoupling plan. |
| D4 | **leftover** = `StS − Σ max(0, remaining)`. Overspent buckets contribute **0** to that sum (clamped), but their row shows the true **−$X over** in red. |
| D5 | leftover may go **negative** ("over-allocated") — show it as a red warning, do **not** clamp. It's the signal that budgets exceed free cash. |
| D6 | Remove bill↔bucket matching entirely: (a) all unpaid bills subtract in StS; (b) paid calendar bills always tag `BUDGETED_IN_CALENDAR`, never a bucket; (c) delete the `resolveBucketForCalendarItem` matcher and its helpers. |
| D7 | The breakdown lives in a **new dedicated drawer** opened by tapping the toolbar StS figure (today it deep-links to `/budget`). Must be lazy-loaded (framer-motion off the boot path). |
| D8 | `isVariable` / `isCore` bucket flags are **inert** in current code — do not branch on them. The distro covers every bucket. |

---

## 2. Files in scope

**Edit:**
- [utils/safeToSpendCalculator.ts](../utils/safeToSpendCalculator.ts) — remove bucket-exclusion; delete dead matcher/helpers; drop the now-unused `buckets` param.
- [utils/safeToSpendCalculator.test.ts](../utils/safeToSpendCalculator.test.ts) — delete bucket-exclusion tests; add "bucketed bill now subtracts" tests; update call sites for the dropped param.
- [contexts/household/mutations/calendarMutations.ts](../contexts/household/mutations/calendarMutations.ts) — `payCalendarItem` always tags `BUDGETED_IN_CALENDAR` for expenses; drop the `resolveBucketForCalendarItem` import + matched-bucket block; drop `buckets` from its deps if it becomes unused.
- [contexts/FirebaseHouseholdContext.tsx](../contexts/FirebaseHouseholdContext.tsx) — update the `calculateSafeToSpendBreakdownFromExpanded(...)` call (drop `buckets` arg).
- [contexts/MockHouseholdContext.tsx](../contexts/MockHouseholdContext.tsx) — update the `calculateSafeToSpendBreakdown(...)` call (drop `buckets` arg).
- [contexts/MockHouseholdContext.test.tsx](../contexts/MockHouseholdContext.test.tsx) — update the mirror call (line ~53).
- [components/layout/TopToolbar.tsx](../components/layout/TopToolbar.tsx) — StS button opens the new drawer (via lazy mount) instead of navigating.
- [utils/subscriptionDetection.ts](../utils/subscriptionDetection.ts) — update the stale doc-comment that references `resolveBucketForCalendarItem` (comment only; no code there uses it).

**Create:**
- `components/budget/SafeToSpendBreakdownDrawer.tsx` — the new decomposition drawer.
- `components/budget/SafeToSpendBreakdownDrawer.test.tsx` — unit tests for the leftover/remaining/over-allocated math via a small pure helper.
- `utils/safeToSpendDistribution.ts` — pure helper that turns `(breakdown, buckets, bucketSpentMap)` into the distro rows + leftover. Keeping the math pure makes it unit-testable without rendering.
- `utils/safeToSpendDistribution.test.ts` — tests for the pure helper.

**Explicitly OUT of scope — do not touch:**
- [components/budget/SafeToSpendDetail.tsx](../components/budget/SafeToSpendDetail.tsx) — the Money → Overview "How is this calculated?" disclosure stays as-is. Its copy "Bucket limits are not subtracted from this number" remains **true** under this plan. Do not delete or duplicate it.
- The verified-balance model, `sumPendingSpend`, credit/account-impact logic (Plan 015 / account-tagging). The `pending` term is unchanged.
- Firestore rules, schema, converters. None change.
- The credit-decoupling idea (letting credit transactions carry a real budget category) — a **separate** future plan. This plan must not make credit spend count toward buckets.

---

## 3. Repo conventions to follow

- **Imports:** always `@/...` for cross-directory; only same-dir `./x` relative. A lint rule bans `../`.
- **Money:** integer-cents helpers in [utils/money.ts](../utils/money.ts) (`sumMoney`, `subtractMoney`) take/return **decimal dollars**. Use them for any sum/subtraction of dollar values — do not hand-roll `+`/`−` on money.
- **Dates/"today":** `getLocalDateString()` from [utils/dateHelpers.ts](../utils/dateHelpers.ts) — never `new Date().toISOString()`. (Not expected to be needed here, but noted.)
- **No suppressions:** zero `@ts-ignore` / `eslint-disable`. Strict mode + `noUncheckedIndexedAccess` — narrow `Map.get()` results (they're `T | undefined`).
- **Lazy Drawer rule (critical):** `MainLayout`/`TopToolbar`/`BottomNav` must **not** statically import any `Drawer`-based modal (keeps `framer-motion` off the boot bundle). Use `React.lazy` + [`LazyMount`](../components/ui/LazyMount.tsx). Follow the exemplar in [components/layout/MainLayout.tsx:140](../components/layout/MainLayout.tsx#L140) (`<LazyMount when={reviewDrawerOpen}>...`).
- **Styling:** Tailwind v4 tokens from [index.css](../index.css); read [DESIGN.md](../DESIGN.md). Money-negative uses `text-money-neg dark:text-money-negDark` (see the `negative` branch in [SafeToSpendDetail.tsx:112-115](../components/budget/SafeToSpendDetail.tsx#L112)). Reuse `Section`/`SurfaceList`/`Row` from [components/ui/Section](../components/ui/Section.tsx) and the `Drawer` primitive from [components/ui/Drawer](../components/ui/Drawer.tsx) (inspect an existing Drawer modal, e.g. the review drawer mounted in MainLayout, for the open/close prop shape).
- **Currency display:** `useFormatCurrency()` from [hooks/useFormatCurrency](../hooks/useFormatCurrency.ts) — never hardcode `$`.

---

## 4. Data already available (no new plumbing)

`useFinance()` (from [contexts/FirebaseHouseholdContext](../contexts/FirebaseHouseholdContext.tsx), typed in [contexts/household/types.ts](../contexts/household/types.ts)) already exposes everything the drawer needs:

- `safeToSpendBreakdown?: SafeToSpendBreakdown` — `{ checkingBalance, unpaidBills, pendingSpend, safeToSpend, nextPaycheckDate }`.
- `buckets: BudgetBucket[]` — each has `id`, `name`, `limit`.
- `bucketSpentMap: Map<string, BucketSpent>` where `BucketSpent = { verified: number; pending: number }`, derived by [calculateBucketSpent](../utils/bucketSpentCalculator.ts) which **already excludes** `CREDIT_CARD_CATEGORY` and `INCOME_CATEGORY` ([bucketSpentCalculator.ts:57-60](../utils/bucketSpentCalculator.ts#L57)). This is why D3 ("checking-drawing only") holds today with no extra work.
- `currentPeriodId: string`.

`spent` for a bucket = `bucketSpentMap.get(bucket.id)` → `verified + pending`. Guard the `.get()`: it can be `undefined` for a brand-new bucket → treat as `{ verified: 0, pending: 0 }`.

`MockHouseholdContext` mirrors all of these already — Test Mode will render the drawer with no extra mock work.

---

## 5. Step-by-step

### Step 1 — Remove bill↔bucket exclusion from the StS calculator

In [utils/safeToSpendCalculator.ts](../utils/safeToSpendCalculator.ts):

1. **Delete** these now-dead exports/helpers entirely: `BUCKET_NAME_MIN_MATCH_LENGTH`, `tokenize`, `resolveBucketForCalendarItem`, `isBillCoveredByBucket`. (Confirm no remaining references *after* Steps 3 & 8 — `grep -rn resolveBucketForCalendarItem` must return only comments.)
2. **`calculateUnpaidBillsInRange`**: remove the `buckets` parameter and the `coveredByBucket` filter. The filter body becomes just: `item.type === 'expense' && !item.isPaid && isAfter(itemDate, startDate) && (isBefore(itemDate, endDate) || itemDate.getTime() === endDate.getTime())`.
3. **Drop the `buckets` parameter** from all four public functions — `calculateSafeToSpendFromExpanded`, `calculateSafeToSpendBreakdownFromExpanded`, `calculateSafeToSpendBreakdown`, `calculateSafeToSpend` — and from their internal delegations. Update the call to `calculateUnpaidBillsInRange` accordingly. Update each function's JSDoc (remove "buckets — for bill matching only" lines).

> Rationale: buckets no longer participate in the formula at all. `tsc` (`noUnusedParameters`) + argument-count checking will flag every missed call site — lean on that as your safety net.

### Step 2 — Update the two production call sites of the calculator

- [contexts/FirebaseHouseholdContext.tsx:560](../contexts/FirebaseHouseholdContext.tsx#L560):
  `calculateSafeToSpendBreakdownFromExpanded(accounts, expandedCalendarItemsForSafeToSpend, buckets, currentPeriodId, transactions)` → drop the `buckets` arg. Leave the memo's dependency array as-is unless `buckets` becomes otherwise unused in that memo (it is used elsewhere in the provider, so the import stays).
- [contexts/MockHouseholdContext.tsx:1234](../contexts/MockHouseholdContext.tsx#L1234):
  `calculateSafeToSpendBreakdown(accounts, calendarItems, buckets, currentPeriodId, transactions)` → drop the `buckets` arg.

### Step 3 — Paid bills never touch buckets

In [contexts/household/mutations/calendarMutations.ts](../contexts/household/mutations/calendarMutations.ts), inside `payCalendarItem` (~line 305-315):

Replace:
```ts
let category: string = BUDGETED_IN_CALENDAR;
if (item.type === 'expense') {
  const matchedBucket = resolveBucketForCalendarItem(item, buckets);
  if (matchedBucket) category = matchedBucket.name;
} else {
  category = 'Income';
}
```
with:
```ts
// Buckets and the calendar are separate domains (Plan 016): a paid bill is
// already accounted for on the calendar and never lands in a budget bucket.
const category: string = item.type === 'expense' ? BUDGETED_IN_CALENDAR : 'Income';
```
Remove the `resolveBucketForCalendarItem` import (line 18). If `buckets` is now unused inside this factory, remove it from the deps object/params (tsc/eslint will tell you). Keep the `BUDGETED_IN_CALENDAR` import.

### Step 4 — Fix the stale comment in subscriptionDetection

In [utils/subscriptionDetection.ts](../utils/subscriptionDetection.ts) (~line 77), the doc-comment references `resolveBucketForCalendarItem` "documented in CLAUDE.md's Safe-to-Spend section." That function no longer exists. Reword to describe the local matcher on its own terms (it has its own symmetric token-window matcher) without naming the deleted function. **Code there is unaffected** — this is comment-only.

### Step 5 — Pure distribution helper

Create `utils/safeToSpendDistribution.ts`:

```ts
import { BudgetBucket } from '@/types/schema';
import { type BucketSpent } from '@/utils/bucketSpentCalculator';
import { type SafeToSpendBreakdown } from '@/utils/safeToSpendCalculator';
import { sumMoney, subtractMoney } from '@/utils/money';

export interface BucketDistroRow {
  id: string;
  name: string;
  limit: number;
  spent: number;        // verified + pending (checking-drawing; credit already excluded upstream)
  remaining: number;    // limit − spent; MAY be negative (overspent)
  isOver: boolean;      // remaining < 0
}

export interface SafeToSpendDistribution {
  rows: BucketDistroRow[];
  /** StS − Σ max(0, remaining). May be negative when budgets exceed free cash. */
  leftover: number;
  /** True when leftover < 0 (over-allocated). */
  overAllocated: boolean;
}

export function computeSafeToSpendDistribution(
  breakdown: SafeToSpendBreakdown,
  buckets: BudgetBucket[],
  bucketSpentMap: Map<string, BucketSpent>,
): SafeToSpendDistribution {
  const rows: BucketDistroRow[] = buckets.map(b => {
    const s = bucketSpentMap.get(b.id) ?? { verified: 0, pending: 0 };
    const spent = sumMoney([s.verified, s.pending]);
    const remaining = subtractMoney(b.limit, spent);
    return { id: b.id, name: b.name, limit: b.limit, spent, remaining, isOver: remaining < 0 };
  });

  // Only positive remaining room is "claimed" against the pool (D4: overspent → 0).
  const claimed = sumMoney(rows.map(r => (r.remaining > 0 ? r.remaining : 0)));
  const leftover = subtractMoney(breakdown.safeToSpend, claimed);

  return { rows, leftover, overAllocated: leftover < 0 };
}
```

Match the surrounding code's style; verify the exact `SafeToSpendBreakdown` / `BucketSpent` export names before importing.

### Step 6 — The drawer component

Create `components/budget/SafeToSpendBreakdownDrawer.tsx`. It:

- Takes `{ open: boolean; onClose: () => void }` (match the `Drawer` primitive's prop shape — inspect [components/ui/Drawer](../components/ui/Drawer.tsx) and an existing Drawer modal first).
- Reads `useFinance()` for `safeToSpendBreakdown`, `buckets`, `bucketSpentMap`; `useFormatCurrency()` for formatting.
- If `safeToSpendBreakdown === undefined`, render nothing (or a skeleton) — same guard as [SafeToSpendDetail.tsx:26](../components/budget/SafeToSpendDetail.tsx#L26).
- Computes rows/leftover via `computeSafeToSpendDistribution(...)` (memoized on its inputs).
- Renders, top to bottom:
  1. **Waterfall** (reuse the `DetailRow` pattern from [SafeToSpendDetail.tsx:95-120](../components/budget/SafeToSpendDetail.tsx#L95) — you may extract/duplicate that small row; do not import from SafeToSpendDetail, keep it self-contained): Checking `+`, Unpaid bills `−`, Pending `−` (only when `> 0`), then the **Safe to Spend** total.
  2. **Distribution** section: one row per `rows` entry — bucket name + right-aligned value. Positive remaining → `"$150 left"` in normal color; `isOver` → `"−$50 over"` in `text-money-neg dark:text-money-negDark`. Show every bucket, including `$0 left`.
  3. **Leftover** row: label "Unallocated" → `fmt(leftover)`. When `overAllocated`, label it "Over-allocated", show the negative in red, and add a one-line hint like "Your budgets exceed available cash — trim a bucket."
- **Copy note:** somewhere in the drawer, one line clarifying the model, e.g. "Buckets track where your spending goes — they don't reduce Safe-to-Spend."

Keep it presentational; all math is in the pure helper.

### Step 7 — Wire the toolbar tap to open the drawer (lazy)

In [components/layout/TopToolbar.tsx](../components/layout/TopToolbar.tsx):

- Add `const [stsOpen, setStsOpen] = useState(false);`.
- Change the StS button's `onClick` at [line 82](../components/layout/TopToolbar.tsx#L82) from `navigate('/budget', { state: { tab: 'overview' } })` to `setStsOpen(true)`.
- Lazy-mount the drawer (do **not** static-import it — see the Lazy Drawer rule):
  ```tsx
  const SafeToSpendBreakdownDrawer = React.lazy(() => import('@/components/budget/SafeToSpendBreakdownDrawer'));
  // ...in JSX, alongside the toolbar root:
  <LazyMount when={stsOpen}>
    <SafeToSpendBreakdownDrawer open={stsOpen} onClose={() => setStsOpen(false)} />
  </LazyMount>
  ```
  Give the drawer a `default export` so `React.lazy` works (or adapt to a named-export lazy pattern already used in the repo — check how MainLayout lazy-loads the review drawer and mirror it exactly).
- Optionally warm it via [preloadOnIdle](../utils/preloadOnIdle.ts) like the other toolbar modals — mirror the existing pattern if present; skip if it adds risk.

> The StS figure no longer deep-links to `/budget`. That's intended (D7). `SafeToSpendDetail` on the Money tab still exists for users who navigate there manually.

### Step 8 — Tests

- **`utils/safeToSpendDistribution.test.ts`** (new): cover — normal (positive leftover), overspent bucket contributes 0 to leftover but row shows negative, over-allocated (Σ remaining > StS → negative leftover + `overAllocated` true), empty buckets (leftover === StS), missing `bucketSpentMap` entry treated as zero. Use plain numbers; assert exact dollar values.
- **`utils/safeToSpendCalculator.test.ts`** (edit): **delete** the tests asserting bucket-covered bills are excluded (search the file for the bucket fixtures around lines 500-660 — e.g. `groceriesBucket`, `rentBucket`, `coBucket`, `gasBucket` used to prove exclusion). **Add** tests proving a bill whose title matches a bucket name now **DOES** subtract from StS. Update all calls to drop the `buckets` argument. `tsc` will list any you miss.
- **`components/budget/SafeToSpendBreakdownDrawer.test.tsx`** (new): render with a small `useFinance` setup (follow how existing budget component tests stub the finance slice — search for tests importing `useFinance`/`MockHouseholdContext`) and assert the rows, leftover, and the over-allocated warning render. If wiring `useFinance` in a test is heavy, it's acceptable to keep the component thin and put all assertions in the pure-helper test — but at minimum assert the drawer mounts and shows the StS total.
- **payCalendarItem tests** (edit): search for existing coverage of `payCalendarItem`'s categorization (grep `payCalendarItem` under `contexts/` and `*.test.*`). Any test expecting a paid bill to land in a matched bucket must now expect `BUDGETED_IN_CALENDAR`.
- **`contexts/MockHouseholdContext.test.tsx`** (edit, ~line 53): drop the `buckets` arg from the `calculateSafeToSpendBreakdown` mirror call.

---

## 6. Verification gates (run in order; all must pass)

```bash
pnpm lint      # tsc --noEmit (catches every dropped-param call site) + eslint, zero suppressions
pnpm test      # full vitest suite — must be green
pnpm run build # production build must succeed (proves the lazy import + chunking is valid)
```

Then a **manual preview check** (the number and the drawer are user-visible):

1. `preview_start` the dev server (`.claude/launch.json` — the LifeBalance dev server), open Test Mode at `/#/login?test=true`.
2. Tap the Safe-to-Spend figure in the toolbar → the breakdown drawer opens (does **not** navigate to `/budget`).
3. Confirm via `read_page`: the waterfall (Checking / bills / pending / StS total), per-bucket rows, and an "Unallocated" leftover row. Mock data has 4 buckets (Groceries 600, Entertainment 200, Utilities 300, Gas 150) — verify remaining math against `bucketSpentMap`.
4. `resize_window` dark + mobile; confirm negative values render in the money-negative color.
5. **Verification caveat (from prior sessions):** the headless preview throttles framer-motion's `AnimatePresence` exit rAF, so the Drawer's *close* animation may not visibly complete even when correct — verify open/content via `read_page`/DOM, and do not block on the exit animation looking perfect. Confirm no console errors via `read_console_messages`.

**Done criteria (machine-checkable):**
- `pnpm lint && pnpm test && pnpm run build` all exit 0.
- `grep -rn "resolveBucketForCalendarItem" --include=*.ts --include=*.tsx .` returns **zero** matches (function deleted, comment reworded).
- A new test asserts a bucket-name-matching unpaid bill subtracts from StS.
- The drawer opens from the toolbar tap in Test Mode with no console errors.

---

## 7. Test plan summary

New pure-logic coverage in `utils/safeToSpendDistribution.test.ts` is the backbone (fast, deterministic,
mirrors how [utils/bucketSpentCalculator](../utils/bucketSpentCalculator.ts) and
[utils/safeToSpendCalculator](../utils/safeToSpendCalculator.ts) are the most-tested utils in the repo).
The calculator test edits prove the behavior flip (bucketed bills now subtract). Component test proves the
drawer mounts and shows the total. Follow existing `*.test.ts(x)` files as patterns; tests live next to
the code.

---

## 8. Maintenance notes / what future changes interact

- **Credit-decoupling plan (future):** if credit transactions later carry real budget categories, the
  distro's `spent` must stay **checking-drawing only** (D3) — otherwise a credit purchase would shrink a
  bucket's remaining room and *raise* leftover/StS despite no checking movement. `bucketSpentMap` excludes
  credit today; that plan must preserve a checking-only figure for this drawer (or split the two "spent"
  notions). Leave a comment in `safeToSpendDistribution.ts` saying so.
- **CLAUDE.md** documents the Safe-to-Spend formula and the bill↔bucket matching as the single source of
  truth. After this ships, update the CLAUDE.md "Safe-to-Spend Logic" section: remove the bucket
  bill-exclusion description, and note buckets are a display overlay, not part of the formula. (Do this in
  the same PR so docs don't drift.)
- **`SafeToSpendDetail`** and the new drawer are two surfaces showing the same headline. They must not
  diverge — both read the context's memoized `safeToSpendBreakdown`. Don't fork the formula.

---

## 9. Escape hatches — STOP and report back if:

- You discover a caller subtracting bucket limits from StS somewhere else (i.e., an envelope-style term
  already exists) — the model assumption is wrong; report before proceeding.
- Removing the `buckets` param cascades into far more than the ~4 call sites + tests listed (e.g. a
  public API consumed widely) — report the true blast radius instead of editing dozens of files silently.
- The `Drawer` primitive's prop contract differs materially from `{ open, onClose }` — adapt, but note it.
- Any test you cannot make pass without a suppression — suppressions are forbidden; report the blocker.
