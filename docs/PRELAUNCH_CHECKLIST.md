# Pre-Launch Checklist — opening LifeBalance to the public

The single gate that ties the legal work (Plan 011) to the access flip (Plan 013). Today the app is a
**Private Alpha**: only `beta_testers` can create a new household, and the Privacy Policy / Terms are
**DRAFTS with `[PLACEHOLDER]`s**. This checklist is everything that must be true **before** you flip
signup open to the public — in order, because the access flip (Section C) must come **last**.

> **Why the order matters:** flipping `openSignup` while the legal pages still say *"DRAFT — not yet
> legally binding"* would onboard real users under a non-binding policy. Legal first, access last.

Related turnkey procedures live in [`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md) — this checklist
**references** them rather than repeating them.

---

## Section A — Fill the legal placeholders (Plan 011) ✍️

The DRAFT Privacy Policy and Terms contain **7 unique `[PLACEHOLDER]` values** you (with legal counsel)
must supply. Find-and-replace each across both files — [`pages/PrivacyPolicy.tsx`](../pages/PrivacyPolicy.tsx)
and [`pages/TermsOfService.tsx`](../pages/TermsOfService.tsx):

| # | Placeholder | Where it appears |
|---|-------------|------------------|
| 1 | `[PLACEHOLDER: effective date]` | DRAFT banner of both pages |
| 2 | `[PLACEHOLDER: legal entity name]` | Privacy §1; Terms §1 — **must match the Stripe billing entity** ([STRIPE_SETUP_RUNBOOK](./STRIPE_SETUP_RUNBOOK.md) §0.1) |
| 3 | `[PLACEHOLDER: contact email]` | Privacy §1/§6/§9; Terms §11 |
| 4 | `[PLACEHOLDER: mailing address]` | Privacy §1/§9; Terms §11 |
| 5 | `[PLACEHOLDER: link to Google AI / Gemini terms]` | Privacy §4 (AI-data section) |
| 6 | `[PLACEHOLDER: minimum age]` | Privacy §7; Terms §3 |
| 7 | `[PLACEHOLDER: governing law / jurisdiction]` | Privacy §9; Terms §8/§11 |

- [ ] All 7 placeholders replaced in **both** files (grep `PLACEHOLDER` returns nothing in `pages/`).
- [ ] Drafts **reviewed by legal counsel** — the AI-data section (Privacy §4) and the
      financial-disclaimer (Terms §2/§8) are the highest-risk passages; have them read specifically.
- [ ] **Remove the DRAFT banner** — delete the amber `role="alert"` block ("DRAFT — pending legal
      review…") from both pages. This is a small code change → a normal PR (I can do it on your word once
      the copy is final).

## Section B — Consent versioning (Plan 011) 🔖

The signup consent gate stamps each new member with `consentAcceptedAt` + `consentVersion`
(= `CONSENT_VERSION` in [`utils/legal.ts`](../utils/legal.ts), currently `'2026-06-23'`).

- [ ] If legal review **materially changed** the copy, bump `CONSENT_VERSION` in `utils/legal.ts` to the
      new effective date, and set placeholder #1 (effective date) to match.
- [ ] Understand the current limitation (so it's a conscious choice, not a surprise):

  > ⚠️ **There is no re-consent flow for *existing* users.** `consentVersion` is **written** at
  > create-time only ([`services/householdService.ts:96,154`](../services/householdService.ts)) — no code
  > *reads* it back to compare against `CONSENT_VERSION`. So bumping the version affects only **new**
  > signups; it does **not** prompt current members to re-accept. Pre-public-launch (alpha users only)
  > this is low-stakes. **If you change the policy materially *after* you have public users, you'll need
  > a re-consent flow first** — that's an unbuilt follow-up, not part of 011.

## Section C — Open signup (Plan 013) — DO THIS LAST 🚪

Both steps are documented turnkey in **[`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md) §3** — follow it
there. In short:

- [ ] **Add the production origin** to Firebase console → Auth → Settings → **Authorized domains**
      (without this, Google Sign-In is rejected and *no* new user can sign in).
- [ ] **Flip the flag:** Firestore → `app_config/global` → **`openSignup` (boolean) = `true`**. No deploy
      needed; effective within ~60 s. Must be boolean `true` (a string `"true"` reads as OFF). Fail-closed:
      an unreadable config keeps the allowlist enforced.

## Section D — Pre-flight smoke (verify around the flip) 🔎

**Before** flipping `openSignup` (Section C):
- [ ] `/privacy` and `/terms` load for a signed-out visitor, render fully, show the **final effective
      date + version**, and have **no DRAFT banner**.
- [ ] A fresh `/setup` (create **and** join forms) shows the **required consent checkbox**; submit is
      blocked until it's checked; on success the new member doc carries `consentAcceptedAt` +
      `consentVersion`.
- [ ] An **existing** household member still loads straight into the app (no consent gate, unaffected).

**After** flipping:
- [ ] A brand-new Google account **not** in `beta_testers` can create a household (signup is actually
      open). Then re-confirm the live app boots with 0 console errors.

## Section E — Related gates (not launch-blocking, but track them) 📋

These don't block opening signup, but are worth closing around launch:
- [ ] **007** — verify the first real `deleteHousehold` on a **throwaway** household before relying on it.
- [ ] **009** — provision the `admin` custom claim and remove the hardcoded super-admin UID
      ([`DEPLOY_CHECKLIST.md`](./DEPLOY_CHECKLIST.md) §1). HIGH-risk rules change; human-watched.
- [ ] **004 CSP** — flip Content-Security-Policy from Report-Only to enforce after an authed-path verify
      (runbook in the #646 PR).
- [ ] **015** — decide the money-model fix ([`plans/015-money-model-decision.md`](../plans/015-money-model-decision.md))
      so Safe-to-Spend is correct before money-sensitive users arrive.

---

## Launch sequence (the whole thing, in order)
1. **A** — fill all 7 placeholders + legal review → land the copy + DRAFT-banner-removal PR.
2. **B** — bump `CONSENT_VERSION` if copy changed materially; set the effective date to match.
3. **D (before)** — smoke-test `/privacy`, `/terms`, and the consent gate on a fresh signup.
4. **C** — add the authorized domain, then flip `openSignup = true`.
5. **D (after)** — confirm a non-allowlisted Google user can now sign up; 0 console errors live.

> Monetization (Stripe) is a **separate, later** gate — see [`STRIPE_SETUP_RUNBOOK.md`](./STRIPE_SETUP_RUNBOOK.md).
> You can open signup (this checklist) without billing; don't charge until retention is proven (PRD §3).
