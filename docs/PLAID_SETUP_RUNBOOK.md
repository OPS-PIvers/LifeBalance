# Plaid Bank-Link Setup Runbook

The Plaid integration ships **dormant**: the code is complete and unit-tested, but
the Cloud Functions are **not exported** (so no secret-bound function deploys and CI
stays green) and the `plaidEnabled` flag is **off**. Activating it is a deliberate,
human, one-time process. Nothing is live or chargeable until you complete §1–§4.

Architecture recap:
- **Secrets** (`PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`) live in **Secret
  Manager**, set via CLI — never in Firestore, never in the client, never in an
  admin form (same pattern as `GEMINI_API_KEY` / Stripe).
- The per-item **access token** is stored at `households/{id}/plaidItems/{itemId}`,
  which `firestore.rules` **denies to all clients** — only the Cloud Functions
  (Admin SDK) read it.
- Synced transactions land as `status: 'pending_review'`, `source: 'plaid'` in the
  existing review/Action-Queue flow. They do **not** debit checking until you verify
  them (same as the iOS Shortcut path).

---

## §1 — Create a Plaid account & set the secrets

1. Sign up at <https://dashboard.plaid.com/signup> (free). Start in **Sandbox** (fake
   banks) to test, then request **Production** when ready.
2. From the dashboard, copy your **client_id** and the **secret** for the environment
   you're using.
3. Set the three secrets (you'll be prompted to paste each value; it's stored
   encrypted in Google Secret Manager, never echoed):
   ```bash
   firebase functions:secrets:set PLAID_CLIENT_ID
   firebase functions:secrets:set PLAID_SECRET
   firebase functions:secrets:set PLAID_ENV     # one of: sandbox | development | production
   ```

## §2 — Export the functions

In [`functions/src/index.ts`](../functions/src/index.ts), un-comment the three Plaid
exports:
```ts
export { plaidcreatelinktoken } from "./plaid/links";
export { plaidexchangepublictoken } from "./plaid/exchange";
export { plaidsynctransactions } from "./plaid/sync";
```

## §3 — Deploy

Merge to `main`. CI runs `firebase deploy` (functions + rules + hosting). Because the
secrets now exist, the secret-bound functions deploy successfully. (The `plaidItems`
deny rule already shipped earlier, so the token path was locked before any token could
be written.)

> Order matters: secrets (§1) **before** export (§2) **before** deploy (§3). Deploying
> a `defineSecret`-bound function whose secret doesn't exist fails the whole deploy.

> ⚠️ **`deletehousehold` is secret-bound too, and it is NOT a Plaid function.** It
> declares `secrets: PLAID_SECRETS` because deleting a household must revoke any linked
> bank at Plaid before `recursiveDelete` destroys the access tokens
> (`functions/src/plaid/revoke.ts`). So the three Plaid secrets are now a hard deploy
> dependency for **account deletion**, regardless of whether `plaidEnabled` is ever
> flipped on. A clean-room deploy without them fails on `deletehousehold` — which reads
> as a baffling error, since nothing about that function's name suggests Plaid. Set the
> secrets (§1) even if you never intend to enable bank linking.

## §4 — Flip the flag (no deploy)

Settings → **Developer Console → Feature Flags → Plaid Bank Link → ON** (or set
`app_config/global.plaidEnabled = true` in the Firestore console). Effective within
~60 s. The **Connect a bank** card then appears in **Settings**.

The Developer Console's Feature Flags tab shows a read-only status line:
`Plaid: enabled ✓ · connected accounts: N`.

---

## How it works once live
- **Connect a bank** (Settings) opens Plaid Link → `plaidexchangepublictoken` stores
  the access token server-side.
- **`plaidsynctransactions`** runs daily: pulls new transactions per item
  (cursor-based), writes each as a `pending_review` / `source: 'plaid'` transaction,
  deduped by `plaidTransactionId`. Inflows (refunds/deposits) are stored as `Income`
  so they don't lower Safe-to-Spend.
- Review them in the **Action Queue** like any other pending transaction.

## Deferred (not in the dormant cut)
- Plaid **webhook** (`SYNC_UPDATES_AVAILABLE`) for near-real-time sync — currently a
  daily scheduled job.
- **`modified` / `removed`** transaction handling — the sync currently applies
  **added** only (dedup skips anything already written, preserving user edits). When
  added, `modified`/`removed` must not clobber a user-verified transaction.
- **Account-balance sync** — would require revisiting the Safe-to-Spend formula (it
  subtracts pending spend; a bank-truth balance would double-count).
