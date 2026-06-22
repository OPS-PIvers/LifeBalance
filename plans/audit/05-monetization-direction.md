# Audit 05 — Monetization & Direction (gap analysis)

> Reconstructed from the monetization sweep (this auditor fanned out into 6 sub-recon agents:
> billing, onboarding, empty-states, invite/referral, retention/analytics, currency/landing).
> Every gap below is grounded in repo evidence. Phase numbers map to [`../PRD.md`](../PRD.md) §3.

## Summary: what exists vs. what's missing for revenue

| Area | Today | Gap | Phase | Tag |
|------|-------|-----|-------|-----|
| Billing | **Zero** infra | Stripe + plan fields + webhook fn + entitlements | 2 | C / H(keys) |
| Onboarding | No wizard | Guided first-run + starter-data seed | 1 | C |
| Empty states | Uneven | Budget zero-data CTA; dashboard widgets | 1 | C |
| Invite | Manual 6-char code | Shareable link + referral rewards | 1/3 | C |
| Retention | Push only, manual insights | Recap + auto-insights + badges | 3 | C |
| Analytics | **None initialized** | Firebase Analytics events (key in env) | 0 | C |
| Currency/i18n | USD hardcoded | `formatCurrency()` + `currency` field | 1 | C |
| Landing | **None in repo** | Static marketing page + waitlist | 1 | C / H(host) |

## Findings

### [DIR-01] No billing/monetization infrastructure exists
- **Evidence**: zero matches for `stripe`/`subscription`/`plan`/`paywall`/`entitlement`/`renewalDate` in `.ts(x)` or Cloud Functions. The `Household` type ([`types/schema.ts`](../../types/schema.ts) ~:325-360) has **no** subscription/plan/status fields. The only `status` enums are on `Transaction`/`Challenge`/`BetaTester`/`HouseholdApiKey`.
- **Impact**: nothing to charge with. The entire revenue mechanism is greenfield.
- **Effort**: L. **Phase 2.** Needs household-doc plan fields, Stripe Checkout, a webhook Cloud Function, server-side entitlement checks, and an upgrade UI. Code is `[C]`; live keys/account are `[H]`.

### [DIR-02] No onboarding — new households land on an empty $0 dashboard
- **Evidence**: first-run path is `Login` (Google only) → `HouseholdSetup` (collects **only** a household name, or a 6-char join code) → `Dashboard`. `createHousehold` ([`services/householdService.ts`](../../services/householdService.ts) ~:45) seeds **no** accounts/buckets/habits. `DailyHabitsWidget` ([`:56`](../../components/dashboard/DailyHabitsWidget.tsx)) `return null`s with no habits. The only wizard, `HabitCreatorWizard`, lives on `/habits` and is never auto-opened.
- **Impact**: the "aha" moment is buried; the first impression is a blank dashboard reading `$0.00`. #1 retention leak for new users.
- **Effort**: M. **Phase 1.** `[C]`.

### [DIR-03] Empty states are uneven; the Budget one is actively misleading
- **Evidence**: Habits ([`pages/Habits.tsx:252`](../../pages/Habits.tsx)), ToDos, and Shopping have proper CTA empty states. But `TransactionMasterList` ([`:531`](../../components/budget/TransactionMasterList.tsx)) shows a **filter**-empty message ("Nothing matches your current search and filters") even when the real cause is *zero transactions* — no "add your first transaction" CTA. Dashboard `UpcomingBillsWidget`/`ActivityFeedWidget`/`DailyHabitsWidget` `return null` when empty (blank dashboard).
- **Impact**: new users get no guidance toward first data entry; the Budget message is confusing.
- **Effort**: S. **Phase 1.** `[C]`.

### [DIR-04] Invite is a manual code; no shareable link, no referral
- **Evidence**: invite is a 6-char code, copy-to-clipboard only ([`HouseholdInviteCard.tsx:13`](../../components/auth/HouseholdInviteCard.tsx)) — no `navigator.share`, no URL/deep-link, no QR. No referral system: `inviteCode`/`joinedAt` are stored on the member doc ([`householdService.ts` ~:136](../../services/householdService.ts)) but read by nothing for attribution.
- **Impact**: the built-in viral loop (couples inviting partners) has maximum friction, and there's no *friend*-referral growth lever.
- **Effort**: M (link/share/deeplink, Phase 1) + M (referral rewards, Phase 3). `[C]`.

### [DIR-05] Retention loops are minimal
- **Evidence**: AI insights are **manual-only** — `refreshInsight` ([context `:3614`](../../contexts/FirebaseHouseholdContext.tsx)) has exactly one caller, a button in `InsightWidget` ([`:61`](../../components/dashboard/InsightWidget.tsx)); default copy is "Tap 'Get Insight'…". No weekly recap / digest / email exists anywhere in `functions/` (no SendGrid/Nodemailer/email extension). No in-app notification badge in `BottomNav`/`TopToolbar`. Five FCM push functions exist but are reminders, not retention digests.
- **Impact**: nothing pulls a lapsed user back proactively; the marquee AI feature is invisible unless tapped.
- **Effort**: M. **Phase 3.** `[C]` (email send needs a provider key → `[C→H]`).

### [DIR-06] No product analytics or error tracking is initialized
- **Evidence**: [`firebase.config.ts`](../../firebase.config.ts) imports `getAuth`/`getFirestore`/`getMessaging` only — **`getAnalytics` is never called**, though `measurementId` is present in the config (~:44). No PostHog/Sentry/Mixpanel/Amplitude anywhere.
- **Impact**: flying blind — you cannot measure activation or retention, which Phases 1-3 are optimized against.
- **Effort**: S. **Phase 0.** `[C]` — **the measurement ID is already in env, so Firebase Analytics needs no new account.**

### [DIR-07] USD hardcoded; no currency abstraction
- **Evidence**: `$` is a string literal across money components (e.g. `SafeToSpendHero.tsx`, `UpcomingBillsWidget.tsx:82`, `BudgetBuckets.tsx:387`); `BudgetAccounts.tsx:301` hardcodes `'en-US'`. `CURRENCY_FORMAT_OPTIONS` ([`types/schema.ts:5`](../../types/schema.ts)) controls decimals only. No `currency`/`locale` field on any model; no `formatCurrency()` helper.
- **Impact**: blocks international monetization; cheap to abstract now, painful to retrofit after more components are added.
- **Effort**: M. **Phase 1.** `[C]`.

### [DIR-08] No landing/marketing surface in the repo
- **Evidence**: `public/` holds only PWA assets (icons, `manifest.json`, `sw.js`). No `/landing`, no waitlist, no app-store/marketing references in source. Landing page is only an aspiration in the roadmap.
- **Impact**: no distribution funnel / waitlist to capture demand at launch.
- **Effort**: M. **Phase 1.** Code `[C]`; domain/hosting/copy `[H]`.

## Note the roadmap's money model missed
The data model is **already per-household** (`Household` doc owns members, points, accounts), which
*perfectly* matches the roadmap's "bill per household, not per user" recommendation — so the schema
needs only additive plan fields, not a restructure. That's a meaningful de-risking the roadmap
undersells: monetization is an *additive* layer here, not a refactor.
