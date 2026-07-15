# LifeBalance: From Personal Tool to a Product That Makes Money

_A realistic audit and a step-by-step roadmap from where the app is today (a polished
personal/family tool, `0.8.0-alpha`) to something strangers pay for, tell their friends
about, and that a VC or acquirer would take seriously._

**Audit date:** 2026-06-22 · **Scope:** ~63k LOC TS/TSX, 93 test files, Firestore rules,
5 Cloud Functions, Gemini AI integration, PWA.

> **How to read this doc.** Part 1–3 are the honest assessment and the things that
> *block* charging anyone money. Part 4 is the phased journey (MVP → fundable). Part 5 is
> the part you asked for most directly: **every task and feature tagged by how feasible it
> is for one person doing this as a hobby.** Part 6–8 cover the money model, the metrics
> that make you fundable, and a concrete first-90-days plan.

---

## Part 1 — Honest Assessment

### What you actually have (this is the good news)

This is **not** a weekend toy. By engineering standards it is already ahead of most
"side projects that want to be startups":

- **Real architecture.** Domain-sliced contexts, typed Firestore converters, atomic
  batch writes, integer-cent money math, lazy-loaded routes, a near-zero lint-suppression
  policy that is actually enforced, and ~86% test coverage on the critical `utils/` math.
- **Genuine multi-tenant foundation.** Data is correctly scoped under
  `households/{householdId}` with member-based access rules. The hard part of "many
  customers safely isolated" is largely done.
- **A real feature set, not a demo.** Production-grade Finance (Safe-to-Spend, pay-period
  budgeting, recurring bills, analytics), a complete gamified Habits engine (streaks,
  multipliers, freeze bank, challenges, yearly goals), Meals + Shopping, Todos, household
  sync, AI receipt/statement scanning, push notifications, and an iOS Shortcuts API.
- **Operational maturity for a hobby project.** CI on every PR (lint + test + build),
  Husky pre-commit hooks, a documented security model, and a self-maintained tech-debt
  backlog (`TODO.md`).

**Translation:** the *engine* is built. What's missing is almost entirely the stuff that
turns an engine into a *business*: a way to get in (frictionless onboarding), a reason to
stay (retention loops), a way to pay you (billing), the legal/compliance shell a finance
app legally needs, and the instrumentation to prove people love it.

### The market reality (read this before quitting your day job)

Be clear-eyed about the space you're entering:

- **Personal finance is crowded and brutal.** YNAB ($109/yr), Monarch, Copilot, Rocket
  Money, EveryDollar, and a graveyard of dead apps (RIP Mint). These have bank-syncing
  via Plaid, big design teams, and marketing budgets.
- **Habit tracking is also crowded.** Habitica, Streaks, Finch, Atomic-Habits-branded apps.
- **But almost nobody owns the intersection well: _the household_.** The combination of
  **shared family money + shared family habits + gamification, designed for a couple or a
  family to run together** is a real, under-served wedge. Couples fighting about money and
  parents trying to build kids' habits are large, emotional, willing-to-pay markets.

**Your honest positioning is not "better YNAB."** It's **"the app a couple/family runs
together to stay on the same page about money and habits — and have a little fun doing
it."** That framing should drive every feature decision below.

### The honest funding ladder

You asked for "MVP to VC-funded or big-tech-acquired." Here's the truthful version of
that ladder, because chasing the wrong rung wastes years:

1. **Bootstrapped side income (most likely, most achievable).** 200–2,000 paying
   households at $5–10/mo = $1k–$20k MRR. Entirely doable solo. This is real money and
   the foundation for everything above it.
2. **Ramen-profitable indie product.** ~$10k+ MRR with strong retention. At this point
   you choose: stay indie (great outcome) or raise.
3. **VC-fundable.** VCs fund consumer subscription apps that show **retention + organic
   growth + a believable path to $100M revenue.** For you that means: strong week-4 and
   month-6 retention, real word-of-mouth (couples inviting their partner *is* a built-in
   viral loop), and a wedge competitors can't easily copy. This is possible but requires
   the metrics in Part 7 — not just features.
4. **Acquisition.** The realistic acquirers aren't "big tech" — they're the finance
   incumbents (Intuit, Monarch, Rocket, a bank, a fintech) who want your **household
   engagement loop and your users.** They buy *traction and a team*, not code. The
   fastest path to "acquirable" is the same as "fundable": retention + growth.

**Bottom line:** Optimize for rung 1–2. If you nail retention and word-of-mouth, rungs 3–4
become available *as a consequence*. If you chase rungs 3–4 directly (raising before
traction), you'll likely fail. The roadmap below is sequenced accordingly.

---

## Part 2 — The Audit (current state, by dimension)

### Scorecard

| Dimension | Score | One-line verdict |
|---|---|---|
| Core feature depth | 8.5/10 | Finance + Habits are genuinely production-grade. |
| Code quality / architecture | 8/10 | Strong; one 3.8k-line context is the main smell. |
| Test coverage | 6/10 | Excellent on `utils/`; thin on context/services; zero E2E. |
| Security | 5/10 | Rules are solid; **two critical holes** (see Part 3). |
| Compliance/legal (for a finance app) | 2/10 | No privacy policy, ToS, data export UI, or account deletion. |
| Onboarding / first-run UX | 3/10 | Functional but no guidance, no empty states, no "aha" moment. |
| Observability (errors/analytics) | 3/10 | Console-only. No Sentry, no product analytics. **You're flying blind.** |
| Monetization infra | 0/10 | No billing, no plans, no paywall. Doesn't exist yet. |
| Growth / virality | 1/10 | Invite codes exist; no referral, sharing, or growth loops. |
| Distribution | 4/10 | PWA works; no app-store presence, no marketing site. |
| i18n | 0/10 | English hardcoded. (Fine for launch; flag for later.) |
| Accessibility | 7/10 | Genuinely good manual work; no automated a11y gate. |

### Biggest single-household / personal-tool assumptions to break

- **One household per Google account.** No household switching. Fine for families; will
  frustrate power users (landlord, person with personal + roommate budgets). Don't fix
  yet — just know it.
- **USD-only.** No `currency` field anywhere. Blocks international monetization.
- **Beta allowlist gating.** Login is gated to an email allowlist ("Private Alpha").
  Great for now; becomes the literal thing you flip to "open" at public launch.
- **Manual balance entry / OCR only.** No bank sync (Plaid). This is your single biggest
  product gap vs. paid competitors — and your single biggest cost/partnership decision.

---

## Part 3 — Critical Blockers (do these before charging anyone, ever)

These are non-negotiable. Shipping a *finance* app to the public without them is a
security, cost, and legal liability.

### 🔴 B1. Gemini API key is exposed in the client bundle
`services/geminiService.ts:67` reads `VITE_GEMINI_API_KEY`. **Every `VITE_*` var is
inlined into the shipped JavaScript** — anyone can open DevTools and steal it, then run up
your Google bill. Today, with a private allowlist, it's contained. The moment you go
public it's an open wallet.
**Fix:** proxy all Gemini calls through a Cloud Function (auth + per-household quota
server-side), or at minimum lock the key in Google Cloud (HTTP-referrer + API restriction +
hard quota cap) as a stopgap. The Cloud Functions infra already exists. **(~1 weekend.)**

### 🔴 B2. Hardcoded super-admin UID backdoor in security rules
`firestore.rules:31` grants global admin to a literal UID as a fallback. If that account is
ever compromised, an attacker owns every household. **Fix:** provision the `admin` custom
claim (the rules already check for it), then delete the UID branch and redeploy.
**(~2 hours.)**

### 🔴 B3. No account/household deletion (GDPR Art. 17 / CCPA)
There is no "delete my data" path. For a finance app handling spending data, this is a
legal requirement in the EU/CA and table stakes for trust everywhere. **Fix:** a
`deleteHousehold` Cloud Function + a confirm-to-delete UI in Settings. **(~1 weekend.)**

### 🔴 B4. No data export UI (GDPR Art. 20 / portability)
`exportUtils.ts` exists but isn't wired to a button. Users must be able to download their
data. **Fix:** "Download my data" in Settings → ZIP of JSON/CSV. **(~1 day.)**

### 🔴 B5. No Privacy Policy or Terms of Service
You process financial data and send receipt images to a third party (Google Gemini). You
**must** disclose this and get consent. **Fix:** publish a Privacy Policy + ToS (use a
generator like Termly/iubenda to start, ~$10–30/mo or free tier), add a consent checkbox at
signup, and an AI-feature consent notice. **(~1 day of writing/wiring; not code-heavy.)**

> **Until B1–B5 are done, the app should stay on its private allowlist.** They are the
> literal gate between "my family uses it" and "strangers can sign up."

---

## Part 4 — The Roadmap (phased journey)

Each phase has an **exit criterion** — don't move on until you hit it.

### Phase 0 — Make it launchable (the blockers + the floor)
**Goal:** legally and technically safe for strangers to sign up.
- All of Part 3 (B1–B5).
- Add **error tracking (Sentry)** — ~2 hours, and you stop flying blind the day you open up.
- Add **product analytics** (PostHog free tier or Firebase Analytics — the
  `VITE_FIREBASE_MEASUREMENT_ID` is already in env but unused). You cannot improve retention
  you can't measure.
- Replace the email allowlist with open Google sign-up (behind a feature flag so you can
  throttle).
- **Exit:** a stranger can sign up, the key can't be stolen, you can delete/export their
  data, and you can see when something breaks.

### Phase 1 — Public MVP / Open Beta (earn the right to charge)
**Goal:** a stranger signs up, reaches the "aha" moment, and comes back next week.
- **Onboarding wizard** (currently the #1 UX gap): a 4–5 step first-run flow — name your
  household, add a checking balance, pick 2–3 starter habits, invite your partner. The
  app's empty Dashboard with `Safe-to-Spend = $0` is a terrible first impression today.
- **Empty states everywhere** with a single clear CTA ("No habits yet — add your first").
- **The partner-invite loop made delightful** — this is your built-in virality. Inviting a
  spouse should be one tap with a nice shareable link, not a 6-char code buried in setup.
- **A real marketing/landing page** (separate static site — Framer, Carrd, or a Vite page):
  what it is, who it's for (couples/families), screenshots, a waitlist/sign-up.
- **Fix the unbounded listeners** ([`TODO.md`](../TODO.md) §2A) before real users with large data hit them.
- **Exit:** **Week-4 retention you can measure** and a handful of unprompted "I told my
  friend about this" moments. Don't add billing until people come back on their own.

### Phase 2 — Monetization (turn love into money)
**Goal:** people pay.
- **Billing via Stripe** (web) — `subscription`, `plan`, `status`, `renewalDate` on the
  household doc; a Stripe webhook Cloud Function; an upgrade UI.
- **Freemium split** (see Part 6 for the specific recommendation). Gate on *value and
  scale*, not on crippling the core loop.
- **Server-side entitlement checks** — the paywall must be enforced in Cloud Functions /
  rules, not just hidden in the UI.
- **Exit:** first paying households + a measured free→paid conversion rate (aim 2–5%).

### Phase 3 — Retention & Growth loops (the part VCs actually score)
**Goal:** users stay and bring others.
- **Weekly "household recap"** email/push: "You stayed $X under, kept a 12-day streak,
  here's next week." This is the retention heartbeat.
- **Referral mechanics:** invite N friends → free month. (Couples invites are organic;
  *friend* invites are the growth lever.)
- **Make AI insights proactive.** The integration already exists — `refreshInsight`
  (`contexts/FirebaseHouseholdContext.tsx:3614`) is wired to `generateInsight` and produces
  real, actionable insights from transaction + habit data on demand. The retention
  opportunity is making them *automatic* (surfaced in the weekly recap, on dashboard load,
  or when spending patterns shift) rather than only when a user taps refresh. This is a
  marquee differentiator and a retention driver.
- **Streaks/notifications tuned for habit formation** (the literature is clear: timely,
  personal nudges drive DAU).
- **Exit:** flat-to-rising retention curve (the "smile") and a viral coefficient you can
  point to.

### Phase 4 — Scale & Fundability
**Goal:** the metrics and infra that make you fundable/acquirable.
- **Cost control at scale:** paginate high-cardinality listeners, denormalize Safe-to-Spend
  into a summary doc, and merge the hourly notification crons ([`TODO.md`](../TODO.md) §2A) —
  these are the things that turn a $50/mo Firebase bill into a $3k/mo one at 100k users.
- **Bank sync (Plaid)** — the big one. Removes the only feature gap vs. paid competitors,
  but it's a real cost ($) and a vendor relationship. This is the feature that converts
  "nice gamified tracker" into "replaces YNAB."
- **The metrics dashboard for fundraising** (Part 7).
- **Exit:** the deck writes itself — retention, growth, revenue, defensible wedge.

---

## Part 5 — Task & Feature Catalog by Hobbyist Feasibility

This is the heart of what you asked for: **everything tagged by how realistic it is to do
solo, in your spare time.** Tiers:

- **🟢 Tier 1 — Weekend win.** A focused weekend or less. Pure code, no new vendors, no
  legal. Do these freely.
- **🟡 Tier 2 — Few weekends.** A couple weeks of evenings. Maybe one new SDK/service, no
  ongoing cost commitment.
- **🟠 Tier 3 — Big solo project.** A month+ of sustained focus, or real architectural
  change. Doable alone but it's a real commitment.
- **🔴 Tier 4 — Beyond hobby.** Needs money, a partner/contractor, legal review, a vendor
  contract, or ongoing operational burden. Possible solo but you should think hard first.

---

### 🟢 Tier 1 — Weekend Wins (do these first; high leverage, low cost)

| Task | Why it matters | Notes |
|---|---|---|
| **B2: Remove hardcoded admin UID** | Critical security hole | ~2 hrs; provision `admin` claim, delete UID branch. |
| **B4: Wire up "Download my data"** | Legal + trust | `exportUtils.ts` already exists; add a Settings button. |
| **Add Sentry error tracking** | Stop flying blind | ~2 hrs; wrap `ErrorBoundary.componentDidCatch`. |
| **Add product analytics (PostHog/Firebase)** | Can't improve what you can't measure | Measurement ID already in env. |
| **Empty states with CTAs** | First impression | Every list view: icon + one-line + button. |
| **`currency` field + locale formatting** | Unblocks the world later | Default `'USD'`; cheap to add now, painful to retrofit. |
| **In-app notification badge** | Engagement nudge | Red dot on BottomNav for pending items. |
| **Global search** (transactions/recipes/habits/todos) | Expected consumer baseline | Currently absent entirely. |
| **Recurring-bills master list** | Top item in `TODO.md` | Surface what's already in the calendar data. |
| **"All Transactions" view** | #1 in `TODO.md` | Master list page; data + virtualization already exist. |
| **`aria-live` + automated a11y gate (axe in CI)** | Cheap quality signal | a11y is already strong; lock it in. |

### 🟡 Tier 2 — Few-Weekend Projects

| Task | Why it matters | Notes |
|---|---|---|
| **B1: Proxy Gemini through Cloud Function** | Critical: stops key theft | Functions infra exists; move key server-side + quota. |
| **B3: Account/household deletion** | Legal (GDPR-17) | `deleteHousehold` Cloud Function + confirm UI. |
| **B5: Privacy Policy + ToS + consent** | Legal gate to launch | Mostly writing/wiring; use a generator. |
| **Onboarding wizard** | #1 retention lever for new users | 4–5 steps; the single highest-ROI UX work. |
| **Delightful partner-invite flow** | Built-in virality | One-tap shareable link; replace buried 6-char code. |
| **Marketing/landing page + waitlist** | Distribution | Static site (Framer/Carrd) or a public Vite route. |
| **Fix unbounded listeners ([`TODO.md`](../TODO.md) §2A)** | Breaks at scale | Window meals/calendar/grocery + add indexes. |
| **Proactive AI insights** (auto-surface, not just on-tap) | Marquee differentiator | Integration exists; trigger it automatically (recap/dashboard/pattern-shift). |
| **Weekly household recap (email/push)** | Retention heartbeat | Scheduled function + a digest template. |
| **E2E test skeleton (Playwright)** | Confidence to ship fast | Cover signup → add account → add habit. |
| **Context test coverage** | Guard your riskiest file | The 3.8k-line context owns every money mutation. |

### 🟠 Tier 3 — Big Solo Projects (real commitment, still solo-doable)

| Task | Why it matters | Notes |
|---|---|---|
| **Stripe billing + plans + entitlements** | This is literally how you make money | 3–4 weeks: checkout, webhook fn, server-side gating, upgrade UI. |
| **Referral / invite-reward system** | Primary growth lever | Tracking, attribution, reward granting. |
| **Cost-control refactor for scale** | Avoids a surprise $3k Firebase bill | Paginate listeners, denormalize Safe-to-Spend summary, merge hourly notification crons ([`TODO.md`](../TODO.md) §2A). |
| **Split the 3.8k-line context** | Maintainability as you add features | Already partially sliced; finish it. |
| **Admin panel** | You'll need it for support day 1 | Household lookup, quota reset, billing overrides. |
| **Audit log for financial edits** | Trust + future compliance | Who changed which transaction, when. |
| **Multi-household / household switching** | Unlocks power users | Real refactor of the single-household assumption. |
| **App-store presence (TWA/Capacitor wrap)** | Discovery + credibility | PWA is good; store listings drive trust + installs. |

### 🔴 Tier 4 — Beyond Hobby (money, partners, or contracts required)

| Task | Why it matters | The catch |
|---|---|---|
| **Plaid bank sync** | Closes the #1 gap vs. paid competitors | Real per-connection cost, vendor contract, and security/compliance burden. Probably the thing you raise money *for*. |
| **SOC 2 / formal security audit** | Required to sell to the security-conscious & to get acquired | $$$ and months; only when revenue justifies it. |
| **Full i18n / localization** | International TAM | Large, ongoing lift (string extraction, RTL, locale QA). |
| **Native iOS/Android apps** | Best-in-class mobile + push on iOS | A whole second codebase unless you wrap; ongoing maintenance. |
| **Paid acquisition / marketing spend** | Growth beyond organic | Burns cash; only with proven LTV > CAC. |
| **Hiring / co-founder** | Everything above, faster | The real unlock for rungs 3–4 of the funding ladder. |
| **Bank/fintech partnerships** | Acquisition conversations | Needs traction first; they buy users, not code. |

---

## Part 6 — The Money Model (specific recommendation)

**Model:** Freemium subscription, billed per *household* (not per user — a family should
pay once). This matches your data model and your "couples/families" positioning.

**Suggested tiers:**

- **Free — "Get on the same page"**
  - 1 household, up to 2 members, core Safe-to-Spend + budgeting + habits + todos.
  - Limited AI (e.g., 5 receipt scans/mo), manual balance entry.
  - _Purpose: deliver the real "aha" so couples get hooked. Don't cripple the core loop._

- **Premium — ~$7–9/mo or ~$60–80/yr — "Run the household"**
  - Unlimited members, unlimited AI (receipts/statements/insights/meal planning),
    weekly recaps, analytics history, data export, priority push.
  - _This is where 90% of revenue comes from._

- **(Later) Plus — "Auto-pilot"**
  - Plaid bank sync, multi-household, advanced forecasting. Higher price to cover Plaid's
    per-connection cost. Only when Tier-4 bank sync ships.

**Pricing principles:**
- Annual plan at ~30% discount (annual = cash up front + better retention).
- Free→paid conversion target: **2–5%**. At 10k free households and 3%, that's ~300 paying
  → ~$2k+ MRR. The lever is *more free signups* × *better conversion*, which is why
  onboarding and retention (Phases 1–3) come *before* squeezing price.
- Gate on **scale and convenience** (members, AI volume, automation), never on the
  emotional core (seeing Safe-to-Spend, building a streak together). Crippling the core
  kills word-of-mouth.

---

## Part 7 — The Metrics That Make You Fundable / Acquirable

Features don't raise money; **a retention curve and a growth loop do.** Instrument these
from Phase 0 so you have the history when you need it:

- **Activation:** % of signups who complete onboarding *and* invite a partner *and* log
  something in week 1. This is your "aha" rate.
- **Retention:** Week-1 / Week-4 / Month-6 cohort retention. A flattening "smile" curve is
  *the* thing investors look for in consumer apps.
- **Engagement:** DAU/MAU ratio (habit + finance apps that work are near-daily). Households
  with 2+ active members (your stickiness multiplier).
- **Virality:** invites sent per active household; invite acceptance rate; viral
  coefficient.
- **Revenue:** MRR, free→paid conversion, churn, LTV, and (once you spend) CAC.
- **The narrative these support:** "Couples who both activate retain at X% at 6 months and
  invite Y others — here's a capital-efficient path to $100M revenue in the under-served
  household-finance-and-habits market." That sentence, *backed by real cohort data*, is
  what gets a meeting.

### Event dictionary (GA4 / Firebase Analytics)

All events fire client-side via `track()` in `services/analytics.ts` (PROD-only,
fire-and-forget). **No PII is ever sent** — no amounts, merchants, habit titles, or
emails; params are limited to coarse types, booleans, and counts. Build GA4
explorations against this table.

| Event | Trigger | Params |
|---|---|---|
| `sign_up` | First-ever Google sign-in completes (`services/authService.ts`) | `method: 'google'` |
| `login` | Returning-user sign-in completes | `method: 'google'` |
| `household_created` | Household creation succeeds (`services/householdService.ts`) | — |
| `household_joined` | Invite-code join succeeds | — |
| `onboarding_completed` | Onboarding wizard finishes or is skipped (`completeOnboarding` succeeds) | `step` — wizard step the user finished from (`'done'` = full run; anything else = skip) |
| `transaction_added` | Any transaction write commits (`addTransaction` in the context — every capture source converges there) | `source` — `manual` \| `camera-scan` \| `file-upload` \| `telegram` \| `recurring` \| `shortcut` \| `plaid` |
| `first_transaction_added` | First `transaction_added` ever on this device (localStorage flag `lb_first_txn_tracked`) | — |
| `transaction_verified` | A `pending_review` transaction is promoted to `verified` (`updateTransactionCategory`) | — |
| `habit_toggled` | Habit toggle batch commits (`hooks/useHabitActions.tsx`) | `positive` — habit type is positive; `direction` — `up` \| `down` |
| `first_habit_completed` | First upward habit toggle ever on this device (flag `lb_first_habit_tracked`) | — |
| `habit_past_day_logged` | A habit is backfilled for a past day from the Habits header calendar (`components/modals/PastDayLogModal.tsx`) | `daysAgo` — how many days back the logged date is; `positive` — habit type is positive |
| `insight_generated` | AI insight doc written (`refreshInsight`) | — |
| `insight_action_executed` | An insight's suggested action runs successfully (`hooks/useInsightActions.ts`) | `type` — `update_bucket` \| `create_habit` \| `create_todo` |
| `insight_rated` | Thumbs up/down tapped on an insight (`rateInsight`, `components/dashboard/InsightWidget.tsx`) | `feedback` — `up` \| `down` |
| `receipt_scanned` | Camera receipt OCR succeeds (`CaptureModal`) | — |
| `statement_scanned` | Bank-statement/receipt file parse succeeds (`CaptureModal`) | `count` — transactions extracted |
| `meal_planned` | Meal added to the weekly plan (`addMealPlanItem`) | — |
| `shopping_item_checked` | Shopping item marked purchased (`toggleShoppingItemPurchased`) | — |
| `reward_redeemed` | Reward redemption commits (`redeemReward`) or a kid request is approved (`approveRedemption`) | `via` — `self` \| `parent_approval` |
| `notification_opened` | App boots from a push-notification click — the SW tags the URL with `?nsrc=<type>`, the client reads + strips it (`utils/notificationSource.ts`, `public/sw.js`) | `type` — `habit_reminder` \| `action_queue_reminder` \| `streak_warning` \| `bill_reminder` \| `budget_alert` \| `test_notification` |
| `recap_viewed` | Weekly recap detail drawer opens (`components/dashboard/WeeklyRecapCard.tsx`) | `isoWeek` — the recap's ISO week; `source` — `card` \| `push` |
| `recap_push_opened` | App arrives via the weekly recap push deep link (`?recap=<isoWeek>`, consumed by `utils/recapParam.ts`) | — |
| `duplicate_merged` | A `possibleDuplicateOf`-flagged transaction pair is merged (`mergeTransactions` in the context, or the Merge action in `TransactionReviewForm`) | `source` — the deleted duplicate row's `Transaction.source` |
| `duplicate_kept_both` | A `possibleDuplicateOf` flag is dismissed without merging (`keepBothTransactions` / the Keep-both action) | — |
| `bank_linked` | A Plaid Link flow completes and `plaidexchangepublictoken` succeeds (`components/settings/ConnectBankCard.tsx`) | — |
| `plaid_balance_adopted` | The "Update to bank balance" chip is tapped on a budget account card (`components/budget/BudgetAccounts.tsx`) | — |

First-time events are approximate by design (per-device localStorage flags, no server
state) — good enough for funnel analysis, not accounting.

---

## Part 8 — Concrete First 90 Days (solo, evenings/weekends)

**Days 1–30 — Stop the bleeding, see the truth.**
Ship B1 (Gemini proxy) and B2 (admin UID). Add Sentry + analytics. Add empty states. Write
the Privacy Policy/ToS draft. _Exit: technically safe, and you can finally see what users
do._

**Days 31–60 — Earn the right to open up.**
Build the onboarding wizard. Make partner-invite delightful. Ship data export (B4) +
account deletion (B3). Stand up a landing page with a waitlist. Fix the unbounded
listeners. _Exit: flip off the allowlist, let real strangers in, watch the funnel._

**Days 61–90 — Find the loop, then charge.**
Make AI insights proactive (auto-surface them). Ship the weekly recap. Watch Week-4
retention. **Only once people
come back on their own,** start Stripe billing. _Exit: first dollar from a stranger, and a
retention number you'd put on a slide._

---

## Appendix — Quick Reference: Where Things Live

| Concern | File(s) |
|---|---|
| AI / Gemini (key exposure: B1) | `services/geminiService.ts:67` |
| Security rules (admin UID: B2) | `firestore.rules:31` |
| Data export (wire up: B4) | `utils/exportUtils.ts` |
| Core money metric | `utils/safeToSpendCalculator.ts` |
| Monolithic state (split candidate) | `contexts/FirebaseHouseholdContext.tsx` (~3.8k lines) |
| Cloud Functions (billing/deletion go here) | `functions/src/` |
| Onboarding entry points | `pages/Login.tsx`, `pages/HouseholdSetup.tsx` |
| AI insights (make proactive/automatic) | context `refreshInsight` (`:3614`) + `generateInsight` |
| Deferred scale work | [`TODO.md`](../TODO.md) §2A |

---

_This document is a strategic plan, not a spec. Re-tier tasks as your time and ambition
change — the one rule that doesn't change: **retention before monetization, monetization
before growth spend, and the critical blockers (Part 3) before any of it.**_
