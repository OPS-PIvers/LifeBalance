# LifeBalance → Revenue: The Claude-vs-Human Execution PRD

> **What this is.** A single, grounded plan for taking LifeBalance from a polished
> private-alpha (`0.8.0`) to a launchable, paying product — written so that **Claude
> sessions do everything Claude can technically do** (code, tests, rules, functions,
> drafts, PRs, even production deploys via CI) and **humans do only the irreducible
> minimum** (credentials, money, legal, account creation, and judgment sign-offs).
>
> It supersedes the strategy in [`docs/PRODUCT_ROADMAP.md`](../docs/PRODUCT_ROADMAP.md)
> where the audit found that doc to be wrong or stale (see §1). The roadmap is still the
> right *north star*; this is the *executable* version with verified facts.
>
> **Planned at commit:** `028cf23` · **Audit date:** 2026-06-21 · **Audit evidence:**
> [`plans/audit/01..06`](./audit/) · **Per-task plans:** [`plans/README.md`](./README.md)

---

## 0. How to read this

- **§1** corrects the roadmap against what's actually in the code + cloud (verified, with
  `file:line`). Read this first — several roadmap claims are wrong in ways that matter.
- **§2** is the infra reality every executor needs (the account/access gap, how deploys
  actually happen). This is *the* thing that determines what Claude can do unattended.
- **§3** is the phased journey. **Every task is tagged `[C]` (Claude-executable) or
  `[H]` (human-only) or `[C→H]` (Claude builds, human flips one switch).**
- **§4** is the consolidated **Human-Only Checklist** — the short list of things a human
  *must* do, each written as a turnkey, zero-context runbook.
- **§5** is the dependency/sequencing graph and the per-phase exit criteria.

The detail for each `[C]` task lives in a numbered plan under [`plans/`](./README.md),
written so a fresh Claude session (or a cheaper model) can execute it with no other context.

---

## 1. Reality check — corrections to the roadmap

The roadmap is directionally excellent but contains factual errors. An executor who trusts
it blindly will waste effort or mis-scope. Verified corrections (evidence in
[`plans/audit/01-roadmap-verification.md`](./audit/01-roadmap-verification.md)):

| Roadmap claim | Reality | Why it matters |
|---|---|---|
| Gemini key at `geminiService.ts:67` | Line **:68** (substance correct) | Trivial, but plans cite exact lines. |
| "No account/household deletion" (B3) | `deleteHousehold` **absent**, but `deleteAccount` (single bank account) **exists & wired** ([`BudgetAccounts.tsx:94`](../components/budget/BudgetAccounts.tsx)) | B3 is real but *narrower*: build whole-household deletion only. |
| "`exportUtils` not wired to a button" (B4) | **Habits CSV export is already wired** ([`pages/Habits.tsx:15`](../pages/Habits.tsx)). Only the **full-data Settings export** is missing | B4 is ~half done; scope to a Settings "download everything" action. |
| "5 Cloud Functions" | **11 functions** (5 quickAdd HTTP + 4 hourly scheduled + 1 Firestore-trigger + 1 callable) | The entire push-notification layer was uncounted; it's a real cost & retention surface. |
| "93 test files, ~86% utils coverage" | **86 test files**; enforced gate is **78% lines / 82% functions** ([`vite.config.ts`](../vite.config.ts)) | Don't overstate test posture in a pitch. |
| AI insights "wired but on-tap only" | Confirmed: `refreshInsight` at **`:3614`**, only caller is a button ([`InsightWidget.tsx:61`](../components/dashboard/InsightWidget.tsx)) | Making it automatic is real, grounded retention work. |
| "No empty states" | **Uneven**: Habits/ToDos/Shopping have good CTA empty states; **Budget transactions shows a misleading *filter*-empty message with no "add first txn" CTA**; Dashboard widgets `return null` (blank first-run) | Scope empty-state work to the gaps, not "everywhere". |

**Bugs the roadmap missed entirely** (found while verifying — these are real and several are
HIGH severity; full detail in [`audit/03`](./audit/03-correctness-tests.md) &
[`audit/02`](./audit/02-security.md)):

- **🔴 Server habit scoring drops the sign.** Client `processToggleHabit`
  ([`utils/habitLogic.ts:335`](../utils/habitLogic.ts)) applies `sign = type==='positive'?1:-1`;
  the **server** `processToggleHabit`
  ([`functions/src/quickAdd/habitProcessor.ts:126-146`](../functions/src/quickAdd/habitProcessor.ts))
  does **not** — so a *negative* habit logged via the iOS Shortcut **adds** points instead of
  subtracting. **Verified.** → Plan `001`.
- **🔴 Calendar converter has no `Timestamp` guard.**
  [`utils/firestoreConverters.ts:122`](../utils/firestoreConverters.ts) spreads the raw doc with
  no `Timestamp`→ISO normalization on `date` (unlike `habitConverter` directly below it). A
  legacy `Timestamp` `date` → `Invalid Date` → that bill is **silently dropped from
  Safe-to-Spend**. **Verified.** → Plan `002`.
- **🔴 protobufjs RCE ships in the production bundle.** `@google/genai@2.8.0 → protobufjs@7.5.4`
  carries a critical arbitrary-code-execution advisory (GHSA-xq3m-2v4x-88gg). It's in the
  **shipped client**. Fix = one `pnpm.overrides` line. → Plan `003`.
- **🔴 No Content-Security-Policy** on Hosting ([`firebase.json`](../firebase.json) headers). In a
  finance app, CSP is the layer that contains an XSS to nothing. → Plan `004`.
- **🟠 Rate limiter fails open.** A Firestore error during the quickAdd rate-limit check
  silently grants unlimited writes (billing-amplification via the public HTTP endpoints).
  → Plan `006`.
- **🟠 Money-model ambiguity around pending transactions.** `addTransaction` debits checking for
  *every* txn including `pending_review` ([`:2446`](../contexts/FirebaseHouseholdContext.tsx)),
  while Safe-to-Spend *also* subtracts `pending_review` txns — a latent double-count — and the
  voice `handleExpense` path bypasses `addTransaction` entirely (no `payPeriodId`, no debit,
  no validation). **This needs characterization tests + a design decision, not a quick fix.**
  → Plan `015` (investigation).
- **Dead security guard** `sendtestnotification` (`index.ts:555`: `if (userId !== request.auth.uid)`
  is always false) and **`isTimeToSend` ignores minutes** (`index.ts:124-149`), so hourly jobs can
  fire anywhere in the hour and a same-hour retry can double-send. → Plan `012`.

---

## 2. Infra reality (READ THIS — it defines what Claude can do unattended)

**The repo targets Firebase project `lifebalance-26080`** ([`.firebaserc`](../.firebaserc)).

**The account gap.** The machine's authenticated CLI account is the *school* account
`paul.ivers@orono.k12.mn.us`, which has **no access** to `lifebalance-26080` (verified:
`gcloud projects describe` → "does not have permission"; `firebase apps:list` → fails). The
project owner is the **personal** account `paulwivers@gmail.com`. That account is **not** signed
into the machine's Chrome, and its only sign-in methods are **password** (Claude is not permitted
to enter passwords) and **passkey** (requires the physical PC's Windows Hello or a phone held next
to it). **Therefore Claude cannot authenticate the CLI to this project unattended.** Any task that
needs live project access is `[H]` or `[C→H]`.

**The deploy reality — this is the unlock.** Production deploys are **fully automated**:
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) runs on every push to `main` and
executes `firebase deploy --project lifebalance-26080` using a stored `FIREBASE_SERVICE_ACCOUNT`
secret. That single command deploys **hosting + Firestore rules + Cloud Functions** together.

> **Consequence:** Claude ships to production by **opening a PR and merging it to `main`** — no
> personal login required. Merging is itself a Claude-executable action (`gh`). The *only* things
> Claude genuinely cannot do are the handful in §4.

**Blast-radius caveat (DX-04).** Because one push deploys rules + functions + hosting atomically
with no staging channel or rollback step, a bad **rules** deploy can make all household data
unreadable. Treat any `firestore.rules` change as high-risk: it must ship in its own PR, behind
rules unit tests (Plan `010`), and a human should watch the deploy. Code-only PRs are low-risk.

**The 11 Cloud Functions** (so executors stop re-deriving them): `quickAddHabit`,
`quickAddExpense`, `quickAddReceipt`, `quickAddShoppingItem`, `quickAddNaturalLanguage` (HTTP,
API-key auth, iOS Shortcuts); `sendhabitreminders`, `sendactionqueuereminders`,
`sendstreakwarnings`, `sendbillreminders` (hourly scheduled FCM); `sendbudgetalerts` (Firestore
trigger on account writes); `sendtestnotification` (callable).

---

## 3. The phased journey (every task tagged `[C]` / `[H]` / `[C→H]`)

Phases are sequenced so each one's exit criterion is the entry condition for the next. **Do not
start Phase 2 (charging money) until Phase 0's blockers are closed** — shipping a finance app to
strangers without them is a security/legal liability.

### Phase 0 — Make it safe for strangers (the blockers + the floor)

*Goal: a stranger can sign up, the app can't be trivially abused, and you can see/fix/delete/export.*

| # | Task | Tag | Notes |
|---|------|-----|-------|
| 003 | Patch protobufjs RCE (`pnpm.overrides`) | **[C]** | One line + verify build/tests. Ship first. |
| 004 | Add Content-Security-Policy + harden headers | **[C]** | `firebase.json`; test in dev that nothing breaks (Gemini, Firebase, Google fonts). |
| 001 | Fix server habit-sign scoring bug | **[C]** | `habitProcessor.ts`; add server test. |
| 002 | Calendar converter `Timestamp` guard | **[C]** | `firestoreConverters.ts`; add converter test. |
| 006 | Rate limiter must fail **closed** | **[C]** | quickAdd; deny on Firestore error. |
| 012 | Kill dead guard + fix `isTimeToSend` minutes | **[C]** | functions; add test. |
| 005 | Wire "Download all my data" in Settings (B4) | **[C]** | `exportUtils.ts` exists; add Settings action + ZIP. |
| 007 | `deleteHousehold` Cloud Function + confirm-to-delete UI (B3) | **[C→H]** | Claude writes fn+UI; **human triggers the first real deletion to verify**, and the fn deploys via CI. |
| 008 | Firebase Analytics instrumentation (activation/retention events) | **[C]** | `measurementId` is **already in env** — no new account needed. Initialize `getAnalytics` + log signup/onboard/invite/habit/txn events. |
| 011 | Privacy Policy + ToS **draft** + consent checkbox at signup + AI-data notice (B5) | **[C→H]** | Claude writes the policy markdown/pages + wires consent; **human must have it reviewed/owned and replace placeholders with real entity info before public launch.** |
| — | Lock down the Gemini API key in Cloud Console (B1 stopgap: API+referrer restriction + quota cap) | **[H]** | Needs console access as project owner. Runbook in §4. |
| — | Provision the `admin` custom claim, then delete the UID branch (B2) | **[C→H]** | Claude writes the one-off provisioning script/callable + the rules edit (Plan `009`); **human runs the Admin-SDK step** (or approves the temp callable) before the rules edit merges. |
| — | Proxy Gemini through a Cloud Function so the key leaves the client (B1 real fix) | **[C→H]** | Claude writes the proxy fn + client switch (Plan `014`); **human sets the `GEMINI_API_KEY` server secret** once. |

**Exit:** protobufjs/CSP/rate-limit closed; data export + household deletion work; analytics
flowing; consent captured; key locked down; admin backdoor removed. *Then* the allowlist can come
off (feature-flagged — Plan `013`).

### Phase 1 — Earn the right to charge (onboarding + retention floor)

*Goal: a stranger reaches the "aha" moment and comes back next week.*

| # | Task | Tag | Notes |
|---|------|-----|-------|
| 020 | Onboarding wizard (name household → add checking balance → pick 2-3 starter habits → invite partner) | **[C]** | The single highest-ROI UX work; seed starter data so the dashboard isn't `$0`/empty. |
| 021 | Empty-state gaps: Budget zero-data CTA; dashboard widgets show a "get started" card instead of `return null` | **[C]** | Scope to the real gaps from [`audit/05`](./audit/05-monetization-direction.md). |
| 022 | Delightful partner invite: one-tap shareable **link** (+ `navigator.share`/QR), not just a 6-char code | **[C]** | Built-in virality; deep-link into join flow. |
| 023 | `formatCurrency()` abstraction + `currency` field (default USD) | **[C]** | Replace hardcoded `$`/`'en-US'` ([`BudgetAccounts.tsx:301`](../components/budget/BudgetAccounts.tsx)); unblocks intl later, cheap now. |
| 010 | Firestore **rules unit tests** (`@firebase/rules-unit-testing`) | **[C]** | Prereq for safely shipping any rules change; highest-leverage test gap. |
| 030 | Playwright E2E skeleton (signup → add account → add habit), using Test Mode | **[C]** | Test Mode (`?test=true`) makes this cheap. |
| 040 | Bound the 3 unbounded listeners (`todo/14`) | **[C]** | Before real users with large data hit them. Ship indexes first. |
| — | Stand up a marketing/landing page + waitlist | **[C→H]** | Claude can build a static page (public Vite route or `/landing`); **human owns the domain/hosting + copy sign-off.** |
| — | Flip allowlist → open Google sign-up (behind flag) | **[C→H]** | Claude builds the flag (Plan `013`); **human flips it + sets Firebase authorized domains** when ready. |

**Exit:** measurable Week-4 retention + the first unprompted "I told a friend" moments. *Don't add
billing until people come back on their own.*

### Phase 2 — Monetization (turn love into money)

*Goal: people pay. Per-household freemium (see roadmap §6 — that pricing model is sound).*

| # | Task | Tag | Notes |
|---|------|-----|-------|
| 050 | Stripe integration **code**: `subscription`/`plan`/`status`/`renewalDate` on the household doc; Checkout; a Stripe-webhook Cloud Function; upgrade UI | **[C]** | Build fully against **placeholder keys**, wire-but-dormant. |
| 051 | **Server-side** entitlement checks (Functions + rules), never UI-only | **[C]** | The paywall must be enforced server-side. |
| 052 | Freemium gating on *scale/convenience* (members, AI volume, automation) — never the core loop | **[C]** | Gate AI receipt count, member count, recap, history. |
| — | Create the Stripe account, business entity, bank connection, live keys; set the webhook secret | **[H]** | Money + legal. Turnkey runbook in §4; the code is ready to receive the keys. |

**Exit:** first paying households + a measured free→paid conversion (target 2–5%).

### Phase 3 — Retention & growth loops (what investors actually score)

| # | Task | Tag | Notes |
|---|------|-----|-------|
| 060 | Weekly "household recap" (scheduled fn + push, and email when a provider is added) | **[C]** | Retention heartbeat. Email send is `[C→H]` (needs a provider key). |
| 061 | Proactive AI insights: auto-surface on dashboard load / pattern-shift / in the recap, not just on tap | **[C]** | Integration exists at `:3614`; make it automatic. Marquee differentiator. |
| 062 | Referral system: invite N friends → free month (tracking, attribution, reward grant) | **[C]** | Primary growth lever; the data model already stores `inviteCode`/`joinedAt` unused. |
| 063 | In-app notification badges (BottomNav red dot for pending items) | **[C]** | Cheap engagement nudge; none exists today. |
| 064 | Fix the hourly all-household notification scan → per-member denormalized timeslot query (`todo/04`) + `sendbudgetalerts` N+1 (PERF-06) | **[C]** | Stops a $50→$3k Firebase bill at scale. |

**Exit:** flat-to-rising retention curve + a viral coefficient you can point to.

### Phase 4 — Scale & fundability

| # | Task | Tag | Notes |
|---|------|-----|-------|
| 070 | Cost-control: denormalize Safe-to-Spend summary; `quickAddHabit` exact-match lookup (`todo/19`); `BudgetCalendar` expansion cache (`todo/18`) | **[C]** | |
| 071 | Split the 3,863-line context further; finish `useHousehold()` shim migration | **[C]** | Maintainability as features pile on. |
| 072 | Admin panel (household lookup, quota reset, billing overrides) + audit log for financial edits | **[C]** | You'll need support tooling day one of paid. |
| — | Plaid bank sync; SOC 2; native app wrappers; paid acquisition | **[H]** | Tier-4 "beyond hobby" — money, vendor contracts, ongoing burden. Out of scope for the autonomous track; revisit with revenue. |

**Exit:** the deck writes itself — retention, growth, revenue, a defensible wedge.

---

## 4. The Human-Only Checklist (the irreducible minimum, each turnkey)

These are the **only** things a human must personally do. Everything else above is Claude-executable.
Each is written so it can be done cold, in a few minutes, from the computer.

1. **Authenticate the CLI (one-time, ~3 min, at the computer).** Open a terminal and run
   `gcloud auth login paulwivers@gmail.com`, then `firebase login:add` (choose paulwivers@gmail.com),
   approving with Windows Hello. This unlocks items 2–4 and lets Claude do live inspection. *(Or tell
   Claude "I'm at the computer" and it will re-drive the browser flow for you to approve the passkey.)*
2. **Set the Gemini server secret (B1, ~2 min).** After Plan `014` merges: `firebase functions:secrets:set GEMINI_API_KEY --project lifebalance-26080`, paste the key value. (Claude never sees the value.)
3. **Provision the admin claim (B2, ~2 min).** Run the script Claude prepares in Plan `009` (it calls `setCustomUserClaims(uid, {admin:true})`), sign out/in once, confirm admin pages still load, *then* approve the PR that deletes the UID branch. The runbook is in [`docs/DEPLOY_CHECKLIST.md`](../docs/DEPLOY_CHECKLIST.md) §1.
4. **Lock down the Gemini API key in Cloud Console (B1 stopgap, ~3 min).** Credentials → restrict the key to the Generative Language API + your prod origin(s) + a hard quota cap. (Skippable once item 2's proxy ships.)
5. **Stripe (Phase 2 only).** Create the Stripe account + business entity + bank, then `firebase functions:secrets:set STRIPE_SECRET_KEY` and set the webhook signing secret. Claude's billing code (Plan `050`) is built to receive these — full runbook ships with that plan.
6. **Legal sign-off (before public launch).** Have the Claude-drafted Privacy Policy + ToS (Plan `011`) reviewed/owned and replace the entity placeholders. Claude can't be your legal entity.
7. **Flip the switches (judgment).** When ready: flip the allowlist→open flag, set Firebase authorized domains, point a domain at the landing page, and approve/watch the rules-changing PRs deploy.

Optional accounts that unlock dormant code Claude will pre-wire: Sentry (error tracking), an email
provider (recap emails), PostHog (if you want more than Firebase Analytics).

---

## 5. Sequencing & exit gates

**Dependency notes**
- `003` (protobufjs) and `004` (CSP) are independent and ship first — pure safety, low risk.
- `010` (rules tests) **must precede** any `firestore.rules` change (`009` admin claim, `051`
  entitlements). No rules edit reaches prod without rules tests.
- `009` (delete UID branch) **depends on** the human completing Human-Checklist #3 (claim provisioned)
  — STOP condition baked into the plan.
- `040` (bound listeners) and `064` (notification scan) ship their Firestore **indexes first**, then
  the query change (indexes take time to build; a human watches the index finish).
- Phase 2 code (`050-052`) can be **built** anytime (dormant), but only **activated** after Human-
  Checklist #5.

**Per-phase exit criteria** are in §3. The one rule that doesn't change: **critical blockers (Phase 0)
before anything; retention (Phase 1) before monetization (Phase 2); monetization before growth spend.**

---

## 6. What Claude is doing on this autonomous run

Tonight's session executes the **low-risk, high-value, fully-verifiable `[C]` items in Phase 0**
first — the ones that meet the "tested, no regressions" bar without judgment calls — each on its own
branch, gated by `pnpm lint` + `pnpm test`, shipped as a PR. Risky (`rules`, money-model) and
`[C→H]` items are written up as plans for review rather than auto-merged. Progress and per-task
status live in [`plans/README.md`](./README.md).
