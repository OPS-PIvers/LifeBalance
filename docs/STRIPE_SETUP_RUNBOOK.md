# Stripe Setup Runbook — turnkey `[H]` steps for monetization (Plan 050–052)

The **code** for billing is the `[C]` half (see [`plans/050-stripe-monetization.md`](../plans/050-stripe-monetization.md));
**this** runbook is the irreducible human half — the Stripe account, money/legal entity, secrets, and
webhook wiring that Claude can never do. It expands the plan's 6-line checklist into click-by-click
steps with a verification at each gate.

> **Two phases, on purpose:**
> - **Phase 0** (account · entity · bank · product) has **no code dependency** and **real lead time**
>   (Stripe identity + bank verification can take days). **You can — and should — start it today**,
>   before the billing code is built. This is the part that actually unblocks the timeline.
> - **Phase 1** (secrets · webhook · flip · test) requires the billing functions
>   (`createcheckoutsession`, `stripewebhook`) to be **deployed first** — i.e. after the 050a/050b/051
>   PRs land. Do Phase 1 in **test mode** end-to-end before touching live keys.
>
> **Do not flip `billingEnabled` on in production until Phase 1 is fully verified in test mode.**
> Per the PRD, also don't *charge real users* until Phase 0/1 product exit-criteria hold (safety
> blockers closed + retention visible). Building/wiring dormant is fine.

---

## Phase 0 — Start today (no code dependency) 🟢

### 0.1 Create the Stripe account + business entity + bank
1. Sign up at <https://dashboard.stripe.com/register>.
2. Complete **business profile / identity verification**: legal entity, EIN/tax ID, address, and a
   **bank account** for payouts. This is the slow part (verification lag) — start it first.
3. Decide the **legal entity** that bills customers — it must match the
   `[PLACEHOLDER: legal entity name]` you put in the Privacy Policy / Terms (see
   [`PRELAUNCH_CHECKLIST.md`](./PRELAUNCH_CHECKLIST.md)). Keep them consistent.

> 💡 You stay in **Test mode** (toggle, top-right of the dashboard) for everything below until step 1.6.
> Test mode has its own keys, products, and webhook secrets — nothing here charges anyone.

### 0.2 Create the Product + recurring Price
1. Dashboard → **Product catalog → + Add product**.
2. Name it (e.g. "LifeBalance Premium"), set a **recurring** price (monthly and/or yearly), currency,
   and amount.
3. After saving, open the price and **copy its Price ID** — it looks like `price_1AbC...`. You'll set
   this in step 1.4. (Create the price in **test mode** now; you'll re-create it in live mode at 1.6.)

That's everything Phase 0. The remaining steps need the deployed functions.

---

## Phase 1 — After the billing code is deployed (test mode first) 🟡

> **Where the code stands:** the functions (`createcheckoutsession`, `stripewebhook`) are implemented and
> unit-tested in `functions/src/stripe/` but **staged, not deployed** — they are intentionally not exported
> from [`functions/src/index.ts`](../functions/src/index.ts), because deploying a secret-bound function
> needs its secrets to already exist (a non-interactive `firebase deploy` fails otherwise). So the order is
> **set the secrets (1.3) → export + deploy the functions (1.3b) → configure (1.4+)**.

### 1.3 Set the Stripe secrets (Cloud Functions)
These mirror the `GEMINI_API_KEY` pattern (`defineSecret`); Claude never sees the values. From the repo
root, with the Firebase CLI authenticated to the project:

```bash
# Use your Stripe **test** secret key first (sk_test_...). Swap to sk_live_... at go-live (1.6).
firebase functions:secrets:set STRIPE_SECRET_KEY
# (paste the key when prompted)

# Set a TEMPORARY placeholder now (e.g. whsec_placeholder); replace it with the real
# signing secret once the webhook endpoint exists (step 1.5), then redeploy.
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

> ⚠️ **Secrets pin at deploy time.** After setting (or rotating) a secret you must **redeploy the
> functions** (`firebase deploy --only functions`) for the new version to bind. (Same gotcha as the 014
> Gemini proxy — see that history if a function reads a stale secret.)

### 1.3b Wire in + deploy the functions
Now that both secrets exist, export the staged functions in
[`functions/src/index.ts`](../functions/src/index.ts) (the two lines noted in that file):

```ts
export { createcheckoutsession } from "./stripe/checkout";
export { stripewebhook } from "./stripe/webhook";
```

Deploy: `firebase deploy --only functions`. The bound deploy now succeeds because the secrets exist.
Confirm with `firebase functions:list` — you should see **`createcheckoutsession`** and
**`stripewebhook`** (copy the latter's URL for step 1.5).

### 1.4 Point the app at your Price ID
Firestore console → `app_config` → `global` doc → set field **`stripePriceId` (string)** to the Price ID
from step 0.2. (The Checkout function reads it from config so the price can change without a code deploy.)

### 1.5 Create the webhook endpoint in Stripe
1. Get the deployed webhook URL: `firebase functions:list` (or Firebase console → Functions) → copy the
   trigger URL for **`stripewebhook`** (a `https://...cloudfunctions.net/stripewebhook` or
   `https://<region>-<project>.cloudfunctions.net/...` style URL).
2. Stripe dashboard (still **Test mode**) → **Developers → Webhooks → + Add endpoint**.
3. Paste the URL. Under **Select events**, subscribe **exactly these four**:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Save, then **reveal the Signing secret** (`whsec_...`) and feed it into the
   `STRIPE_WEBHOOK_SECRET` from step 1.3 — then **redeploy functions** so it binds.

### 1.6 Test the full flow with a test card
1. Flip the in-app reveal: Firestore → `app_config/global` → **`billingEnabled` (boolean) = `true`**
   (mirrors `openSignup`; default off / fail-closed-to-free). The upgrade UI now appears.
2. As a test household admin, start an upgrade → you're redirected to Stripe Checkout.
3. Pay with the Stripe test card **`4242 4242 4242 4242`**, any future expiry, any CVC/ZIP.
4. **Verify the webhook landed:** Stripe → Developers → Webhooks → your endpoint shows a **200** for
   `checkout.session.completed`; Firestore → the household doc now has
   `subscription: { plan: 'premium', status: 'active', ... }`. The premium gates should unlock for that
   household.
5. Test the unhappy paths too: cancel a subscription (→ `customer.subscription.deleted` → household back
   to free) and a failed renewal (→ `invoice.payment_failed` → `status: 'past_due'`).

### 1.7 Go live
Only after 1.6 passes in test mode:
1. Re-create the **Product + Price in live mode** (test-mode objects don't carry over); copy the **live**
   Price ID into `app_config/global.stripePriceId` (1.4).
2. `firebase functions:secrets:set STRIPE_SECRET_KEY` with the **live** key (`sk_live_...`); **redeploy**.
3. Create a **live-mode** webhook endpoint (1.5) → new live signing secret → `STRIPE_WEBHOOK_SECRET` →
   **redeploy**.
4. Sanity-check with a real card on your own account, then refund it.

---

## Rollback / kill switch
- **Hide all billing UI instantly:** set `app_config/global.billingEnabled = false`. Entitlement checks
  fail to **free-tier-permissive**, so no user is locked out of anything they had — the upgrade prompts
  simply disappear. (Server gates added in 051 remain, but with billing off they evaluate to free
  limits, which is the safe default.)
- **Webhook misbehaving:** disable the endpoint in Stripe → Developers → Webhooks; the household
  `subscription` state just stops updating until you re-enable. The webhook is the *only* writer, so no
  client can corrupt entitlement in the meantime.

## Cross-references
- Code plan + PR sequence + non-negotiable principles: [`plans/050-stripe-monetization.md`](../plans/050-stripe-monetization.md).
- Flag pattern this reuses: [`services/appConfig.ts`](../services/appConfig.ts) (`getOpenSignup` → add `getBillingEnabled`).
- Secret pattern this reuses: the `GEMINI_API_KEY` setup in [`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md) §2 and the 014 history.
- **Sequencing:** don't begin Phase 1 charging before the launch gate in [`PRELAUNCH_CHECKLIST.md`](./PRELAUNCH_CHECKLIST.md) is satisfied.
