# Plan 20: Automatic subscription / recurring-charge detection

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. When done, update this plan's status row in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- utils/transactionIdentity.ts components/budget/RecurringBillsModal.tsx contexts/household/mutations/calendarMutations.ts`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2 (Phase 5)
- **Effort**: M
- **Risk**: LOW — read-only analysis + one existing mutation reused; false positives cost a dismissal tap
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

Transactions already carry `merchant`, `date`, `amount`, and `isRecurring` — but nothing scans history for periodicity; a recurring bill exists only if a user hand-creates a `CalendarItem`. "You have N subscriptions totaling $X/mo" is Rocket Money's signature hook and a proven word-of-mouth feature, and here it needs **zero new data**: a pure clustering util over the already-listened transactions, surfaced where recurring bills already live, with one-tap "Add as bill" via the existing calendar mutation.

## Current state (verified 2026-07-09)

- `types/schema.ts` Transaction: `merchant`, `amount` (decimal dollars), `date` (`yyyy-MM-dd` local), `status`, `source`, `isRecurring?` (~`:161-173`).
- `utils/transactionIdentity.ts` — reuse its primitives: `merchantSimilar(a, b)` (`:85`) for merchant grouping, `IdentityTransaction` (`:33`). Do NOT re-implement merchant normalization.
- `components/budget/RecurringBillsModal.tsx` (+ test) — the existing "recurring bills master list" surface; the detection panel goes HERE (a section below the existing list), not a new page.
- `contexts/household/mutations/calendarMutations.ts` + `contexts/household/types.ts` — `addCalendarItem` exists as a context mutation; check its exact signature in `types.ts` before calling. New `CalendarItem`s for a detected subscription: `type: 'expense'`, `isRecurring: true`, `frequency: 'monthly' | 'weekly'`, `date` = the most recent occurrence, `title` = display merchant.
- Money convention: sum in integer cents via `utils/money.ts` helpers, but store/display decimal dollars (CLAUDE.md).
- Dates: use `date-fns` `differenceInCalendarDays` / `parseISO`; never `new Date(str)` string math conventions beyond what the repo already does.
- Business logic in `utils/` gets heavy unit coverage (repo convention).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Focused | `pnpm test -- subscriptionDetection` | new tests pass |
| Full | `pnpm test && pnpm run build` | exit 0 |

## Scope

**In scope**: new `utils/subscriptionDetection.ts` (+ `.test.ts`), `components/budget/RecurringBillsModal.tsx` (+ its test), `advisor-plans/README.md`.

**Out of scope**:
- Any push notification / insight generation from detections (future ride-along; see Maintenance).
- Cancel/negotiation features, price-change alerts — v2 ideas, not now.
- New Firestore fields or listeners — detection is computed in-render from existing state (memoized).
- `firestore.rules`.

## Steps

### Step 1: Pure detector — `utils/subscriptionDetection.ts`

```ts
export interface DetectedSubscription {
  merchant: string;          // display merchant (most frequent raw spelling in the group)
  cadence: 'monthly' | 'weekly';
  averageAmount: number;     // decimal dollars, cents-safe math internally
  occurrences: number;
  lastDate: string;          // yyyy-MM-dd
  nextExpectedDate: string;  // yyyy-MM-dd
  transactionIds: string[];
}
export function detectSubscriptions(
  transactions: Pick<Transaction, 'id'|'merchant'|'amount'|'date'|'category'>[],
  existingBillTitles: string[],
): DetectedSubscription[]
```

Algorithm (deterministic, tested):
1. Consider only expense-signed transactions (exclude `INCOME_CATEGORY` — find the constant the codebase uses; `sumPendingSpend` references it).
2. Group by merchant using `merchantSimilar` (greedy: each txn joins the first group whose representative matches).
3. A group is **monthly** if ≥3 occurrences with consecutive gaps of 28–33 days; **weekly** if ≥4 occurrences with gaps of 6–8 days. Sort by date first; ignore same-day duplicates.
4. Amount stability: max amount ≤ 1.3 × min amount within the group (in cents).
5. Exclude groups whose merchant matches an existing calendar-bill title (case-insensitive whole-word token overlap against `existingBillTitles` — mirror the token approach documented for bucket↔bill matching in CLAUDE.md's Safe-to-Spend section).
6. `nextExpectedDate` = lastDate + median gap (days), formatted `yyyy-MM-dd`.

Tests (≥10): clean monthly detection; weekly; gap-tolerance boundaries (27 days → no, 28 → yes, 33 → yes, 34 → no); amount-variance boundary; same-day dupes collapsed; income excluded; existing-bill exclusion; <3 occurrences → none; merchant-variant grouping via `merchantSimilar` (e.g. "NETFLIX.COM" / "Netflix").

**Verify**: `pnpm test -- subscriptionDetection` → all pass.

### Step 2: Surface in `RecurringBillsModal`

Read the modal first and match its structure/primitives exactly (Section/Row/Button from `components/ui`). Add a "Detected subscriptions" section under the existing list: memoized `detectSubscriptions(transactions, billTitles)` (transactions from `useFinance()`, bill titles from expanded/raw `calendarItems`), each row showing merchant · cadence · avg amount (via the repo's currency formatter — grep `useFormatCurrency`) · "next ~<date>", with an "Add as bill" button calling `addCalendarItem` and a per-detection localStorage dismissal (key it on merchant+cadence, mirror the dismissal pattern in `components/dashboard/WeeklyRecapCard.tsx`).

**Verify**: `pnpm lint && pnpm test` → exit 0 (extend the modal's existing test with: detections render; Add-as-bill calls the mutation; dismissed detection stays hidden).

### Step 3: Full gates + manual walkthrough

Test Mode: seed data may not contain a detectable pattern — if not, verify via the unit tests + a temporary story of the modal with fixture data in the component test, and say so. Dark mode + mobile viewport check (repo rule: visually verify UI PRs).

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0; walkthrough noted in PR description.

## Done criteria

- [ ] `utils/subscriptionDetection.ts` + ≥10 passing tests
- [ ] Detection section renders in RecurringBillsModal with Add-as-bill + dismissal
- [ ] All gates green; `advisor-plans/README.md` row updated

## STOP conditions

- `addCalendarItem`'s signature doesn't accept the fields listed (check `contexts/household/types.ts` first; report a mismatch rather than adding fields to the mutation).
- The transactions listener window is so short in practice that ≥3 monthly occurrences can't exist (check `utils/listenerWindows.ts` for the transactions window; if <100 days, report — the feature needs the windowed-history loader instead, a scope change).

## Maintenance notes

- Natural v2s (deliberately deferred): a Money-Overview count chip; a `sendweeklyrecap` ride-along line ("2 new subscriptions detected"); price-change alerts (needs per-group amount history).
- The 28–33/6–8 day windows are the tuning surface — keep them as named constants.
