# Plan 02 — Weekly Recap + Proactive Insight Engine

**Impact:** HIGH (retention loop + the substance behind the premium tier) · **Effort:** M
(2–4 days) · **Risk:** MED (new scheduled function; Gemini cost; notification fatigue)
· **Confidence:** HIGH

## Context an executor needs

LifeBalance already *sells* this feature without having built it:

- `components/modals/PaywallModal.tsx:30` markets "proactive insights" / weekly recap.
- `utils/entitlements.ts` defines `recapEnabled` (line 30): `false` in `FREE_LIMITS`
  (line 49), `true` in `PREMIUM_LIMITS` (line 61). `getPlan(household)` (line 71) reads
  `household.subscription`.
- Insights exist but are **button-triggered only**: `refreshInsight` in
  `contexts/FirebaseHouseholdContext.tsx:4588-4635` calls `generateInsight`
  (`services/geminiService.ts:1125`), which sends the last 50 transactions + all habits
  to Gemini via the **server-side proxy** (`geminiproxy` function; the client has no API
  key) and writes to `households/{id}/insights` (`Insight` type: `types/schema.ts:624`).
- Push infra is mature: FCM tokens on `households/{id}/members/{uid}`
  (`fcmTokens`, `notificationPreferences` — `types/schema.ts:60-61`), send helper
  `sendNotificationToUser` and hourly scheduled jobs in `functions/src/index.ts`
  (pattern at lines 180-225), SW click-routing in `public/sw.js:29-51`.
- Cloud Functions live in the `functions/` pnpm workspace (TypeScript, strict, tested
  with vitest; see `functions/src/quickAdd/*.test.ts` for the house test style).
  Server-side Gemini access already exists in `functions/src/` (the `geminiproxy`
  function holds the `GEMINI_API_KEY` secret) — reuse that secret/pattern, never a
  `VITE_` key.

## What to build

### A. `generateweeklyrecap` scheduled function (the core)

New module `functions/src/recap/` (keep `index.ts` thin; put logic in testable pure files):

1. **Schedule:** `onSchedule("every sunday 17:00", ...)` is wrong for per-user timezones —
   instead run **hourly on Sundays** (`0 * * * 0`) and, per member, send when the member's
   local time matches a default 17:00 (reuse the existing `isTimeToSend`/`formatInTimeZone`
   timezone pattern from the reminder jobs — see `functions/src/index.ts:180-225` and the
   timezone handling described in CLAUDE.md). Dedupe at TWO levels, because household
   members can live in different timezones and reach Sunday 17:00 at different hours:
   **generation** dedupes at the household level (a `lastRecapWeek` ISO-week marker on
   the recap doc — generate once, first member to hit the window triggers it), while
   **push delivery** dedupes per member (`lastRecapSentWeek` on the member doc). A
   household-level skip alone would silently drop the push for members in later
   timezones once the first member's send lands.
2. **Data assembly (pure function, unit-tested):** for the household's trailing 7 local
   days: total verified spend vs. prior week, top 3 category deltas, Safe-to-Spend
   trajectory (reuse nothing from the client — recompute simply from transactions +
   accounts read server-side), habit completions + streaks at risk (habit docs carry
   `streakDays`, `completedDates`), points earned per member, upcoming week's bills
   (calendar items due in the next 7 days). Keep the assembly deterministic and Gemini
   OPTIONAL: the recap must render fully from computed numbers even if the AI call fails.
3. **Narrative (Gemini, best-effort):** one call producing a 2–3 sentence warm summary +
   one actionable suggestion, from the assembled numbers only (never raw merchant lists —
   pass pre-aggregated category totals). On failure/quota, fall back to a template string.
   Follow the retry/timeout conventions in `services/geminiService.ts` (30s timeout,
   bounded backoff) as implemented server-side in the proxy.
4. **Persistence:** write to `households/{id}/recaps/{isoWeek}` — a new `WeeklyRecap`
   interface in `types/schema.ts` (mirror the shape into `functions/src` types; the two
   codebases don't share a package — see how `HouseholdMember` is duplicated today).
   Add a converter in `utils/firestoreConverters.ts` + unit test (house rule: every
   collection has a typed converter, well-formed + partial-doc tests).
5. **Gating:** generate for ALL households (cost is one Gemini call/household/week — cheap);
   gate *delivery richness* by plan: free households get the recap card with the
   headline numbers and a blurred/locked narrative section driving the paywall
   (`recapEnabled` in `utils/entitlements.ts:84` via `getLimits`); premium gets
   everything + the push. While `billingEnabled` is off (see
   `services/appConfig.ts:85-106`), treat everyone as premium — same convention the
   AI-cap code uses (`services/geminiService.ts:209-212`).
6. **Push:** to each member with `notificationPreferences.weeklyRecap?.enabled !== false`
   (add this pref key to the `NotificationPreferences` type + the Settings notifications
   UI, `components/settings/NotificationSettings.tsx`), deep-linking `/?recap=<isoWeek>`.

### B. Client recap card

- `components/dashboard/WeeklyRecapCard.tsx`: renders the latest recap doc (subscribe to
  the last 1–2 recap docs in the finance or core slice of
  `contexts/FirebaseHouseholdContext.tsx`, following the bounded-listener pattern at
  `:976` `limit(BUCKET_HISTORY_LIMIT)`). Show Sunday→Wednesday, dismissible
  (localStorage), styled per DESIGN.md (evergreen for money numbers, amber for habit
  numbers, `PageHeader`/`Section`/`SurfaceList` primitives, bottom-sheet detail view via
  the existing `Drawer`).
- Deep-link handling: on boot with `?recap=`, open the recap detail drawer.
- **Mock parity:** add recap state + a canned recap to `contexts/MockHouseholdContext.tsx`
  so Test Mode renders the card.

### C. Proactive insight triggers (piggyback, no new crons)

Inside existing scheduled jobs (`functions/src/index.ts`) — after Plan 06 lands they'll be
cheap — add two narrow triggers that write an `Insight` doc (same collection the manual
button uses, so the existing UI renders them for free):

- **Budget anomaly:** during `sendbudgetalerts`' existing account-write trigger
  (`functions/src/index.ts:589`), if a bucket's verified spend crosses 90% of its limit
  before day 70% of the period, write an insight (max 1/bucket/period, marker field).
- **Streak rescue:** in `sendstreakwarnings` (`:310`), when a ≥7-day streak is hours from
  breaking, also write an insight suggesting the freeze bank if tokens are available.

Cap proactive insights at 2/week/household (check before write) — notification and card
fatigue is the failure mode of this whole feature class.

## Firestore rules & indexes

`recaps` subcollection needs rules: members read; **client writes denied** (server-only via
Admin SDK, which bypasses rules — so simply omit any client write allowance). Rules changes
ship in their own PR behind the emulator rules tests (`pnpm --filter functions` — find the
exact script in `functions/package.json`; the harness from PR #641 lives in the repo) with
a human watching the deploy. No composite index needed for `limit(2)` newest-first reads if
you key docs by ISO week and query `orderBy(documentId)` — verify in the emulator.

## Verification & done criteria

1. Pure assembly function: unit tests covering week boundaries (local-TZ Sunday), empty
   households, no-transactions weeks, streak-at-risk detection. `pnpm lint:all && pnpm test` green.
2. Emulator run: seeded household produces a recap doc with correct numbers; second run
   same week is a no-op (`lastRecapWeek` dedupe).
3. Gemini failure path: force the AI call to throw → recap still written with template
   narrative; function completes without error.
4. Test Mode (`pnpm dev` + `/#/login?test=true`): recap card renders from mock data,
   drawer opens, dismiss persists.
5. Track `recap_viewed` / `recap_push_opened` (Plan 01's `track()`), so week-1 engagement
   of this feature is measurable.
6. CLAUDE.md: add a short "Weekly recap" paragraph to the architecture section.

## Out of scope

Email delivery (no email infra exists), month-end reports, per-member personalized
narratives, any Stripe/billing flips (Plan 09).
