# Plan 050–052 — Stripe monetization (per-household freemium)

> **Status:** TODO · **Tag:** `[C→H]` — Claude builds **all** the code against test/placeholder
> keys (wire-but-dormant); a **human** creates the Stripe account + business entity + bank, sets the
> live secrets, and flips the enable switch · **Risk:** MED for the code (050/052), **HIGH for the
> rules entitlement change (051)** · **Effort:** L (ship as a sequence of PRs) · **Planned against
> commit:** `a123feb`
>
> Source: PRD §3 Phase 2 (050/051/052), `plans/audit/05-monetization-direction.md` (DIR-01).
> **Do not start this until Phase 0/1 exit criteria hold** (PRD §3: don't charge before the safety
> blockers are closed and Week-4 retention is visible). Building the dormant code early is fine.

## Why / what exists today
Billing is **greenfield** — zero matches for `stripe`/`subscription`/`entitlement`/`paywall` in the
codebase, and `Household` (`types/schema.ts`) has no plan/status fields (DIR-01). The big de-risk: the
data model is **already per-household** (the `Household` doc owns members, accounts, points), which
matches the intended "bill per household, not per seat" model — so monetization is an **additive
layer, not a refactor**. Add plan fields to the household doc, a Checkout function, a webhook that is
the single source of truth for entitlement, server-enforced gates, and an upgrade UI.

## Non-negotiable principles
1. **Entitlement is server-truth, never UI-truth.** The client may *read* the plan to show/hide UI,
   but every gate that protects a paid feature is enforced in a Cloud Function and/or `firestore.rules`.
   A user editing client state must never unlock premium.
2. **The webhook is the only writer of subscription state.** The client never writes the plan/status
   fields; only the Stripe webhook (verified signature) does. Lock this down in `firestore.rules`.
3. **Gate scale & convenience, never the core loop.** Free users keep full finance tracking, habits,
   Safe-to-Spend, meal planning. Gate *volume/convenience*: AI request volume, member count beyond N,
   history depth, weekly recap, automation. (PRD 052.)
4. **Secrets never touch the client or git.** `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are
   Cloud Functions secrets (`defineSecret`, like `GEMINI_API_KEY`); the human sets their values. The
   Stripe Node SDK is a **functions-only** dependency and must never enter the client bundle.
5. **Dormant by default.** Everything ships behind an `app_config/global.billingEnabled` flag
   (mirror `services/appConfig.ts`'s `openSignup`, default **false**) so the upgrade UI stays hidden
   and gates stay in free-tier-permissive mode until the human flips it after keys are set.

## Existing infra to reuse (don't reinvent)
- **Flag pattern:** `services/appConfig.ts` `getOpenSignup()` reads `app_config/global`. Add
  `getBillingEnabled()` the same way (default false / fail-closed-to-off).
- **Secret pattern:** `functions/src/geminiProxy.ts` uses `defineSecret('GEMINI_API_KEY')` + binds it
  in the function's `secrets:[...]` option; the human sets it via `firebase functions:secrets:set`.
  Mirror for the Stripe secrets. (Functions are **pinned to a secret version at deploy time** — a new
  secret version needs a redeploy to bind; see the 014 history.)
- **Quota pattern:** the AI daily quota already lives on the household doc (`aiUsage: { dailyCount,
  lastResetDate }`) and is incremented in a `runTransaction` (`services/geminiService.ts`). Extend
  this for the AI-volume gate rather than inventing a new counter — free tier = small daily cap,
  premium = larger.
- **Function shape:** `functions/src/quickAdd/index.ts` shows the `onRequest` HTTP pattern (raw body,
  CORS, error envelopes) for the webhook; `geminiProxy.ts` shows the `onCall` pattern for the
  Checkout-session creator.
- **Rules test harness:** Plan 010 (`tests/rules/`) — extend it for the entitlement rules. **No rules
  change reaches prod without rules tests + a human watching the deploy** (PRD §2 blast-radius rule).

---

## PR sequence

### PR 050a — Subscription schema + dormant Checkout + webhook (no rules change, no gating)
1. **Schema** (`types/schema.ts`): add an additive optional block to `Household`:
   ```ts
   subscription?: {
     plan: 'free' | 'premium';
     status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
     stripeCustomerId?: string;
     stripeSubscriptionId?: string;
     currentPeriodEnd?: string;   // ISO; from Stripe current_period_end
     priceId?: string;
   };
   ```
   Treat **absent `subscription`** as `free/active` everywhere (legacy households). Add a pure helper
   `utils/entitlements.ts`: `getPlan(household)` → `'free'|'premium'` (absent → free), plus
   `isPremium(household)`, and the **limit table** (`FREE_LIMITS`/`PREMIUM_LIMITS`: maxMembers, aiDailyCap,
   historyMonths, recapEnabled, …). Unit-test it (this is the single source of truth for limits).
2. **Stripe SDK in functions only:** add `stripe` to `functions/package.json` deps. Add the two
   secrets via `defineSecret`. The client needs **no** Stripe SDK — Checkout redirects to a URL.
3. **`createcheckoutsession` (`onCall`, functions):** auth'd; verifies the caller is an admin of the
   household; creates/reuses a Stripe Customer (store `stripeCustomerId`); creates a Checkout Session
   (mode `subscription`, the configured price, `client_reference_id` = householdId, success/cancel
   URLs back into the app) and returns `session.url`. Reads the price ID from config (a secret or
   `app_config`). Bind the Stripe secret.
4. **`stripewebhook` (`onRequest`, functions):** read the **raw** body, verify the signature with
   `STRIPE_WEBHOOK_SECRET` (`stripe.webhooks.constructEvent`), and handle `checkout.session.completed`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Map each
   to a household-doc `subscription` update (resolve household via `client_reference_id` / the stored
   `stripeCustomerId`). **This function (Admin SDK) is the only writer of `subscription`.** Return 200
   fast; be idempotent (Stripe retries). Unit-test the handler with a mocked Stripe: signature reject,
   and each event → the right household patch.
5. **Staged, not deployed:** the functions are implemented + unit-tested but intentionally NOT exported
   from `functions/src/index.ts`, so they don't deploy — a non-interactive `firebase deploy` can't bind
   `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` until those secrets exist (a human step). Schema +
   entitlements ship live; the functions are wired in during activation, after the secrets are set
   (`docs/STRIPE_SETUP_RUNBOOK.md` §1.3b). **No `firestore.rules` change in this PR.**
6. Verify: `pnpm --filter functions run lint` + `build`; root `pnpm test` (webhook/entitlement unit
   tests); root `pnpm lint`/`build`. Confirm `stripe` is **not** in the client bundle
   (`grep -r "stripe" dist/assets || true` after build → nothing from the app graph).

### PR 050b — Upgrade UI + AI-volume gate (client gate is UX only; server cap is the real gate)
1. `getBillingEnabled()` in `services/appConfig.ts`. When false, hide all upgrade UI.
2. A Settings "Plan" section + a `PaywallModal` shown when a gated limit is hit; "Upgrade" calls
   `createcheckoutsession` and redirects to `session.url`. Reads `subscription` for display only.
3. **AI-volume gate (server):** extend the existing `aiUsage` daily-quota check in
   `services/geminiService.ts` so the **cap depends on the plan** (`FREE_LIMITS.aiDailyCap` vs premium).
   The authoritative cap lives where the quota is enforced (today client-side in the `runTransaction`;
   when the Gemini proxy is the only path, move the cap into the proxy so it can't be bypassed —
   coordinate with Plan 014). Show the paywall when the free cap is hit.
4. Tests for the plan-aware cap; Test-Mode manual check that free users see the upgrade prompt and
   premium (mock) users don't.

### PR 051 — Server-enforced entitlements (HIGH risk: includes a rules change → human-watched)
> Ship the **function-side** checks first (safe). Ship the **rules** change LAST, in its own PR,
> behind Plan 010 rules tests, with a human watching the deploy (a bad rules deploy is atomic and can
> lock out all data — PRD §2).
1. **Member-count gate:** enforce `maxMembers` in `joinHousehold`/`addMember` server paths AND in the
   `members/{memberId}` **create** rule: allow the create only if the household is premium OR the
   resulting member count is within `FREE_LIMITS.maxMembers`. (Rules can `get()` the household doc;
   mind the get-count budget.) Add rules tests: free household at the limit → member create denied;
   premium → allowed.
2. **Lock `subscription` writes to the backend:** in the household-doc update rule, **deny** any client
   write that adds/changes `subscription` (only the Admin-SDK webhook may set it). Add a rules test.
3. Each entitlement check has a rules test in `tests/rules/` before merge.

### PR 052 — Freemium gating on the remaining scale/convenience features
Gate (server-enforced) the *convenience* tier only — e.g. weekly recap (Plan 060), extended history
depth, automation — per the `PREMIUM_LIMITS` table. **Never** gate finance tracking, habits, or
Safe-to-Spend. Each gate: server check + paywall UX + test.

---

## Human checklist (the irreducible `[H]` steps — turnkey)
1. Create the **Stripe account**, business entity, and bank connection (money + legal).
2. In the Stripe dashboard, create the **Product + recurring Price**; note the **price ID** and put it
   in config (`app_config/global.stripePriceId` or a secret).
3. Set the secrets: `firebase functions:secrets:set STRIPE_SECRET_KEY` and
   `firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` (Claude never sees the values), then redeploy
   functions so they bind (secrets pin at deploy time).
4. In Stripe → Developers → Webhooks, add an endpoint pointing at the deployed `stripewebhook` URL,
   subscribe the four events above, and copy the signing secret into step 3's webhook secret.
5. Flip `app_config/global.billingEnabled = true` (Firestore console) to reveal the upgrade UI.
6. Test the full flow with a Stripe **test card** before going live; then switch to live keys.

## Out of scope / STOP conditions
- Do **not** auto-merge the 051 rules change without a human watching the deploy.
- Do **not** put the Stripe secret key or SDK in the client.
- If the Stripe API shape is uncertain at build time, consult current Stripe docs (Context7 /
  `query-docs`) rather than guessing — the API version matters for the webhook event shapes.
- Proration/plan-switching/tax (Stripe Tax) and dunning emails are follow-ups, not this plan.

## Test plan
- `utils/entitlements.test.ts`: plan resolution (absent → free), limit table, `isPremium`.
- Webhook handler unit tests (mocked Stripe): signature reject; each event → correct household patch;
  idempotency.
- `createcheckoutsession` unit test: admin-only; customer reuse; returns a URL.
- Rules tests (Plan 010 harness): member-count gate (free-at-limit denied / premium allowed);
  client `subscription` write denied.
- Plan-aware AI cap test.

## Maintenance notes
- Bump the Stripe API version deliberately; re-check webhook event shapes when you do.
- Every new premium feature adds its limit to `utils/entitlements.ts` (one source of truth) and a
  server-side gate — never a UI-only check.
- Keep the webhook idempotent; Stripe redelivers.
