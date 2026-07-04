# Plan 03 — Unified Transaction Identity & Reconciliation

**Impact:** HIGH (kills duplicate-transaction distrust; the hard prerequisite for Plaid)
· **Effort:** L (4–7 days) · **Risk:** MED (touches money paths; mitigate via Plan 07 first)
· **Confidence:** HIGH on the problem, MED on exact merge policy (owner may want to tune)

## The problem, precisely

A single real-world purchase can enter LifeBalance through **eight** paths, and today they
are reconciled only pairwise:

| # | Path | Writer | `source` value |
|---|------|--------|----------------|
| 1 | Manual entry | client `addTransaction` | `manual` |
| 2 | Receipt scan | `components/modals/CaptureModal.tsx:343-382` | `camera-scan` |
| 3 | Bank-statement scan | `CaptureModal.tsx:413-499` | `file-upload` |
| 4 | Magic/voice capture | `CaptureModal.tsx` (~507) + voice commands | `manual`/`shortcut` |
| 5 | iOS Shortcut quickAdd | `functions/src/quickAdd/index.ts:773` | `shortcut` |
| 6 | Bank-alert email | `functions/src/quickAdd/emailParser.ts` → quickAdd | `shortcut` |
| 7 | Plaid daily sync | `functions/src/plaid/sync.ts` | `plaid` |
| 8 | Apple Pay $0 stub | quickAdd `needsAmount:true` (`index.ts:783`) | `shortcut` |

Existing reconciliation, all of it:
- **Client:** `utils/transactionMatch.ts` — `findMatchingPendingTransaction` (line 64) +
  `buildReceiptMergeUpdates` (line 132): merges a scanned receipt into a matching pending
  transaction (store + date window, prefers `needsAmount` stubs).
- **Server:** `functions/src/quickAdd/reconcile.ts` — `pickFillTarget`/`buildFillUpdates`:
  fills an Apple Pay $0 stub from a later bank notification (30-min window, merchant-or-
  time match, **only** considers `source:'shortcut'` rows).
- **Plaid:** dedups only against itself via deterministic doc ids `plaid_<txnId>`
  (`functions/src/plaid/sync.ts:9-10,79-80`). It never looks at rows from paths 1–6/8.

Consequence: `plaidEnabled` (off, `services/appConfig.ts:182-202`) cannot be flipped —
every purchase the email/shortcut pipeline captures in real time would arrive again 0–24h
later from Plaid as a second `pending_review` row, double-counting **pending spend** in
Safe-to-Spend (`utils/safeToSpendCalculator.ts` subtracts current-period `pending_review`
transactions) and destroying trust in the numbers.

## Design

### A. One shared fingerprint module, two copies (client + functions)

The repo intentionally duplicates pure logic between `utils/` and `functions/src/` (see
`streakLogic.ts` precedent). Create:

- `utils/transactionIdentity.ts` (client) and `functions/src/quickAdd/transactionIdentity.ts`
  (server) with identical exports + identical test suites:

```ts
// Candidate key — NOT a unique id. Used to find *possible* duplicates cheaply.
fingerprint(txn): string            // `${accountKeyOrNone}|${amountCents}|${localDate}`
merchantSimilar(a, b): boolean      // normalized-token overlap; reuse/absorb the merchant
                                    // normalization already in reconcile.ts + transactionMatch.ts
isLikelyDuplicate(a, b): Verdict    // 'duplicate' | 'possible' | 'distinct'
```

Matching policy (encode as table-driven unit tests):
- Same account (when both known) + same amount cents + date within ±3 calendar days
  (Plaid posts lag) + `merchantSimilar` → **duplicate**.
- Same amount + date window but merchant dissimilar or either account unknown → **possible**.
- `needsAmount` stubs: amount is a wildcard; match on account/card-last-4 + 30-min
  timestamp window (keep parity with `reconcile.ts` behavior).
- Never match two rows that are both user-verified, and never match across opposite signs
  or `category === INCOME_CATEGORY` vs expense.

### B. Merge policy (pure function, both copies)

`mergeTransactions(keeper, dupe)` returns the field-level winner set:
- Keeper = the row with user edits (verified status, user-set category/bucket) else the
  richer one (has merchant + account tag) else the earlier one.
- Union: keep Plaid's id linkage (`plaid_` doc id or a `plaidTransactionId` field) on the
  keeper so future Plaid syncs recognize it; preserve `payPeriodId`, `bucketId`, receipt
  linkage.
- The dupe is deleted **in the same `writeBatch`** as the keeper update (house atomicity
  rule — see CLAUDE.md "Atomicity" section; all money paths batch).

### C. Wire-in points (small, surgical)

1. **Plaid sync** (`functions/src/plaid/sync.ts`): before writing `plaid_<id>`, query the
   household's transactions for the fingerprint window (needs a composite index on
   `(date, amount)` or query by date range + filter in memory — the window is ≤7 days of
   docs, so in-memory filtering is fine and index-free). On **duplicate**: annotate the
   existing row (`plaidTransactionId`, `source` stays as-is) instead of inserting. On
   **possible**: insert but flag `possibleDuplicateOf: <id>`.
2. **quickAdd expense + email path** (`functions/src/quickAdd/index.ts`): same check
   against recent rows (it already loads recent transactions for stub-filling — extend
   that pass) so a duplicate email/shortcut capture of an already-Plaid-imported txn
   annotates instead of inserting.
3. **Client review UI:** in the transaction review flow (unified in PR #792 —
   `components/budget/` + dashboard review drawer), rows flagged
   `possibleDuplicateOf` render a compact "Possible duplicate of «X» — Merge / Keep both"
   choice; Merge calls a context method that applies `mergeTransactions` in one batch.
   Add the schema field to `types/schema.ts` `Transaction` + converter + rules allow-list
   (`firestore.rules` — transactions update keys; rules PR ships separately, human-watched).
4. **Absorb, don't wrap, the two existing reconcilers:** `reconcile.ts` and
   `transactionMatch.ts` keep their entry points but their matching internals delegate to
   `transactionIdentity` so there is exactly one notion of "same transaction" in the
   codebase. Their existing tests (`reconcile.test.ts` — 212 lines,
   `transactionMatch` tests in utils) must keep passing unmodified — that's the
   no-regression proof.

## Sequencing (3 PRs)

1. **PR-1:** identity module (both copies) + tests; refactor `reconcile.ts` /
   `transactionMatch.ts` internals onto it. Zero behavior change intended; existing tests
   are the gate.
2. **PR-2 (rules):** add `plaidTransactionId` + `possibleDuplicateOf` to the transaction
   rules allow-lists + emulator tests. Human-watched deploy.
3. **PR-3:** wire-ins (Plaid sync, quickAdd, review UI merge action) + Mock-context parity
   + `track('duplicate_merged')` (Plan 01).

## Verification & done criteria

- Table-driven tests for the policy matrix above in BOTH copies (client + functions),
  including: Plaid-then-email, email-then-Plaid, receipt-then-Plaid, $0-stub-then-Plaid,
  same-amount-different-merchant same-day (must be `possible`, not `duplicate`), recurring
  identical subscriptions two days apart (must be `distinct` — this is the known hard
  case; the date window applies to *one* candidate only, never chains).
- Emulator scenario test: seed a household, run the email capture then a fake Plaid sync
  page containing the same purchase → exactly one transaction remains, carrying
  `plaidTransactionId`, and pending-spend sums correctly.
- `pnpm lint:all && pnpm test && pnpm run build` green; Plan 07's E2E money suite green.
- Safe-to-Spend regression: `utils/safeToSpendCalculator` tests untouched and green.

## Out of scope

Turning `plaidEnabled` on (Plan 04), historical-duplicate backfill cleanup (offer as a
follow-up migration under `utils/migrations/` once the live paths are safe), matched
transfer detection between own accounts.
