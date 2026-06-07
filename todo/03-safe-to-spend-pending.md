# Handoff: Account for pending transactions in Safe-to-Spend

**Status:** Not started · **Priority:** Medium (money-correctness) · **Risk:** Medium (depends on a product fact)

---

## Problem

The CLAUDE.md spec for Safe-to-Spend says it should subtract **pending transactions** from
both the checking balance and bucket liabilities. The implementation does not — it never looks at
transactions at all:

```
Checking Balance − Unpaid Bills (this period) − Remaining Bucket Limits
```

So unverified/pending spending that has (or will) leave the checking account is invisible to
Safe-to-Spend, which can overstate available funds.

### Evidence / where to look

- `utils/safeToSpendCalculator.ts` — `calculateSafeToSpendBreakdownFromExpanded(accounts, allExpandedItems, buckets, currentPeriodId)` takes **no** `Transaction[]` parameter and never references transactions.
- Compare with `utils/bucketSpentCalculator.ts`, which *does* fold pending (`pending_review`) transactions into bucket spend.
- Wired into the context in `contexts/FirebaseHouseholdContext.tsx` (the `safeToSpend` scalar and the new `safeToSpendBreakdown` memo).

## Why this was deferred (needs a decision)

The correct fix depends on **how `account.balance` is sourced**, which is a product fact:

- **If balances are entered manually** (the app does not bank-sync), then pending charges are *not*
  yet reflected in `account.balance`, and Safe-to-Spend should subtract the sum of
  `pending_review` transactions in the current pay period from the checking balance. ✅ implement.
- **If balances are bank-synced** (already include pending/authorization holds), subtracting again
  would **double-count** and *understate* Safe-to-Spend. ❌ do not implement; instead update the
  CLAUDE.md spec to document the actual (correct) behavior.

## Proposed approach (manual-balance case)

1. Add a `transactions: Transaction[]` (or a pre-summed `pendingByBucket` + `pendingTotal`) param to
   the calculator. Keep the existing signature working via an overload or optional param to avoid a
   big call-site churn, or update the single context call site.
2. Subtract the sum of current-period `pending_review` transaction amounts from the checking balance.
3. Avoid double-counting against buckets: a pending transaction already reduces a bucket's
   *remaining* limit via `bucketSpentCalculator`; make sure the breakdown's "remaining bucket
   limits" term and the new "pending" term don't both deduct the same dollars. Mirror the existing
   double-count guard used for bills-covered-by-buckets.
4. Add unit tests in `utils/safeToSpendCalculator.test.ts` covering: pending reduces STS; pending
   already inside a bucket isn't deducted twice; no transactions → unchanged result.

## Risks

- Double-counting (pending counted in both the checking term and the bucket term).
- If balances turn out to be bank-synced, this is a regression — confirm the product fact first.

## Acceptance criteria

- Decision recorded (manual vs synced).
- If manual: STS visibly drops by pending spend; no double-count; tests added; CLAUDE.md unchanged
  (spec already matches).
- If synced: no code change; CLAUDE.md updated to state pending is already reflected in balances.
