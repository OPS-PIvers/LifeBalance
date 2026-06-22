# Plan 015 — Money-model investigation: pending-transaction double-count

**Status:** Investigation complete. **No fix applied** (per the PRD: "characterization tests + a
design decision, not a quick fix"). Characterization tests live in
[`utils/safeToSpendCalculator.test.ts`](../utils/safeToSpendCalculator.test.ts) under
*"money-model pending double-count (characterization — Plan 015)"* and pin the current behavior.

**Verified against commit:** the `main` at the time of writing (post-#646).

---

## TL;DR

Safe-to-Spend (the app's core financial metric) treats `pending_review` spend **inconsistently**
depending on how the transaction was created. There are **two opposite-signed bugs**:

| Entry path | Debits checking balance? | Sets `payPeriodId`? | Counted by `pendingSpend`? | Net effect on Safe-to-Spend |
|---|---|---|---|---|
| `addTransaction` (manual / receipt / statement) | **Yes** (always) | Yes | Yes | **2× — double-counted** → STS **too low** |
| voice `handleExpense`, *period tracked* | No | **No** | No (no `payPeriodId`) | **0× — invisible** → STS **too high** |
| voice `handleExpense`, *no period* | No | — | Yes | 1× — correct |

Both stem from one root cause: **two conflicting mental models of the checking balance.**

---

## The two models in conflict

**Model A — the Safe-to-Spend calculator** ([`utils/safeToSpendCalculator.ts`](../utils/safeToSpendCalculator.ts)):

> `safeToSpend = checkingBalance − unpaidBills − pendingSpend`

`pendingSpend` is subtracted **on the explicit assumption that the manually-entered checking balance
does NOT already reflect pending spend** — see the comment at `safeToSpendCalculator.ts:204-206`:

```
// - Only `pending_review` transactions count (verified spend is already
//   reflected in the manually-entered checking balance).
```

So under Model A, the balance reflects **verified** spend only; pending is added back on top via
`pendingSpend`.

**Model B — `addTransaction`** ([`contexts/FirebaseHouseholdContext.tsx:2444-2450`](../contexts/FirebaseHouseholdContext.tsx)):

```ts
// Update checking account balance atomically ...
const checkingAcc = accounts.find(a => a.type === 'checking');
if (checkingAcc) {
  await updateDoc(doc(db, `households/${householdId}/accounts`, checkingAcc.id), {
    balance: increment(roundMoney(-tx.amount)),   // <-- debits for EVERY status
    lastUpdated: serverTimestamp(),
  });
}
```

`addTransaction` runs the balance as a **live ledger**: it debits checking for **every** transaction
regardless of `status` (verified *or* `pending_review`). Complementary ledger writes confirm the
running-ledger intent: `updateTransaction` adjusts by the amount delta
([:2600](../contexts/FirebaseHouseholdContext.tsx)), `deleteTransaction` credits the amount back
([:2635](../contexts/FirebaseHouseholdContext.tsx)), and verifying a pending txn
(`updateTransactionCategory`) does **not** re-debit — so there is no triple-count, but the creation-time
debit means **pending spend is already in the balance.**

**The contradiction:** Model A assumes pending is *not* in the balance; Model B *puts it there*. For a
`pending_review` transaction the two models stack, so it is subtracted twice.

> For a **verified** transaction there is no conflict: Model B debits it (once), and `pendingSpend`
> excludes verified txns, so it is counted exactly once. The bug is specific to `pending_review`.

---

## Bug 1 — `addTransaction` double-counts pending spend

Worked example (checking = $5000, one $100 unpaid bill in-period, one $75 pending_review txn):

1. User adds a $75 pending transaction. `addTransaction` debits checking → **balance = $4925**.
2. Safe-to-Spend computes `4925 − 100 (bill) − 75 (pending) = 4750`.
3. **Correct value is `5000 − 100 − 75 = 4825`.** The $75 is subtracted twice; STS is **$75 too low**.

Direction of error: **understates** available money (overly conservative). Annoying but *safe-ish*.
Characterization test: *"BUG (double-count): addTransaction already debited checking…"*.

## Bug 2 — voice expenses are invisible once paycheck tracking is on

voice `handleExpense` ([`contexts/FirebaseHouseholdContext.tsx:1266-1285`](../contexts/FirebaseHouseholdContext.tsx))
does a raw `addDoc` with `status: 'pending_review'`, **no balance debit**, and **no `payPeriodId`**:

```ts
await addDoc(transactionsRef, {
  amount: data.amount, merchant: data.merchant || 'Unknown',
  category: data.category || 'Uncategorized', status: 'pending_review',
  notes: data.notes || '', date: getLocalDateString(),
  source: 'voice', isRecurring: false, autoCategorized: false,
  createdAt: serverTimestamp(),
  // NOTE: no payPeriodId, and no checking-balance debit
});
```

`pendingSpend` only counts a pending txn whose `payPeriodId === currentPeriodId` when a period is
tracked (`safeToSpendCalculator.ts:225`). A voice expense has **no** `payPeriodId`, so once paycheck
tracking is on it is in **neither** the balance **nor** `pendingSpend` → it disappears from
Safe-to-Spend entirely.

Direction of error: **overstates** available money. **More dangerous** — the user can be told they
have money they have already spent. Characterization test: *"BUG (invisible): a voice expense…"*.

It only behaves correctly when no period is tracked (test *"the voice expense IS counted (once)…"*).

---

## Why this needs a design decision (not a blind fix)

The "obvious" fixes interact, so they must be chosen as a set:

1. **Make `addTransaction` stop debiting for `pending_review`** (debit only on creation-of-verified
   and on verification). This makes Model B match Model A and fixes Bug 1. **But** it changes what the
   checking-balance number *means* in the UI (it would no longer drop the instant you log a pending
   expense), and it must be paired with debiting at the verify step (`updateTransactionCategory`),
   plus correct credit/debit on edit/delete/un-verify. Migrations: existing balances already include
   historical pending debits.
2. **Make voice `handleExpense` set `payPeriodId`** (via `getPayPeriodForTransaction`, as
   `addTransaction` does) and route it through the same validation. This fixes Bug 2 on its own and is
   lower-risk — but it must land *together with* decision (1), because if voice keeps not-debiting while
   `addTransaction` keeps debiting, the two paths still disagree.
3. **Alternative:** keep the live-ledger model and **remove the `pendingSpend` term** from the formula
   (trust the balance). Simpler, but breaks the "manually enter your bank balance" workflow the comment
   describes, and makes the balance authoritative for un-cleared spend — a bigger product change.

**Recommended direction (for review):** unify on Model A —
- `addTransaction`: debit checking only for `verified` txns; debit at the verify step for ones that
  start `pending_review`; keep edit/delete symmetric.
- voice `handleExpense`: set `payPeriodId` + reuse `addTransaction`'s validation (ideally call
  `addTransaction` instead of a bespoke `addDoc`).
- Keep `pendingSpend` as-is.

This keeps Safe-to-Spend correct for both paths and preserves the manual-balance workflow. It is a
**MED-risk change to the money core** and should ship with the characterization tests updated to the
new (correct) expectations, behind its own PR, and ideally spot-checked in Test Mode.

---

## Evidence index

- Formula + `pendingSpend` rule & assumption: `utils/safeToSpendCalculator.ts:170-283` (esp. `:204-206`, `:225`, `:256`, `:280`).
- `addTransaction` unconditional debit: `contexts/FirebaseHouseholdContext.tsx:2444-2450`.
- Ledger symmetry (update/delete): `contexts/FirebaseHouseholdContext.tsx:2596-2600`, `:2632-2635`.
- Verify does not re-debit: `updateTransactionCategory` at `contexts/FirebaseHouseholdContext.tsx:2460+` (no `balance:` write).
- voice `handleExpense` (no debit, no `payPeriodId`): `contexts/FirebaseHouseholdContext.tsx:1266-1285`.
- Characterization tests: `utils/safeToSpendCalculator.test.ts` → *"money-model pending double-count (characterization — Plan 015)"*.

**Incidental finding (minor, not money-related):** voice `handleExpense` writes `source: 'voice'`, but
the `Transaction.source` union in `types/schema.ts` does not include `'voice'` (it lists `manual` /
`camera-scan` / `file-upload` / `telegram` / `recurring`). Harmless today because the write is untyped,
but `'voice'` should be added to the union (or the voice path should use an existing value).
