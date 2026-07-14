# API-Key "Reveal & Copy" Runbook

By default, iOS-Shortcut API keys are stored **only** as a one-way SHA-256 hash
(plus a display prefix). That's why a key can be copied exactly once — at
creation — and never again; the plaintext is not recoverable. The one-tap
**Regenerate** button is the always-available recovery path (it mints a fresh
secret in place, keeping the key's name and permissions).

This runbook activates the optional **reveal & copy** flow: newly created and
regenerated keys are *additionally* stored **encrypted at rest** (AES-256-GCM,
under a server-only secret), so a household admin can fetch and copy the same
key again later via a masked "reveal" button — the way many API dashboards work.

Like the Stripe integration, the server pieces ship **implemented but dormant**:
`functions/src/apiKeys/reveal.ts` is not exported from `functions/src/index.ts`,
and the client flag `VITE_APIKEY_REVEAL_ENABLED` defaults OFF. Nothing changes
until you complete the steps below.

## Security trade-off (read before enabling)

- With reveal OFF (default), keys are hash-only — the strongest posture, same as
  GitHub PATs / Stripe / AWS secret keys.
- With reveal ON, keys become **recoverable**: any household **admin** can fetch
  the plaintext, and the AES ciphertext lives in Firestore (decryptable only by a
  Cloud Function holding `APIKEY_ENC_KEY`). These keys are limited (they only
  *add* habits/expenses/shopping and are rate-limited), so this is a reasonable
  trade — but it is a real reduction from hash-only. Enable it deliberately.

## Activation steps

### 1. Provision the encryption secret

Generate a strong 32-byte key and store it as a Cloud Functions secret. A
64-hex-character value is used as the raw AES key; any other string is hashed to
32 bytes (`deriveKey` in `functions/src/apiKeys/crypto.ts`).

```bash
# Generate a 64-hex-char (32-byte) key:
openssl rand -hex 32

# Store it (paste the value when prompted):
firebase functions:secrets:set APIKEY_ENC_KEY
```

> Keep this secret safe and do **not** rotate it casually: rotating it makes
> every already-encrypted key un-revealable (they'd need to be regenerated).

### 2. Export the reveal functions

In `functions/src/index.ts`, add the export next to the dormant-comment block:

```ts
export { attachapikeyencryption, revealapikey } from "./apiKeys/reveal";
```

### 3. Turn the client flag on

In `.github/workflows/deploy.yml`, add to the build env (next to
`VITE_USE_GEMINI_PROXY`):

```yaml
VITE_APIKEY_REVEAL_ENABLED: "true"
```

For local testing, set `VITE_APIKEY_REVEAL_ENABLED=true` in `.env.local`.

### 4. Deploy

```bash
# Functions (binds the APIKEY_ENC_KEY secret) + hosting (ships the flag):
firebase deploy --only functions:attachapikeyencryption,functions:revealapikey
# then a normal hosting deploy / merge to main
```

## Behavior after activation

- **Existing keys** were created hash-only, so they have no encrypted copy yet.
  They show no reveal button; tap **Regenerate** once to mint an encrypted
  secret you can thereafter reveal & copy.
- **New / regenerated keys** get an encrypted copy attached automatically
  (best-effort — if the attach call fails, the key still works, it just isn't
  revealable). The masked key row gains an 👁 **Reveal & copy** button.
- `revealapikey` and `attachapikeyencryption` are **admin-only** (household
  member `role === "admin"`), matching the admin-only apiKeys Firestore rules.

## Rollback

Set `VITE_APIKEY_REVEAL_ENABLED` back to `false` (or remove it) and redeploy the
client to hide the reveal UI. The functions and stored ciphertext can stay; to
fully remove, delete the exports and, optionally, the `APIKEY_ENC_KEY` secret
(`firebase functions:secrets:destroy APIKEY_ENC_KEY`) and any `encryptedKey`
fields.
