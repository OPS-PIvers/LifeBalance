# Plan 21: CSV transaction import (switcher on-ramp)

> **Executor instructions**: Follow step by step; run every verification command;
> honor STOP conditions. Step 1 is a mandatory investigation whose findings you
> append to this file before writing code. When done, update this plan's status
> row in `advisor-plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- utils/transactionIdentity.ts components/modals/CaptureModal.tsx pages/Settings.tsx`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P2 (Phase 6; do shortly before opening signup)
- **Effort**: M
- **Risk**: MED — bulk writes into the money model; mitigated by reusing the statement-scan commit path verbatim
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

Switchers from Mint (dead), YNAB, or a bank's "download transactions" button arrive holding a CSV — and this app's only file path OCRs an *image* of a statement (`CaptureModal` reads uploads as `readAsDataURL` → Gemini). Export exists with no import twin. A structured CSV importer is more accurate and cheaper (no AI call) than screenshot OCR, and the dedup layer to make bulk import safe (`utils/transactionIdentity.ts`) already exists. This is the single biggest onboarding-wall removal before public signup.

**Scoping decisions (made):** CSV only — no OFX/QFX in v1. No new dependencies — a hand-rolled RFC-4180-lite parser in `utils/` (quoted fields, escaped quotes, CRLF); this repo avoids dependency creep and the format subset needed is small. Imported rows enter as `status: 'pending_review'`, `source: 'file-upload'` — under the verified-only balance model (shipped 2026-06), pending transactions do NOT touch account balances, which makes bulk import safe by construction.

## Current state (verified 2026-07-09)

- `utils/transactionIdentity.ts` — `merchantSimilar` (`:85`), `fingerprint` (`:110`), `isLikelyDuplicate(a, b): 'duplicate'|'possible'|'distinct'` (`:145`), windows `DUPLICATE_WINDOW_DAYS = 3` / `AUTO_DUPLICATE_WINDOW_DAYS = 1`. This is the dedup vocabulary the whole app uses — imported rows must be checked against existing transactions with it.
- The statement-scan flow (`CaptureModal` → `parseBankStatement` results → review list → commit) already solves "user confirms N parsed rows, then they're written" — **its commit path is the pattern to reuse** (Step 1 locates it exactly).
- Money conventions: amounts are decimal dollars in Firestore; math in integer cents via `utils/money.ts`; dates are local `yyyy-MM-dd`.
- UI home: Settings → "Data Management" section (`pages/Settings.tsx`, near the export buttons at ~`:321`) gets the "Import transactions (CSV)" entry opening a Drawer.
- Strict TS: `noUncheckedIndexedAccess` — CSV cell access must be guarded.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Lint | `pnpm lint` | exit 0 |
| Focused | `pnpm test -- csvImport` | pass |
| Full | `pnpm test && pnpm run build` | exit 0 |

## Scope

**In scope**: new `utils/csvImport.ts` (+ test), new `components/settings/CsvImportDrawer.tsx` (+ test), `pages/Settings.tsx` (one entry row + lazy mount), this file (Step-1 findings), `advisor-plans/README.md`.

**Out of scope**:
- OFX/QFX, Plaid, or any bank-format auto-recognition beyond header-name matching.
- New context mutations — reuse whatever the statement-scan commit path uses (Step 1).
- `firestore.rules`, converters, schema changes.
- Auto-categorization of imported rows (they land pending-review; the existing review flow categorizes).

## Steps

### Step 1: Investigation (append findings to this file under "## Investigation notes" before coding)

1. Locate the statement-scan commit path: in `components/modals/CaptureModal.tsx` (or a child), find what happens after `parseBankStatement` returns N rows and the user confirms — which context mutation(s) commit them (single `addTransaction` per row? a batch mutation?). Record file:line + the exact call signature.
2. Confirm how that path sets `payPeriodId`/`status`/`source` and whether it already runs `transactionIdentity` dedup (the Plan-03 work wired dedup into ingestion paths — find where, so imports get the same treatment, not a parallel one).
3. Confirm the transactions the client holds for dedup comparison (the `useFinance().transactions` window) and record its size.

**Verify**: "Investigation notes" section exists here with all three answers + file:line evidence.

## Investigation notes (2026-07-09, executor)

**Drift check result**: `git diff --stat fce26e4..HEAD -- utils/transactionIdentity.ts components/modals/CaptureModal.tsx pages/Settings.tsx` shows changes to `CaptureModal.tsx` and `pages/Settings.tsx` only. Inspected the diffs: both are the Plan-16 sub-bucket removal (`subBucketId`/`matchSubBucket`/`subBucketsMap` deleted, `buckets` prop dropped from a couple of child components) plus a `pages/Settings.tsx` reflow unrelated to the Data Management section. `utils/transactionIdentity.ts` is untouched. None of this affects the CSV-import plan's assumptions — proceeding.

1. **Commit path**: `submitParsedTransactions` in `components/modals/CaptureModal.tsx:448-488`. After the user reviews/selects parsed rows, it resolves store names via `ensureStores`, then for each selected row calls the finance-slice mutation `addTransaction(newTransaction: Transaction)` (`components/modals/CaptureModal.tsx:481`, imported from `useFinance()` at `:65`) inside `Promise.allSettled(selectedTx.map(tx => ... return addTransaction(newTransaction); }))` — i.e. **one `addTransaction` call per row, fired concurrently via `Promise.allSettled`, no shared write-batch across rows**. `addTransaction`'s implementation (`contexts/household/mutations/transactionMutations.ts:51-169`, factory `makeAddTransaction`) commits a single `writeBatch` per call containing the transaction doc + (only when `verified`) the target-account balance delta — this is the "commit path to reuse verbatim."
2. **`payPeriodId`/`status`/`source`/dedup**: `addTransaction` itself computes `payPeriodId` via `getPayPeriodForTransaction(tx.date, householdSettings?.lastPaycheckDate)` (`transactionMutations.ts:100,112`) and **ignores/overwrites** any `payPeriodId` the caller might pass (the mutation's parameter type is `Omit<Transaction, 'id'|'createdAt'|'payPeriodId'|'createdBy'>` — callers can't set it at all). `status` is caller-supplied and validated to be `'verified'|'pending_review'` (`:81-84`); `submitParsedTransactions` always passes `status: 'pending_review'` (`CaptureModal.tsx:472`) — a `pending_review` create takes the `balanceDelta` early-out at `transactionMutations.ts:159` (`if (balanceDelta !== 0 && target)`), i.e. **no account balance is touched**, consistent with CLAUDE.md's verified-only model. `source` is caller-supplied; `submitParsedTransactions` passes `'file-upload'` (`:474`) — the CSV importer should reuse this same literal so it's indistinguishable from a statement-scan import in the data. **Dedup**: `submitParsedTransactions` runs **no** `transactionIdentity`/`isLikelyDuplicate` check at all — the only dedup logic in `CaptureModal.tsx` is `findMatchingPendingTransaction` (`utils/transactionMatch.ts`, imported `:18`, called only at `:352` inside the single-receipt `capturePhoto` flow), which is a *different*, store-name+date-window matcher used to MERGE a scanned receipt into an existing Apple-Pay `$0` stub — it does not use `isLikelyDuplicate`/`fingerprint` and is not wired into the multi-row bank-statement commit path at all. The actual Plan-03 `isLikelyDuplicate` wiring lives in `functions/src/plaid/dedup.ts` (Plaid sync) and `functions/src/quickAdd/transactionIdentity.ts` (quickAdd), both server-side Cloud Functions paths — there is no existing *client-side, multi-row* ingestion path that already runs `isLikelyDuplicate`. Conclusion: the CSV importer's Step-3 dedup pass (using `isLikelyDuplicate` directly against `useFinance().transactions`) is net-new UI-level dedup, not a duplicate of an existing client wiring — this satisfies "don't invent a parallel mechanism" because there is no existing client mechanism to parallel; it reuses the shared vocabulary (`isLikelyDuplicate`) rather than inventing new duplicate-detection logic.
3. **Transactions window size**: `useFinance().transactions` is the live-windowed listener bounded by `TRANSACTION_WINDOW_DAYS = 90` (at least; extended back to cover the current pay period start — see `utils/listenerWindows.ts:17,59-68`) with a `TRANSACTION_PAGE_SIZE = 100` "load older" page size for anything beyond that. 90 days of transaction history is a reasonable dedup comparison window for a CSV import (most bank/CSV exports cover a similar or shorter recent range) — not too small; no STOP triggered.

**No STOP conditions hit.** Proceeding to Step 2.

### Step 2: Pure parser + mapper — `utils/csvImport.ts`

- `parseCsv(text): string[][]` — RFC-4180-lite: quoted fields, `""` escapes, CR/LF/CRLF, skips blank lines. No dependency.
- `detectColumns(header: string[]): {date?: number; amount?: number; description?: number; debit?: number; credit?: number}` — case-insensitive header matching for common names (`date`, `posted`, `transaction date`; `amount`; `debit`/`credit` split columns; `description`/`payee`/`merchant`/`memo`).
- `mapRows(rows, mapping): {ok: DraftImportRow[]; errors: {line: number; reason: string}[]}` — parses dates (`MM/DD/YYYY`, `YYYY-MM-DD`, `M/D/YY` → local `yyyy-MM-dd`), amounts (`$`, commas, parentheses-negative, debit/credit split → signed decimal), trims descriptions. Reject rows with unparseable date/amount into `errors`, never silently.

Tests (≥12): quoted commas, escaped quotes, CRLF, header detection variants, both amount conventions, parentheses negatives, debit/credit split, bad-row error collection, empty file.

**Verify**: `pnpm test -- csvImport` → all pass.

### Step 3: `CsvImportDrawer`

Drawer flow: file input (`.csv`, read as text) → auto-detected column mapping shown as three `Select`s (Date/Amount/Description; plus Debit/Credit mode toggle) → preview table of the first ~10 mapped rows + total count + error count → dedup pass: each row vs existing transactions via `isLikelyDuplicate` (mark `duplicate` rows skip-by-default with an override checkbox; `possible` rows flagged in preview) → Import button commits via the Step-1 commit path in chunks (respect any batch-size limit found; ≤400 writes per batch is the repo's precedent) → success toast with counts (imported/skipped/errors). Lazy-mount from Settings like other Drawer modals (LazyMount pattern if Settings uses it; check).

**Verify**: `pnpm lint && pnpm test` → exit 0; component test covers mapping-change re-preview and dedup-skip counts.

### Step 4: Full gates + Test-Mode walkthrough

Import a small fixture CSV in Test Mode; confirm rows appear as pending-review; confirm re-importing the same file skips all rows as duplicates. Dark + mobile check (repo rule for UI PRs).

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0; walkthrough recorded in PR description.

## Done criteria

- [ ] `utils/csvImport.ts` + ≥12 tests; drawer wired from Settings
- [ ] Re-import of the same file is a no-op (dedup proof, in the walkthrough)
- [ ] Imported rows are `pending_review` and do NOT change any account balance (assert in walkthrough)
- [ ] All gates green; Investigation notes appended; `advisor-plans/README.md` row updated

## STOP conditions

- Step 1 finds no reusable multi-row commit path (statement scan commits one-by-one through UI interaction only) — report; inventing a new bulk mutation is a scope expansion needing approval.
- The transactions window (Step 1.3) is too small for meaningful dedup against history — report with the number; importing without dedup is not acceptable.
- Any pressure to write rows as `verified` (balance-affecting) — refuse; pending-review is a load-bearing safety property of this plan.

## Maintenance notes

- OFX/QFX support later = a second parser feeding the same `DraftImportRow` + drawer.
- The header-name dictionary in `detectColumns` is the compatibility surface — extend it as real bank CSVs surface; keep it data, not code branches.
