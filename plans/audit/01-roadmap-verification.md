# Roadmap Verification Audit — `docs/PRODUCT_ROADMAP.md`

**Auditor:** Read-only pass (no code changed)  
**Date verified:** 2026-06-21  
**Playbook:** `~/.claude/skills/improve/references/audit-playbook.md` — Finding format + §9 Direction read.

---

## Claim-by-Claim Verdict Table

| # | Roadmap Claim | Verdict | Evidence |
|---|---------------|---------|----------|
| B1 | `geminiService.ts` reads `VITE_GEMINI_API_KEY` at ":67" | **CORRECTED (line off)** | Key is read at `services/geminiService.ts:68` (not :67). `import.meta.env.VITE_GEMINI_API_KEY` — inlined into shipped JS at build time. Claim substance is correct; line number is off by 1. |
| B2 | `firestore.rules` hardcodes super-admin UID at ":31" | **CORRECTED (line off)** | `isSuperAdmin()` is defined at `firestore.rules:28–31`. The hardcoded UID `nmYdn3QPsNQEvniJEXW9M3lmV5e2` appears at line **31** (the `request.auth.uid ==` branch). Comment at line 24–27 says "TODO: remove the UID fallback." The function shape is: check `request.auth.token.get('admin', false) == true` OR the hardcoded UID. Claim is substantively correct; line numbers match. Already tracked in `docs/DEPLOY_CHECKLIST.md`. |
| B3 | "No account/household deletion" | **PARTIALLY STALE** | `deleteHousehold` Cloud Function does not exist (confirmed: only `quickAdd*`, `sendhabitreminders`, `sendactionqueuereminders`, `sendstreakwarnings`, `sendbillreminders`, `sendbudgetalerts`, `sendtestnotification` in `functions/src/index.ts`). **However**, `deleteAccount` (individual bank account) does exist and is wired to a UI button: `contexts/FirebaseHouseholdContext.tsx:1817` + `components/budget/BudgetAccounts.tsx:94`. The roadmap claim is about *household* deletion, which is confirmed absent. The claim title "No account/household deletion" is misleading — account deletion exists; household deletion does not. |
| B4 | `exportUtils.ts` exists but "not wired to a button" | **STALE** | `utils/exportUtils.ts` exists and exports `generateJsonBackup`, `convertToCSV`, `generateCsvExport`. `generateCsvExport` IS wired to a button: imported and called in `pages/Habits.tsx:15` (an "Export habits to CSV" button, tested in `pages/Habits.Export.test.tsx:100`). The roadmap claim that it's "not wired to a button" is incorrect for habits; it may remain unwired in Settings for a full-data export. |
| B5 | No Privacy Policy / ToS / consent | **CONFIRMED** | No privacy, terms, or consent route or component found anywhere in `pages/`, `components/`, or `App.tsx`. Zero references in any `.ts`/`.tsx` file. Roadmap claim is correct. |
| 6 | `refreshInsight` at `FirebaseHouseholdContext.tsx:3614`; insights on-tap only, not automatic | **CONFIRMED (line matches)** | `refreshInsight` defined at line **3614**. It calls `generateInsight` (imported dynamically at line 3636). No `useEffect`, scheduler, `setInterval`, or Cloud Function trigger auto-calls `refreshInsight`. It is purely user-initiated. Confirmed: on-tap only. |
| 7 | "93 test files", "~86% coverage on utils/" | **CORRECTED** | Project-owned test files (excluding `node_modules`): **32 `.test.ts`** + **54 `.test.tsx`** = **86 test files** (not 93). Coverage thresholds in `vite.config.ts:39–45` are set at **lines/statements 78%, functions 82%, branches 70%** for `utils/**`. The roadmap says "~86% coverage on utils/" — the threshold gate is 78%, not 86%. The comment in `vite.config.ts` (line 33) cites a current aggregate of ~81.8% lines / ~85.9% functions. The "~86%" figure appears to conflate function coverage with overall coverage. |
| 8 | "5 Cloud Functions" | **CORRECTED** | `functions/src/index.ts` exports **11 named functions**: 5 from the quickAdd barrel (`quickAddHabit`, `quickAddExpense`, `quickAddReceipt`, `quickAddShoppingItem`, `quickAddNaturalLanguage` — all `onRequest` HTTPS) + 4 scheduled (`sendhabitreminders`, `sendactionqueuereminders`, `sendstreakwarnings`, `sendbillreminders`) + 1 Firestore-triggered (`sendbudgetalerts` on `households/{id}/accounts/{id}`) + 1 callable (`sendtestnotification`). Total: **11 exported functions**, not 5. The "5" likely only counted the quickAdd group without the notification functions. |
| 9 | "USD-only, no currency field anywhere" | **CONFIRMED** | `types/schema.ts` has zero `currency` fields. Codebase-wide search finds `currency` only as: a comment in `utils/money.ts:2` ("currency arithmetic"), a comment in `functions/src/quickAdd/index.ts:312` (parsing currency strings), and a test comment in `components/budget/BudgetAccounts.test.tsx:137`. No `currency` field on any type. Confirmed USD-only. |
| 10 | "English hardcoded, i18n 0/10" | **CONFIRMED** | Files matching i18n/locale/intl/translation/lang patterns: 11 matches, all are unrelated (e.g., `lang` in todo content strings or date-fns locale). No i18n library, no locale files, no translation keys. All UI strings are hardcoded English. |
| 11 | "Beta allowlist gating / Private Alpha" | **CONFIRMED** | `contexts/AuthContext.tsx:83–108`: on sign-in, if `VITE_ADMIN_UID` is set (production) and user is not the admin and has no existing household, a Firestore query on `beta_testers` collection checks `email == firebaseUser.email` and `status === 'active'`. Unauthorized users are signed out and their email is recorded in `accessDeniedEmail` state. Existing household members bypass the check. Confirmed functional gating. |
| 12 | "Monetization infra 0/10 — no billing/plans/paywall" | **CONFIRMED** | Grep for `stripe`, `subscription`, `billing`, `paywall`, `entitlement` across all `.ts`/`.tsx` files: zero hits (26 files matched on `plan` but all are `MealPlanItem`/`mealPlan`/`weeklyPlan` — meal planning, not billing plans). No monetization infrastructure whatsoever. |
| 13 | "Invite codes exist; no referral/sharing" | **CONFIRMED** | 6-character invite code flow confirmed: `utils/inviteCodeGenerator.ts` (+ `.test.ts`), `services/householdService.ts` `joinHousehold()`, `pages/HouseholdSetup.tsx`, `components/auth/HouseholdInviteCard.tsx`. No referral system, no shareable link, no tracking of who referred whom. |
| 14 | "`VITE_FIREBASE_MEASUREMENT_ID` already in env but unused — analytics not initialized" | **CONFIRMED** | `firebase.config.ts:44`: `measurementId` passed into `firebaseConfig` object. No `getAnalytics()`, `initializeAnalytics()`, or any Firebase Analytics SDK call anywhere in the codebase. The config value is included but Analytics is never initialized. |
| 15 | "Unbounded listeners (todo/14)" — cited listeners' current state | **CONFIRMED (still unbounded)** | `todo/14-unbounded-calendar-meals-grocery-listeners.md` cites lines 839, 997, 1017 in `FirebaseHouseholdContext.tsx`. Verified: `contexts/FirebaseHouseholdContext.tsx:839` — `calendarItems` query with no `limit` or date filter; `:997` — `meals` query with no `limit`; `:1017` — `groceryCatalog` query with no `limit`. All three listeners remain unbounded. The fix described in todo/14 has NOT been implemented. |
| 16 | Scorecard sanity checks | See findings below | |

---

## Findings (Finding Format)

### [SECURITY-01] Hardcoded super-admin UID in Firestore rules — already tracked

- **Evidence**: `firestore.rules:31` — `request.auth.uid == "nmYdn3QPsNQEvniJEXW9M3lmV5e2"` as fallback in `isSuperAdmin()`. Comment at :24 acknowledges it and has a TODO.
- **Impact**: If the account tied to this UID is ever compromised, attacker has read/write access to every household's financial data.
- **Effort**: S (2 hours — provision `admin` custom claim via Admin SDK, remove UID branch, redeploy rules)
- **Risk**: LOW — removing the UID branch after the claim is provisioned is safe; existing admin access via the claim is unaffected.
- **Confidence**: HIGH (read the code, certain)
- **Fix sketch**: Run `admin.auth().setCustomUserClaims(uid, { admin: true })` once, verify `isSuperAdmin()` works via the claim path, delete the `request.auth.uid ==` branch from rules, redeploy. Already tracked in `docs/DEPLOY_CHECKLIST.md`.

---

### [SECURITY-02] Client-side Gemini API key inlined into shipped JS — already tracked

- **Evidence**: `services/geminiService.ts:68` — `import.meta.env.VITE_GEMINI_API_KEY` inlined at Vite build time into the JS bundle shipped to browsers.
- **Impact**: Any user (or competitor) can extract the key from the bundle and make unconstrained Gemini API calls at the developer's cost.
- **Effort**: M (1 weekend — create a Cloud Function proxy, move key server-side, update call sites)
- **Risk**: MED — requires restructuring AI call paths; existing Cloud Functions infra reduces risk.
- **Confidence**: HIGH
- **Fix sketch**: Create a `callGemini` Cloud Function. Move `VITE_GEMINI_API_KEY` to a server-side secret. Replace direct `@google/genai` SDK calls in `geminiService.ts` with `httpsCallable` calls to the new function. Already tracked in `docs/DEPLOY_CHECKLIST.md`.

---

### [CORRECTNESS-01] Roadmap undercounts Cloud Functions — 11 exported, not 5

- **Evidence**: `functions/src/index.ts` — 5 quickAdd HTTPS functions (lines 68, 260, 487, 578, 951) + 4 scheduled + 1 Firestore-triggered + 1 callable = 11 total.
- **Impact**: Roadmap readers may underestimate the existing notification infrastructure when planning billing-related Cloud Functions. Scheduling complexity is understated.
- **Effort**: S (update the roadmap doc)
- **Risk**: LOW
- **Confidence**: HIGH
- **Fix sketch**: Update the claim in `docs/PRODUCT_ROADMAP.md` from "5 Cloud Functions" to "11 Cloud Functions (5 quickAdd HTTPS, 4 scheduled notification, 1 Firestore-triggered budget alert, 1 callable test notification)."

---

### [CORRECTNESS-02] B4 claim that exportUtils "not wired to a button" is incorrect

- **Evidence**: `pages/Habits.tsx:15` imports `generateCsvExport`; `pages/Habits.Export.test.tsx:100` tests an "Export habits to CSV" button that calls it.
- **Impact**: The roadmap presents B4 as an unimplemented export gap. In reality habits CSV export exists. The true gap is a *full-data backup* (all accounts, transactions, etc.) in Settings, which remains unwired.
- **Effort**: S (update roadmap; separately, M to wire full-data export in Settings)
- **Risk**: LOW
- **Confidence**: HIGH
- **Fix sketch**: Narrow the B4 claim to "no full-data export in Settings." The `generateJsonBackup` function in `exportUtils.ts` exists and could be wired to a "Download my data" button in `pages/Settings.tsx`.

---

### [TECH-DEBT-01] Three unbounded Firestore listeners not yet fixed (todo/14)

- **Evidence**: `contexts/FirebaseHouseholdContext.tsx:839` (`calendarItems`), `:997` (`meals`), `:1017` (`groceryCatalog`) — all `query(collection(...))` with no `limit()` or date filter. `todo/14-unbounded-calendar-meals-grocery-listeners.md` documents the problem and proposed fix.
- **Impact**: Cold-start Firestore reads grow unboundedly with household age. A household with 2 years of calendar items, 100 meals, and a large grocery catalog will load everything on every session start, increasing latency and Firebase read costs.
- **Effort**: L (multi-day — each collection needs a different windowing strategy per todo/14)
- **Risk**: HIGH — incorrect windowing could silently break Safe-to-Spend expansion, recipe search, or shopping catalog suggestions.
- **Confidence**: HIGH
- **Fix sketch**: Implement the three-phase plan in `todo/14`: groceryCatalog limit(200) first (lowest risk), then meals limit(50) with lazy cookbook load, then calendarItems (keep all recurring templates; window only materialized instances).

---

### [DIRECTION-01] Analytics infrastructure gap blocks monetization metrics

- **Evidence**: `firebase.config.ts:44` — `MEASUREMENT_ID` is in the Firebase config but `getAnalytics()` is never called. No event tracking anywhere in the codebase.
- **Impact**: The roadmap correctly calls this out; confirmed by code. Without analytics: no funnel visibility, no conversion tracking, no evidence to show investors or to validate pricing decisions. This is a prerequisite to the "metrics that make you fundable" section of the roadmap.
- **Effort**: S–M (Firebase Analytics + a few key event calls: sign_up, habit_completed, insight_generated, paycheck_approved)
- **Risk**: LOW — additive change; Analytics SDK is already in the Firebase bundle
- **Confidence**: HIGH

---

### [DIRECTION-02] Test count (86) vs roadmap claim (93) — minor but worth correcting

- **Evidence**: Counted 32 `.test.ts` + 54 `.test.tsx` files under the project root (excluding `node_modules`). Roadmap says "93 test files."
- **Impact**: Minor credibility issue if the roadmap is shared externally. The real count is still impressive.
- **Effort**: S (recount and update)
- **Confidence**: HIGH (direct file count)

---

## Summary of Largest Divergences from Roadmap

1. **Claim 8 (Cloud Functions count)**: Roadmap says 5; actual is 11. The notification infrastructure (4 scheduled + 1 Firestore-triggered + 1 callable) is fully built and shipped but uncounted. This materially affects the "what's built" assessment.

2. **Claim B4 (export not wired)**: Partially stale — habits CSV export is already wired and tested. The roadmap presents this as a complete gap when it's actually a narrower gap (full-data export in Settings only).

3. **Claim 7 (test count and coverage threshold)**: Roadmap says "93 test files" and "~86% coverage on utils/". Actual is 86 test files; the enforced threshold gate is 78% (lines/statements), not 86%. The ~86% number appears to be a snapshot of function coverage, not an overall or enforced floor.

---

## Additional Issues Noticed While Verifying

**Not in the roadmap at all:**

- **`sendtestnotification` callable has a dead security check** (`contexts/AuthContext.tsx` pattern notwithstanding, in `functions/src/index.ts:555`: `if (userId !== request.auth.uid)` — `userId` is set from `request.auth.uid` at line 531, so this check is always false and never fires). This is a code correctness bug, not a security issue in this instance, but the check provides zero protection.

- **`isTimeToSend` in `functions/src/index.ts:124` ignores minutes entirely** — it checks only the hour, meaning every scheduled notification fires for the full 60-minute window in which the hour matches, not just the user's chosen time. If a Cloud Function is cold-started multiple times in the same hour, a user could receive duplicate notifications. This is a correctness issue not mentioned in the roadmap.

- **No `getAnalytics` import** in `firebase.config.ts` or anywhere — confirmed, analytics is a dead config entry, not a roadmap item that was addressed.
