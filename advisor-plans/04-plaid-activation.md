# Plan 04 — Plaid Activation: Balance Sync, Lifecycle, Runbook

**Impact:** HIGH (automatic bank sync — the feature that moves LifeBalance out of the
manual-entry class) · **Effort:** M (2–4 days code + a human-watched activation)
· **Risk:** MED (third-party API, money display) · **Confidence:** HIGH
· **Depends on:** Plan 03 (dedup) merged first. Hard gate.

## Current state (verified)

- Functions deployed, flag-gated OFF: `plaidcreatelinktoken`, `plaidexchangepublictoken`,
  `plaidsynctransactions`, `plaiddisconnectbank` (`functions/src/index.ts:33-36`);
  sandbox `PLAID_*` secrets set (comment at `:28-32`).
- Link flow: `functions/src/plaid/links.ts` — products `[Transactions]`, US only.
  Client: `components/settings/ConnectBankCard.tsx` (react-plaid-link ^4.1.1), rendered
  only when `plaidEnabled` (`services/appConfig.ts:182-202`, default false, fail-closed).
- Exchange stores tokens server-side at `households/{id}/plaidItems/{itemId}`
  (`exchange.ts:45-52`) — access tokens never reach the client. Good.
- Sync: daily cron (`sync.ts:22-23`), cursor-based `transactionsSync`, cursor persisted
  per page (`:88-92`), **added-only** — `modified`/`removed` are explicitly deferred
  (`:16-21`). Mapped rows land as `pending_review`, `source:'plaid'`, no balance effect
  (`mapping.ts:42-45`) — they debit checking only when the user verifies, matching the
  manual model.
- Tests: only the pure helpers (`mapping.test.ts` 52 lines, `categoryMap.test.ts`,
  `payPeriod.test.ts`). `sync.ts`, `exchange.ts`, `links.ts` logic paths untested.

## Gaps to close before flipping the flag

### A. Handle `modified` and `removed` (correctness)

Plaid routinely revises pending bank transactions (amount/merchant changes when a charge
posts) and removes others. Today those revisions are silently dropped.

- `modified`: update the `plaid_<id>` doc **only** for fields the user hasn't touched —
  if the row is still `pending_review` and unedited, overwrite amount/merchant/date; if
  user-verified, write the delta to a `plaidRevision` field and surface a low-key review
  chip rather than clobbering (verified rows already debited the checking balance — an
  amount change must go through the same batch-delta path `updateTransactionCategory`
  uses; see CLAUDE.md Atomicity notes).
- `removed`: delete the doc if untouched + `pending_review`; if verified, flag
  `plaidRemoved: true` for user review instead of deleting (their money already moved in
  the app's model).
- Persist per-page as the cursor already does, same transactional discipline.

### B. Balance sync (the trust feature)

The whole app runs on **manually entered** checking balances (CLAUDE.md: pending spend is
subtracted precisely *because* balances are manual). A linked account should stop being
manual:

- Add `Products.Transactions`-included balance reads: `transactionsSync` responses include
  account balances — no extra product needed; verify with the current Plaid SDK version in
  `functions/package.json` (check `accounts` on the sync response; if absent, call
  `accountsBalanceGet` in the same cron, batched per item).
- Store on the mapped account doc: `plaidBalanceCurrent`, `plaidBalanceAvailable`,
  `plaidBalanceUpdatedAt` — **do not overwrite the manual `balance` field**. The account↔
  plaidItem mapping must be explicit: extend the link flow so the user picks which
  LifeBalance account each Plaid account corresponds to (or auto-create one), persisted on
  the plaidItem doc; `mapping.ts` already routes transactions by account.
- UI (`components/budget/` account cards + Safe-to-Spend modal): when a Plaid balance
  exists and differs from the manual balance by more than a threshold, show a one-tap
  "Update to bank balance $X" affordance (writes through the normal balance-update path so
  history/alerts fire). Keep the manual model authoritative; Plaid advises. This sidesteps
  re-deriving the pending-spend model (Plan `plans/015-*` history shows that area is
  landmined — Option A "verified-only balance" shipped in #737; do not redesign it here).

### C. Webhook or tighter polling (freshness) — OPTIONAL, time-boxed

Daily polling means up to 24h staleness next to the real-time email capture. If cheap:
add `SYNC_UPDATES_AVAILABLE` webhook handling (an `onRequest` endpoint verifying Plaid's
JWT webhook signature, triggering the same sync routine for that item). If the signature
verification drags, skip — the email pipeline already covers real-time and the cron covers
completeness. Do not block activation on this.

### D. Tests

- Unit: modified/removed policy matrix (untouched vs verified rows), balance-diff
  affordance logic (pure helper), account-mapping resolution.
- Emulator: full sync cycle against recorded sandbox fixtures (Plaid sandbox JSON checked
  into `functions/src/plaid/__fixtures__/`).

## Activation runbook (human + Claude together)

1. Preconditions: Plan 03 merged + deployed; this plan's PRs merged + deployed; secrets
   switched from sandbox to production keys (`PLAID_CLIENT_ID`, `PLAID_SECRET`,
   `PLAID_ENV=production`) — human does secrets.
2. Flip `plaidEnabled` for the owner's household only if the flag becomes per-household;
   otherwise flip globally via the Developer Console (`components/modals/DeveloperConsole.tsx:32-68`)
   during a low-activity window.
3. Owner links one real account; watch `plaidsynctransactions` logs through two cron
   cycles; verify: no duplicate rows against that week's email-captured transactions
   (Plan 03's flags), balances advisory chip correct, disconnect button works
   (`plaiddisconnectbank`).
4. Rollback: flip the flag off — sync cron no-ops on the flag; nothing else to unwind.

## Done criteria

`pnpm lint:all && pnpm test` green; emulator sync-cycle test passes incl. modified/removed;
Plan 07 E2E suite green; runbook executed on the owner's household with a week of clean
coexistence between Plaid + email capture (zero unmerged duplicates); `track('bank_linked')`
and `track('plaid_balance_adopted')` events firing (Plan 01).

## Out of scope

Investments/credit-score products, multi-country, replacing the manual balance model,
Plaid-initiated payments. Historical backfill beyond Plaid's default 30-day window.
