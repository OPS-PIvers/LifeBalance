# Deploy / Ops Checklist — Gated Security Action Items

This file tracks security action items that **cannot be completed from application
code alone** because they require Admin-SDK / Google Cloud Console / ops access.
Each item is gated: do the out-of-band step first, then make (and deploy) the
code/rules change. Until the gate is satisfied, the current state is intentional.

Security model: [`SECURITY_MODEL.md`](../SECURITY_MODEL.md). Consolidated backlog: [`TODO.md`](../TODO.md).

---

## 1. Remove the hardcoded super-admin UID fallback (audit §3.1) 🔴

**Where:** [`firestore.rules`](../firestore.rules) → `isSuperAdmin()`

```
function isSuperAdmin() {
  return isAuthenticated() &&
         (request.auth.token.get('admin', false) == true ||      // ✅ preferred
          request.auth.uid == "nmYdn3QPsNQEvniJEXW9M3lmV5e2");    // ⚠️ backdoor to remove
}
```

**Why it is still here:** `isSuperAdmin()` already honors the `admin` custom
claim (`request.auth.token.get('admin', false) == true`), so the claim path is
*wired in the rules*. However, **no code in this repo provisions that claim**
(a repo-wide search for `setCustomUserClaims` returns nothing). The claim must be
set on the super-admin's auth user via the Admin SDK before the UID branch can be
safely deleted — otherwise the admin is immediately locked out of:

- household `list` (the AI Meter) — `firestore.rules` households `allow list`
- `app_config/global` kill-switch write
- `beta_testers` read/write
- `feedback` read/delete
- `logs/ai_usage` read

**Gated removal procedure (do in order):**

1. **Provision the claim.** Using a trusted environment with the Firebase Admin
   SDK and service-account credentials (e.g. a one-off Cloud Function, a local
   admin script, or Cloud Shell), set the claim on the super-admin user:

   ```js
   // run with Admin SDK credentials — NOT in client code
   const admin = require('firebase-admin');
   admin.initializeApp();
   await admin.auth().setCustomUserClaims(
     'nmYdn3QPsNQEvniJEXW9M3lmV5e2', // super-admin UID
     { admin: true }
   );
   ```

2. **Force a token refresh.** Custom claims only appear after the user gets a
   fresh ID token. Have the super-admin sign out and back in, or call
   `getIdToken(true)` client-side. Confirm `request.auth.token.admin === true`
   is observed (e.g. via the Rules Playground or by exercising an admin-only
   read).

3. **Verify admin access still works WITH the claim and WITHOUT the UID branch.**
   Use the Firebase console Rules Playground (or the emulator if a rules-unit-test
   harness is later added) to confirm each admin-only path above passes for a token
   carrying `admin: true`.

4. **Delete the UID branch** and the now-stale `TODO` comment above
   `isSuperAdmin()`, leaving:

   ```
   function isSuperAdmin() {
     return isAuthenticated() && request.auth.token.get('admin', false) == true;
   }
   ```

5. **Deploy rules:** `pnpm deploy:rules` (`firebase deploy --only firestore:rules`).

6. **Smoke-test in production** that the super-admin can still load the AI Meter,
   toggle the kill switch, and read feedback. If anything fails, re-add the UID
   branch and redeploy while you debug the claim.

> ⚠️ Do **not** delete the UID branch in the same change that "should" set the
> claim — provisioning is a separate, verified step. Deleting first risks a
> hard admin lockout that itself requires Admin-SDK access to recover from.

---

## 2. Lock down the client-embedded Gemini API key (audit §3.2) 🟡

**Where:** [`services/geminiService.ts`](../services/geminiService.ts) reads
`VITE_GEMINI_API_KEY`. Any `VITE_*` variable is **inlined into the shipped JS**
by Vite at build time, so the key is visible to anyone via DevTools / the bundle.
This is a documentation-only item here; the mitigations are configuration/ops.

### Short-term mitigation (Google Cloud Console — do now)

Lock the key down so a leaked key has minimal blast radius:

1. **Restrict by API.** In Google Cloud Console → **APIs & Services →
   Credentials**, edit the API key and under *API restrictions* restrict it to
   **only the Generative Language API** (the Gemini API). This prevents the key
   from being reused against other GCP APIs on the project.
2. **Restrict by HTTP referrer.** Under *Application restrictions* → *Websites*,
   add an allow-list of the app's production origin(s) (and any preview/staging
   origins), e.g. `https://<your-app-domain>/*`. Browser requests from other
   origins are then rejected. (Note: referrer restrictions are a deterrent, not
   a hard guarantee — referrers can be spoofed by non-browser clients — which is
   why the long-term proxy below is the real fix.)
3. **Set quota caps.** Under **APIs & Services → Generative Language API →
   Quotas**, set per-minute / per-day request caps so a leaked key cannot run up
   an unbounded bill. Pair with a billing budget + alert on the project.
4. **Keep CI clean.** CI already uses a mock key, so CI logs/builds do not expose
   the real key. Ensure the real key lives only in the production build secret,
   never committed.

### Long-term fix (code — separate work item, not done here)

Proxy all Gemini calls through a **Cloud Function** (the project already has a
`functions/` workspace). The browser calls the authenticated Cloud Function; the
function holds `GEMINI_API_KEY` as a server-side secret (Secret Manager / function
config) and forwards to Gemini. The key then **never leaves the server** and the
existing per-household quota check can be enforced server-side too. This removes
the `VITE_GEMINI_API_KEY` from the client bundle entirely.

---

## 3. Open signup beyond the Private Alpha allowlist (feature flag) 🟢

**Where:** `app_config/global.openSignup` (read by [`services/appConfig.ts`](../services/appConfig.ts)
`getOpenSignup()`, enforced in [`contexts/AuthContext.tsx`](../contexts/AuthContext.tsx)).

By default the flag is **absent → OFF**: brand-new users (no existing household)
must be an `active` doc in the `beta_testers` collection. To open signup to **any
Google user**:

1. **Add the production origin to authorized domains.** Firebase console → **Auth
   → Settings → Authorized domains** → add your prod origin (e.g.
   `app.example.com`). Google Sign-In is rejected from unlisted origins, so skip
   this and new users can't sign in at all.
2. **Flip the flag.** Firestore console → `app_config` → `global` doc → set field
   **`openSignup` (boolean) = `true`**. No deploy needed; takes effect within
   ~60 s (the reader caches for 60 s). Must be the boolean `true` — a string
   `"true"` is treated as OFF.
3. **To re-close** signup, set `openSignup = false` (or delete the field). The
   `beta_testers` allowlist is enforced again on the next read.

> Fail-safe: if the config doc is unreadable, `getOpenSignup()` returns `false`,
> so a Firestore outage keeps the allowlist enforced rather than throwing signup
> open. Existing household members are never gated regardless of this flag.

---

## 4. Monetization — Stripe account, secrets & webhook (Plan 050–052) 🟢

Stripe billing has its own turnkey runbook: **[`STRIPE_SETUP_RUNBOOK.md`](./STRIPE_SETUP_RUNBOOK.md)**.
Phase 0 (create the account + business entity + bank + product/price) has **no code dependency and real
verification lead time — start it whenever you decide to monetize**. Phase 1 (set
`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, wire the webhook, flip `billingEnabled`) comes **after** the
billing functions are deployed, and runs in Stripe **test mode** first.

## 5. Public launch gate — legal review + open signup (Plans 011 + 013) 🟢

Opening signup to the public is gated on the legal pages being finalized first. The ordered procedure —
fill the 7 `[PLACEHOLDER]`s, legal review, remove the DRAFT banner, then the §3 `openSignup` flip — is in
**[`PRELAUNCH_CHECKLIST.md`](./PRELAUNCH_CHECKLIST.md)**. (§3 above is the access-flip step; the checklist
sequences it behind the legal work.)

## Notes

- Firestore rules latent-bug fix for `CalendarItem.bucketId` (audit §3.3) is a
  pure code change and was applied directly in [`firestore.rules`](../firestore.rules);
  it is **not** gated and needs no ops step beyond a normal `pnpm deploy:rules`.
