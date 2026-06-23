# Plan 015 — Money-model fix: DECISION RECORD

> **Companion to** [`015-money-model-investigation.md`](./015-money-model-investigation.md) (the
> evidence + analysis). That doc is *complete and stable*; **this** doc is the actionable artifact:
> it states the decision to make, the options, a recommendation, and — once you lock a choice — the
> turnkey implementation plan so the fix becomes a normal `[C]` PR I can pick up.
>
> **Tag:** `[H]` decision → then `[C]` build · **Risk of the fix:** MED (touches the money core) ·
> **Planned against commit:** `73311e5`

---

## ⬇️ THE DECISION YOU NEED TO MAKE

Safe-to-Spend treats `pending_review` spend **inconsistently** because two parts of the code disagree
about *what the checking balance means*. There are **two opposite-signed bugs** (full proof in the
investigation):

| Bug | Path | Direction | Severity |
|----|------|-----------|----------|
| **1 — double-count** | `addTransaction` (manual / receipt / statement) debits checking *and* `pendingSpend` subtracts it again | STS **too low** by the pending amount | Pervasive (the common path) but **safe-direction** (conservative) |
| **2 — invisible** | voice `handleExpense` (when paycheck tracking is on) neither debits checking nor sets `payPeriodId` | STS **too high** — money already spent is shown as available | Rarer path but **dangerous-direction** |

Root cause (one thing): **Model A** (the Safe-to-Spend calculator) assumes the balance reflects
*verified* spend only and adds pending back via `pendingSpend`; **Model B** (`addTransaction`) runs the
balance as a *live ledger* and debits **every** transaction including pending. For a `pending_review`
txn the two stack → subtracted twice.

**You must pick which model is the source of truth.** The fixes interact, so they're chosen as a set —
not one at a time.

```
┌──────────────────────────────────────────────────────────────────────┐
│  DECISION (fill this in):  ☐ Option A   ☐ Option B   ☐ Option C        │
│  Decided by: ____________________   Date: ____________                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## The options

### ✅ Option A — Balance = *verified spend only* (unify on Model A) — **RECOMMENDED**
Make `addTransaction` stop debiting checking for `pending_review`; debit at the moment a txn becomes
`verified` instead. Route the voice path through the same logic. Keep the `pendingSpend` term.

- **Result:** Safe-to-Spend is **correct** for every entry path. Both bugs gone.
- **Cost:** MED-risk change to the money core; the checking-balance number no longer drops the instant
  you log a *pending* expense (it drops when the expense is verified) — a deliberate UX change that
  matches the "manually enter your bank balance" workflow the calculator already assumes.
- **Migration:** existing balances were maintained as a live ledger, so they already include historical
  pending debits. In practice only *currently* `pending_review` txns differ, and users can re-enter
  their real bank balance at any time, so the reconciliation is negligible — but it must be **named in
  the release note** (see implementation plan).
- **Why recommended:** it's the only option that makes STS actually correct, it's what the investigation
  concluded, and the characterization tests already pin the current behavior so the change is well-guarded.

### ⚠️ Option B — Balance = *live ledger* (unify on Model B), drop `pendingSpend`
Keep `addTransaction` debiting every txn; **remove the `pendingSpend` term** from the formula and trust
the balance as authoritative for un-cleared spend.

- **Result:** simpler formula; consistent.
- **Cost:** **breaks the "manually enter your bank balance" workflow** — a manually-entered bank balance
  reflects only *cleared* spend, so pending would vanish from STS again (re-introducing an overstatement).
  Makes the app's balance authoritative for money that hasn't cleared. **Bigger product change, HIGHER
  risk.** Not recommended.

### 🟡 Option C — Consistency-first interim (ship-now, conservative)
Route voice `handleExpense` **through `addTransaction`** so it both debits *and* sets `payPeriodId` —
making **every** path behave identically (all double-count pending).

- **Result:** kills the **dangerous** Bug 2 immediately (voice is no longer invisible); leaves a
  **known, uniform, safe-direction** conservative bias (STS low by the pending amount). **LOW risk.**
- **Cost:** partial — it standardizes on the *wrong-but-safe* behavior. It is **throwaway work** once
  Option A lands (you'd rip the double-count back out).
- **When to pick:** only if you want to neutralize the dangerous bug *this week* but can't schedule the
  MED-risk Option A change soon. Otherwise go straight to A.

> **My recommendation:** **Option A, done directly.** Option C is a reasonable stopgap *only* if Option A
> can't be scheduled promptly — but since the characterization tests already protect the money core and
> Option C is throwaway, the clean path is to do A once.

---

## Turnkey implementation plan (once Option A is locked) — `[C]`, one PR

I can execute this as a normal PR the moment you check Option A above.

1. **`addTransaction`** ([`contexts/FirebaseHouseholdContext.tsx`](../contexts/FirebaseHouseholdContext.tsx),
   the unconditional `increment(-amount)` debit): debit checking **only** when the new txn is
   `status: 'verified'`. For a txn created as `pending_review`, do **not** debit at creation.
2. **Debit at the verify step:** in `updateTransactionCategory` (the pending→verified transition, which
   today writes no `balance:` change), add the checking debit so a txn is debited **exactly once**, at
   the moment it becomes verified. Keep this in the existing atomic `writeBatch`.
3. **Keep edit/delete symmetric and status-aware:** `updateTransaction` adjusts by the amount delta only
   for the portion already reflected in the balance; `deleteTransaction` must **not** credit back a
   `pending_review` txn that was never debited. Add tests for delete-pending and verify-then-delete.
4. **voice `handleExpense`** (the bespoke `addDoc` with no debit / no `payPeriodId`): route it through
   `addTransaction` (preferred — single code path) so it inherits the verified-only debit, `payPeriodId`
   assignment, and validation. While here, add `'voice'` to the `Transaction.source` union in
   [`types/schema.ts`](../types/schema.ts) (the investigation's incidental finding).
5. **Flip the characterization tests** in
   [`utils/safeToSpendCalculator.test.ts`](../utils/safeToSpendCalculator.test.ts) (the
   *"money-model pending double-count (characterization — Plan 015)"* block) from the current `BUG`
   expectations to the **correct** expectations, so they now assert the fixed behavior.
6. **Release note / migration:** document that checking balance now reflects *verified* spend (drops when
   an expense is verified, not when logged as pending), and that users can re-enter their bank balance if
   it looks off during the transition. No data migration script is required; the effect is transient.

**Verify:** `pnpm lint` + `pnpm test` green (with the flipped expectations); spot-check in Test Mode
(`?test=true`) that logging a pending expense no longer drops checking, that verifying it does, and that
Safe-to-Spend matches the hand-computed `balance − unpaidBills − pendingSpend`. Ship in its own PR;
it's a money-core change, so watch the deploy.

## STOP conditions
- Do **not** start the build until a box above is checked — the three options produce *different* code.
- Do **not** combine this with any unrelated change; it's a money-core PR and should be reviewable in isolation.
- If anything about the verify-step or ledger symmetry is ambiguous when building, re-read the
  investigation's **Evidence index** (exact file:line cites) before guessing.
