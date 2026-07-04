# Plan 09 — Dormant-Feature Activation Runbook (Kid Mode, Stripe, open items)

**Impact:** MED–HIGH (ships months of finished work) · **Effort:** S in code, mostly
human go/no-go decisions · **Risk:** LOW per step (every feature is fail-closed behind a
flag) · **Confidence:** HIGH on current state; the *decisions* are the owner's.

## Why this plan exists

LifeBalance's most valuable unshipped features are **already built, tested, and merged**,
sitting behind fail-closed flags on `app_config/global` (read via `services/appConfig.ts`;
togglable live from the Developer Console, `components/modals/DeveloperConsole.tsx:32-68`).
The remaining work is sequencing, walkthroughs, and flips — most of it human. This runbook
makes the state legible and each activation a checklist, not a project.

## Current flag state (verified 2026-07-04)

| Flag | Default | What's behind it | Blocker to flipping |
|------|---------|------------------|---------------------|
| `kidModeEnabled` | OFF (fail-closed) | Complete Kid Mode: managed kid profiles (`isManaged` members, `buildKidMemberDoc` — `contexts/FirebaseHouseholdContext.tsx:3883`), profile switcher (`components/layout/ProfileMenu.tsx:34-49,145-178`), kid dashboard shell swap (`MainLayout.tsx:56-99`), exit PIN (`utils/kidPin.ts`, Settings `:812-829`), chore assignment, rewards + parent approval + allowance IOU | **None in code.** Needs a Test-Mode + prod walkthrough |
| `plaidEnabled` | OFF (fail-closed) | Link/exchange/sync/disconnect functions + ConnectBankCard | Plan 03 (dedup) + Plan 04 (lifecycle/balance) |
| `billingEnabled` | OFF (fail-closed) | PaywallModal, plan-aware AI caps, kid-profile cap, entitlements | Stripe functions **unexported** (`functions/src/index.ts:18-26`); premium features must exist first (Plan 02) |
| `openSignup` | OFF (fail-closed) | Public signup (skips `beta_testers` allowlist) | Legal placeholders in /privacy + /terms (PR #670) + owner's launch decision — see `docs/PRELAUNCH_CHECKLIST.md` |
| `aiEnabled` | ON (fail-open) | Kill switch for all Gemini features | n/a (already on) |

## A. Kid Mode activation (can start today)

1. **Claude, pre-flight (one small PR if gaps found):** run the Kid Mode flows in Test
   Mode (`VITE_ENABLE_TEST_MODE=true`, `/#/login?test=true` — dev short-circuits the flag,
   `services/appConfig.ts:135-141`): add kid → switch → kid dashboard → chore →
   points → reward request → parent approval → exit PIN. Fix only breakage, no polish.
   Known rough edge to evaluate honestly: add-kid uses `window.prompt`
   (`ProfileMenu.tsx:34-49`) — acceptable for family-alpha, note for later.
2. **Human:** flip `kidModeEnabled` in the Developer Console; run the same loop in prod
   with a real kid profile; confirm Firestore rules behave (kid writes constrained —
   the 080a-1b hardening PR #683 covered this).
3. **Rollback:** flip the flag off; kid member docs are inert while hidden.
4. Instrument `kid_profile_created`, `chore_completed`, `reward_requested` (Plan 01).

## B. Stripe / billing activation (gate: Plan 02 shipped)

Precondition reasoning: `billingEnabled` ON today would show a paywall advertising
proactive insights + weekly recap that don't exist (`components/modals/PaywallModal.tsx:30`)
and a checkout button calling an **undeployed** function (`createcheckoutsession`,
`PaywallModal.tsx:48-52`). Ship Plan 02 first so the premium tier is real.

1. **Claude:** export the stripe functions (`functions/src/index.ts:18-26` — code +
   tests already exist: `checkout.test.ts`, `webhook.test.ts`, `subscriptionEvent.test.ts`);
   wire the webhook secret + price IDs from env; add a `subscription` write-path
   emulator test proving the webhook grants/revokes `premium` correctly; verify
   `getPlan`/`isPremium` (`utils/entitlements.ts:71-80`) flow through the paywall and AI
   caps end-to-end in Test Mode.
2. **Human:** `docs/STRIPE_SETUP_RUNBOOK.md` Phase 0/1 (account, bank, live keys, webhook
   endpoint secret). Test-mode Stripe checkout on a throwaway.
3. Flip `billingEnabled`; watch the first real checkout + webhook round-trip; confirm the
   free-tier caps (`FREE_LIMITS` — 3 AI/day, 2 members, 2 kids, no recap) bind only
   AFTER the flip (they're inert before — `contexts/FirebaseHouseholdContext.tsx:3892-3899`).
4. **Rollback:** flag off → everyone premium-equivalent again; Stripe subscriptions keep
   billing, so pause/refund via dashboard if aborting for real.

## C. Standing items the flags don't cover (owner's checklist)

- **Rules backdoor:** `firestore.rules:31` still hardcodes the super-admin UID. Provision
  the `admin` custom claim (Admin SDK one-liner, `todo/05-admin-gate-serverside.md`), then
  a Claude PR deletes the UID branch behind the emulator rules tests. Do this before
  `openSignup`.
- **openSignup:** blocked on the 7 legal `[PLACEHOLDER]`s + counsel review
  (`docs/PRELAUNCH_CHECKLIST.md`). Sequence: legal → admin claim → flag + authorized
  domain (`docs/DEPLOY_CHECKLIST.md` §3).
- **Plaid production keys:** human, when Plan 04 lands (sandbox secrets are already set).

## Done criteria

Each activation gets: the pre-flight run recorded in a short PR/issue note, the flag
flipped by the human, one week of `track()` data (Plan 01) confirming use, and a rollback
note. This plan is "done" when Kid Mode and billing are live or the owner has explicitly
parked them with a reason recorded here.
