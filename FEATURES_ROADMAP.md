# LifeBalance — Features Roadmap

This document is a catalog of **candidate features**, produced by a multi-agent codebase
exploration + ideation + critic pipeline on **2026-07-13**. Seven domain agents read the actual
code and proposed features grounded in real files/mutations/patterns; a critic pass then proposed
cross-cutting ideas the domain-scoped agents couldn't see. This file is the synthesis: deduped,
cross-referenced against `TODO.md`, and organized for a future agent (human or AI) to pick one
item and implement it without needing this conversation's context.

**This file is features only.** Bugs, perf/security hardening, ops gates, and other non-feature
backlog live in `TODO.md` — that remains the single source of truth for "what's broken / what
needs a human." Do not duplicate items between the two; where a workflow idea overlapped existing
`TODO.md` items, it was dropped here with a cross-reference instead of being re-listed.

## How to use this doc

Pick an item, read its **Implementation notes** and **Key files**, and go — each entry names the
actual mutations/components/patterns to extend rather than describing the feature abstractly.
Sizes are rough-order-of-magnitude effort (tweak < small < medium < large < suite); "suite" items
are multi-PR efforts that should be sequenced, not shipped as one PR. Nothing here is greenlit —
these are candidates for a product-scope conversation, same as `TODO.md` §3.

**Conventions** (see `CLAUDE.md` for full detail): pnpm only, never npm; `@/` imports only
(no parent-relative `../`); money is stored/passed as **decimal dollars** — `utils/money.ts`
helpers sum in integer cents internally but never write cents to Firestore; "today" comes from
`getLocalDateString()`, never `new Date().toISOString()`; strict TypeScript, zero lint/type
suppressions without a tracked justification (see `LINT_SUPPRESSIONS.md`); any `firestore.rules`
/ `firestore.indexes.json` change ships in its own small, human-watched PR (tagged `[rules]` /
`[index]`); atomic multi-document mutations use a single `writeBatch` (see CLAUDE.md's Atomicity
paragraph for the existing examples to mirror).

---

## Index

| ID | Title | Domain | Size | Value | Hook | Human Notes for AI agent (if empty, no notes / ready to implement) |
|---|---|---|---|---|---|---|
| F-MONEY-01 | Pay a bill with the actual amount | Money | small | high | Enter real amount at pay-time for variable bills | |
| F-MONEY-02 | Daily spend pace indicator | Money | small | high | "$X/day until payday" derived from Safe-to-Spend | |
| F-MONEY-03 | Bucket rollover | Money | medium | high | Carry unspent bucket limit into next period | Optional, user settings flag |
| F-MONEY-04 | Credit card due-date tracking + reminders | Money | medium | high | Push reminder before a card's statement due date | Optional, user settings flag like all push notifications|
| F-MONEY-05 | Subscriptions / recurring-spend dashboard | Money | medium | high | "$X/month on subscriptions" rollup | Users will need a way to mark recurring bills as a subscription so that it's not just every single bill = subscription |
| F-MONEY-06 | Monthly Money Recap | Money | suite | high | Budget-vs-actual close-out, Weekly Recap's money sibling | |
| F-MONEY-07 | Sweep Safe-to-Spend leftover into a savings goal | Money | small | medium | One-tap move unallocated leftover to a goal | |
| F-MONEY-08 | Archive an account instead of hard-deleting | Money | small | medium | Soft-delete preserves transaction history fidelity | |
| F-MONEY-09 | Net worth history + trend chart | Money | medium | medium | Daily net-worth snapshot + Trends chart | |
| F-MONEY-10 | Export transactions to CSV | Money | tweak | medium | Self-service transaction export for taxes/reconciliation | |
| F-MONEY-11 | quickAddBillPay | Money | medium | medium | "Hey Siri, I paid rent" voice bill-pay | |
| F-MONEY-12 | Duplicate a calendar item | Money | tweak | low | Pre-fill add-form from an existing bill/item | |
| F-MONEY-13 | Shared expense splitting / IOU tracking | Money | large | high | Adult↔adult "who owes whom" Settle-Up view | Tie into email for users without accounts to get them to create an account (e.g. User enters an expense, taps split bill option, email goes to non-user letting them know the split amount and hten providing a one tap way to create an account |
| F-HABITS-01 | Habit pause / vacation mode | Habits & Gamification | medium | high | Planned multi-day break without burning freeze tokens | |
| F-HABITS-02 | Streak milestone celebrations | Habits & Gamification | medium | high | Distinct toast at 7/30/100/365-day streaks | Tie these into specific rewards (e.g. 30 day streak milestone = unlock reward, etc.) |
| F-HABITS-03 | Per-habit timed reminder push | Habits & Gamification | medium | high | Own time + days per habit, coalesced per window | Off by default for habits, user an toggle on for specific habits |
| F-HABITS-04 | Export habit history to CSV | Habits & Gamification | small | low | Same pattern as F-MONEY-10, habit data | |
| F-HABITS-05 | Archive a habit | Habits & Gamification | small | medium | Retire a habit without losing streak/points history | |
| F-HABITS-06 | Completion notes & mood | Habits & Gamification | small | medium | Lightweight journal on each habit submission | Add a toggle-able push notification, user-controlled flag in settings, and one tap open-reflection-drawer to save (tie these into insights, somehow) |
| F-HABITS-07 | Day-of-week completion pattern chart | Habits & Gamification | small | medium | Free, always-on non-AI insight chart | |
| F-HABITS-08 | "At risk today" streak filter chip | Habits & Gamification | tweak | medium | Triage which habits need attention right now | |
| F-HABITS-09 | Bulk "catch up yesterday's habits" | Habits & Gamification | small | medium | One tap completes yesterday's forgotten habits | |
| F-HABITS-10 | Nudge a housemate (partner-nudge) | Habits & Gamification | medium | high | Merged habits+notifications idea; ad-hoc peer push | |
| F-HABITS-11 | Custom color tags per habit category | Habits & Gamification | tweak | low | Bucket-color pattern reused for habit categories | |
| F-HABITS-12 | Per-member attribution + leaderboard | Habits & Gamification | large | high | Who actually did the shared chore, adult version | |
| F-HABITS-13 | Photo-verified habit completion (Gemini vision) | Habits & Gamification | suite | high | AI plausibility check on a chore photo | Hold off for now |
| F-HABITS-14 | No-spend day / weekend habit trigger | Habits & Gamification | medium | high | Nightly bank sync fires a habit for a day you didn't spend | **SHIPPED** — see detail section |
| F-MEALS-01 | Cost-per-meal tracking | Meals & Shopping | medium | high | "This week's dinners cost ~$87" | How do we do this without adding a ton of friction? |
| F-MEALS-02 | Meal-plan gap reminder push | Meals & Shopping | medium | medium | Sunday nudge when dinners are unplanned | User-settings flag |
| F-MEALS-03 | Dietary/allergy household profile | Meals & Shopping | medium | medium | Standing constraint auto-applied to AI meal calls | |
| F-MEALS-04 | "Cook at home" habit auto-credit | Meals & Shopping | small | medium | Marking a meal cooked auto-toggles a linked habit | |
| F-MEALS-05 | Leftover / "use it up" nudge | Meals & Shopping | tweak | medium | Stale catalog items surfaced on the shopping list | Hold off for now |
| F-MEALS-06 | Recipe rating prompt after cooking | Meals & Shopping | tweak | medium | Inline star-rate right after marking cooked | |
| F-MEALS-07 | Multi-store shopping route ordering | Meals & Shopping | small | medium | Group + order shopping list by store visit order | |
| F-MEALS-08 | Recipe tag filter + smart collections | Meals & Shopping | small | medium | Browse 50+ recipes with tag chips + smart filters | |
| F-MEALS-09 | Multi-item paste import to shopping list | Meals & Shopping | small | medium | Paste an ingredient block, parse into items | |
| F-MEALS-10 | "Repeat last week's shop" | Meals & Shopping | tweak | medium | Re-add everything purchased on the last trip | |
| F-MEALS-11 | Portion-scaling (servings multiplier) | Meals & Shopping | tweak | medium | Scale ingredient quantities for the shopping handoff | |
| F-MEALS-12 | Recipe photo attachment | Meals & Shopping | small | low | Personal photo on a saved recipe | Make sure we appropriately compress image size |
| F-MEALS-13 | Shopping list collaborative presence | Meals & Shopping | small | low | "Sam is shopping" live indicator | How would we even track this? |
| F-MEALS-14 | Weekly meal-plan + shopping print export | Meals & Shopping | tweak | low | Fridge-friendly print view of the week | |
| F-TODO-01 | Recurring / repeating to-dos | To-Dos & Lists | large | high | #1 flagged gap; auto-spawn next instance on completion | |
| F-TODO-02 | Completion points for every member | To-Dos & Lists | medium | high | Extend kid-only to-do points to any assignee | |
| F-TODO-03 | Task templates ("Quick Task Lists") | To-Dos & Lists | medium | high | QuickStockList pattern applied to chores | |
| F-TODO-04 | Chore rotation & fairness suite | To-Dos & Lists | suite | high | Rotating assignment + fairness indicator | |
| F-TODO-05 | "Who does what" completion analytics | To-Dos & Lists | large | medium | Per-member completion/on-time-rate bar chart | |
| F-TODO-06 | Photo-to-tasklist | To-Dos & Lists | small | medium | Snap a whiteboard/note into multiple to-dos | |
| F-TODO-07 | quickAddTodo iOS Shortcuts endpoint | To-Dos & Lists | medium | medium | Siri phrase creates a to-do | |
| F-TODO-08 | Subtask checklist within a task | To-Dos & Lists | medium | medium | Steps inside one to-do instead of many top-level tasks | |
| F-TODO-09 | Assignee filter chips | To-Dos & Lists | small | medium | One-tap filter to a single member's tasks | |
| F-TODO-10 | Batch reassign in FAB | To-Dos & Lists | small | medium | Bulk move tasks from one person to another | |
| F-TODO-11 | Instant undo toast on completion | To-Dos & Lists | tweak | medium | DeleteUndoToast pattern ported to task completion | |
| F-TODO-12 | Sort control for sections/quadrants | To-Dos & Lists | tweak | low | Due date / Alphabetical / Assignee sort | |
| F-TODO-13 | Notes indicator + inline expand | To-Dos & Lists | tweak | low | Surface the already-stored `notes` field on the row | |
| F-DASH-01 | Dashboard universal AI quick-capture bar | Dashboard & AI | medium | high | Natural-language capture without opening a modal | Hold off for now |
| F-DASH-02 | AI Daily Briefing push notification | Dashboard & AI | suite | high | Proactive one-sentence morning summary push | |
| F-DASH-03 | Habit Coach card | Dashboard & AI | medium | high | Wires up already-shipped `analyzeHabitPatterns` | |
| F-DASH-04 | Itemized receipt line-item splitting | Dashboard & AI | large | high | Split a mixed-category receipt into several transactions | |
| F-DASH-05 | Scoped insight regeneration | Dashboard & AI | small | medium | Spending / Habits / Surprise-me insight lens | |
| F-DASH-06 | AI usage transparency meter | Dashboard & AI | small | medium | "X of Y AI requests used today" | |
| F-DASH-07 | Streaks-at-risk quick actions in recap | Dashboard & AI | small | medium | "Mark done today" button inline in the recap drawer | |
| F-DASH-08 | Point-rebalance nudge | Dashboard & AI | medium | medium | Wires up already-shipped `analyzeHabitPoints` | |
| F-DASH-09 | Shareable weekly recap card | Dashboard & AI | medium | medium | Spotify-Wrapped-style shareable image | |
| F-DASH-10 | "Explain this number" tap-to-ask AI | Dashboard & AI | medium | medium | On-demand one-sentence explanation of a stat | |
| F-DASH-11 | Insight thumbs up/down feedback | Dashboard & AI | tweak | medium | First quality signal on AI insight output | I like this a lot but we need to then be able to use the data to improve the AI prompts and responses automatically/dynamically, right? |
| F-DASH-12 | Insight archive filter and search | Dashboard & AI | small | low | Filter/search past insights | |
| F-DASH-13 | Tappable PulseStrip cells | Dashboard & AI | tweak | low | Spent/Consistency cells become navigation shortcuts | |
| F-NOTIF-01 | Quiet hours / do-not-disturb window | Notifications & Server Jobs | small | high | Global DND across all push categories | |
| F-NOTIF-02 | In-app notification inbox/history | Notifications & Server Jobs | medium | high | Bell icon feed of past pushes | |
| F-NOTIF-03 | Digest mode | Notifications & Server Jobs | medium | medium | One consolidated daily push instead of several | |
| F-NOTIF-04 | FCM token health & multi-device UI | Notifications & Server Jobs | small | medium | See/revoke registered push devices | |
| F-NOTIF-05 | Notification action buttons | Notifications & Server Jobs | medium | medium | "Mark Paid"/"Snooze" inline on the push itself | |
| F-NOTIF-06 | Smart bill-reminder lead time | Notifications & Server Jobs | small | medium | Suggest lead time from pay-cycle cadence | |
| F-NOTIF-07 | Web App Badging | Notifications & Server Jobs | small | medium | Unread count on the installed PWA icon | |
| F-NOTIF-08 | Low-balance alert tuning | Notifications & Server Jobs | small | medium | Percent/trend thresholds, not just a flat dollar amount | |
| F-NOTIF-09 | Weekly recap push teaser | Notifications & Server Jobs | tweak | low | Real headline stat in the push body | |
| F-NOTIF-10 | Per-type vibration pattern | Notifications & Server Jobs | tweak | low | Distinguish urgency by feel | |
| F-NOTIF-11 | Snooze a reminder type for N days | Notifications & Server Jobs | tweak | low | Temporary snooze vs. permanent disable | |
| F-PLAT-01 | PWA install prompt capture + banner | Platform & Growth | medium | high | Custom "Add to Home Screen" banner | |
| F-PLAT-02 | Freemium usage-limit nudge banners | Platform & Growth | large | high | In-context upgrade prompts at entitlement boundaries | Connected to flipping the web app to paid model |
| F-PLAT-03 | Post-onboarding setup checklist widget | Platform & Growth | medium | high | Dismissible activation-depth checklist | |
| F-PLAT-04 | In-app waitlist capture | Platform & Growth | medium | medium | Code-only alternative to a landing page | |
| F-PLAT-05 | Stripe customer billing portal | Platform & Growth | medium | medium | Self-serve card update/cancel via Stripe Portal | |
| F-PLAT-06 | Trial period on Stripe checkout | Platform & Growth | small | medium | 14-day free trial, data model already supports it | |
| F-PLAT-07 | Module visibility presets | Platform & Growth | small | medium | One-tap "Finance only"/"Everything" toggle bundles | Yes, but more options such as 'Lifestyle' or 'Habit's or something like that and 'Meals & Lists' or 'Productivity' and others that dynamically set the UI/UX |
| F-PLAT-08 | Regenerate invite code | Platform & Growth | small | medium | Rotate a leaked household invite code | |
| F-PLAT-09 | Feature-flag household allowlist targeting | Platform & Growth | medium | medium | Soft-launch a flag to specific households first | |
| F-PLAT-10 | GA4 user properties for segmentation | Platform & Growth | small | medium | Segment analytics by plan/module shape | |
| F-PLAT-11 | Onboarding funnel analytics | Platform & Growth | small | medium | Per-step drop-off events, not just one completion event | |
| F-PLAT-12 | Plan badge + limits summary in Settings | Platform & Growth | tweak | low | Surface `getPlan()`/`getLimits()` to end users | |
| F-PLAT-13 | "What's New" changelog drawer | Platform & Growth | small | low | Release highlights keyed off `APP_VERSION` | |
| F-XCUT-01 | Household activity log / audit trail | Cross-Cutting | medium | high | Who-did-what-when feed across every domain | |
| F-XCUT-02 | Dashboard widget customization | Cross-Cutting | medium | medium | Reorder/hide cards, persisted per-member | |
| F-XCUT-03 | Unified trash / recently-deleted recovery | Cross-Cutting | medium | medium | 30-day soft-delete + restore across 5+ domains | |
| F-XCUT-04 | Full household data export/backup (JSON) | Cross-Cutting | small | medium | One-click portable backup of everything | |
| F-XCUT-05 | Self-serve "Leave household" | Cross-Cutting | small | medium | Non-admin members can leave without an admin | |
| F-XCUT-06 | Accessibility: text size + high-contrast | Cross-Cutting | small | medium | Font scale + high-contrast theme variant | |

---

## Money

### F-MONEY-01 — Pay a bill with the actual amount (variable bills)

**Size:** small · **Value:** high · **Dependencies:** none

Today `payCalendarItem` always uses the calendar item's stored `amount` for both the balance
delta and the resulting transaction — there is no way to enter what you actually paid. Variable
bills (utilities, variable-rate cards) always drift from the budgeted figure. Add an optional
amount field to the "Pay Bill" flow so the user can enter the real amount at pay-time, with a
small toast/nudge ("Up $18 from last time") when it differs materially from the template.

**Why:** Confirmed by reading `contexts/household/mutations/calendarMutations.ts`'s
`makePayCalendarItem`: the balance delta (`item.type === 'expense' ? -item.amount : item.amount`)
and the created transaction's `amount` both hard-code `item.amount` with no override path. This
is a real, load-bearing gap for any household with a utility bill — the flow simply never
supported it.

**Implementation notes:** Extend `payCalendarItem`'s signature in `contexts/household/types.ts`
(`FinanceContextValue`) to accept an optional `{ actualAmount?: number }`. In
`makePayCalendarItem`, when `opts?.actualAmount` is provided use it (via `roundMoney`) instead of
`item.amount` for both the balance delta AND the transaction's `amount` field (keep the
recurring template's own `amount` as the budgeted anchor for future recurrences). Surface an
amount input in the pay-bill UI in `components/budget/BudgetCalendar.tsx`, defaulting to
`item.amount`, editable. For the price-change nudge, compare the entered amount to the item's own
`amount` (or, for recurring items, the most recent paid instance via `parentRecurringId`) and
`toast()` a delta message when the difference exceeds ~10%. Entirely additive — untouched call
sites (Action Queue swipe-approve) keep working via the optional param.

**Key files:**
- `contexts/household/mutations/calendarMutations.ts`
- `contexts/household/types.ts`
- `components/budget/BudgetCalendar.tsx`
- `utils/money.ts`

### F-MONEY-02 — Daily spend pace indicator ("$X/day until payday")

**Size:** small · **Value:** high · **Dependencies:** none

Show a derived "safe daily spend" figure — Safe-to-Spend divided by days remaining until the next
paycheck — next to the Safe-to-Spend headline (TopToolbar / SafeToSpendDetail), and optionally
per-bucket (remaining ÷ days left). Turns a lump-sum number into an actionable daily budget.

**Why:** All inputs already exist and are memoized: `safeToSpendBreakdown.safeToSpend` and
`.nextPaycheckDate` on `SafeToSpendBreakdown` (`utils/safeToSpendCalculator.ts`). Pure derived
display, no new state or Firestore reads.

**Implementation notes:** Add `utils/spendPace.ts`:
`calculateDailyPace(breakdown, today = getLocalDateString()): number | null` — returns `null`
when `nextPaycheckDate` is null or days-left <= 0, else `safeToSpend / daysBetween(...)` (use
`date-fns`'s `differenceInCalendarDays`, floor at 1 day to avoid `Infinity`). Surface as a
secondary line in `components/budget/SafeToSpendDetail.tsx` and/or
`components/budget/SafeToSpendBreakdownDrawer.tsx` ("≈ $42/day until payday"). For per-bucket
pace, apply the same days-remaining figure to each `BucketDistroRow.remaining`
(`utils/safeToSpendDistribution.ts`) in `BudgetBucketCard`. Never writes anywhere; never touches
the `safeToSpend` formula (respects the pool/overlay invariant — see CLAUDE.md).

**Key files:**
- `utils/safeToSpendCalculator.ts`
- `components/budget/SafeToSpendDetail.tsx`
- `components/budget/SafeToSpendBreakdownDrawer.tsx`
- `components/budget/BudgetBucketCard.tsx`

### F-MONEY-03 — Bucket rollover: carry unspent limit into next period

**Size:** medium · **Value:** high · **Dependencies:** none

A per-bucket opt-in toggle ("Roll over unspent") so a bucket's effective limit for the current
pay period is `limit + max(0, previousPeriodRemaining)` instead of always resetting flat. Useful
for irregular-cadence categories (car maintenance, gifts, annual subscriptions saved up over
several periods).

**Why:** The historical data already exists and is written every period close: each bucket's
`BucketPeriodSnapshot` (`types/schema.ts`) captures `limit`/`totalSpent`/`periodId`, exposed as
`bucketHistory` on the finance slice. This is additive to the bucket model and does not touch the
Safe-to-Spend formula — buckets are explicitly a display/tracking overlay, never subtracted from
`safeToSpend` (CLAUDE.md), so it can't destabilize core money math.

**Implementation notes:** Add `rolloverEnabled?: boolean` to `BudgetBucket`. Add a pure,
testable `getEffectiveBucketLimit(bucket, bucketHistory, currentPeriodId)` (new
`utils/bucketRollover.ts` or extend `utils/bucketSpentCalculator.ts`): find the most recent
`BucketPeriodSnapshot` for this bucket with `periodId < currentPeriodId`, compute its unspent
(`limit - totalSpent - totalPending`, floored at 0), add to `bucket.limit` when
`rolloverEnabled`. Thread the effective limit through `BudgetBucketCard`/`BudgetBuckets.tsx`
display and `computeSafeToSpendDistribution` (`utils/safeToSpendDistribution.ts`) so "remaining"
figures reflect it. Add the toggle to `components/modals/BucketFormModal.tsx`. Cap rollover
accumulation (never roll over more than N periods, or cap at some multiple of the base limit) to
avoid unbounded "phantom" limit growth — make this an explicit product decision in the toggle's
help text. Unit-test the pure helper against chained snapshots (2-3 period compounding).

**Key files:**
- `types/schema.ts`
- `utils/bucketSpentCalculator.ts` / new `utils/bucketRollover.ts`
- `utils/safeToSpendDistribution.ts`
- `components/budget/BudgetBuckets.tsx`, `components/budget/BudgetBucketCard.tsx`
- `components/modals/BucketFormModal.tsx`

### F-MONEY-04 — Credit card due-date tracking + payment reminders

**Size:** medium · **Value:** high · **Dependencies:** FCM push infrastructure (already live); optionally sequence after the TODO.md-planned 4-cron merge to avoid adding a 5th hourly job

Add optional `dueDayOfMonth` and `statementBalance` fields to credit `Account`s, surfaced as a
due-date chip on the account row and a reminder push ("Chase card payment due in 3 days — $412
statement balance") a few days before due, mirroring the existing bill-reminder pattern.

**Why:** The app already has a full notification-preference + scheduled-reminder pattern for
bills (`NotificationPreferences.billReminders`, `sendbillreminders`), but it only fires off
`CalendarItem` due dates — a credit card's own statement due date isn't a calendar item unless
manually created, so cards silently fall outside bill reminders today.
`CreditCardActivityWidget`/`accountImpactOf()` already model card debt correctly; this closes the
reminder gap for the payment itself.

**Implementation notes:** Add `dueDayOfMonth?: number` (1-28, sidesteps month-length edge cases)
and `statementBalance?: number` to `Account`, editable via a new field in the account drawer in
`components/budget/BudgetAccounts.tsx` (only when `type === 'credit'`). New scheduled Cloud
Function (or fold into the planned bill-reminder dispatcher merge) that, per-member-timezone
(`formatInTimeZone`, matching `sendbillreminders`/`sendstreakwarnings`), scans credit accounts
with `dueDayOfMonth` set, computes days-until-due (rolling to next month once past), and sends via
the shared FCM helper. Reuse or extend the `billReminders` preference. `statementBalance` is
purely informational — never feeds Safe-to-Spend or `Account.balance`, same non-authoritative
pattern as `plaidBalanceCurrent`.

**Key files:**
- `types/schema.ts`
- `components/budget/BudgetAccounts.tsx`
- `functions/src/index.ts`
- `utils/accountImpact.ts`

### F-MONEY-05 — Subscriptions / recurring-spend dashboard

**Size:** medium · **Value:** high · **Dependencies:** none

A dedicated view listing every recurring calendar expense item grouped with cadence and
monthly-equivalent cost, plus a "you spend $X/month on subscriptions & recurring bills" total —
the single most commonly requested budgeting feature for spotting forgotten subscriptions.

**Why:** `CalendarItem.isRecurring`/`frequency` already model this, and
`utils/calendarRecurrence.ts` already has robust expansion logic (`expandCalendarItems`,
month-end clamping). No new schema strictly required — read-only aggregation over existing data.

**Implementation notes:** Add pure `utils/subscriptionsSummary.ts`:
`summarizeRecurringItems(calendarItems)` filtering to
`isRecurring && frequency && type === 'expense' && !parentRecurringId` (templates only, mirrors
the filter already inside `expandCalendarItems`), normalizing to monthly-equivalent cost
(`weekly * 52/12`, `bi-weekly * 26/12`, `monthly` as-is, cent-safe via `utils/money.ts`), sorted
with a total. Render as a new tab/section — folded into `components/budget/BudgetCalendar.tsx` or
a new `components/budget/SubscriptionsView.tsx` wired into `pages/Budget.tsx`. Optionally
cross-reference verified `Transaction`s with the same recurring merchant/title (via
`matchMerchantNames` from `utils/habitSuggestions.ts`, already used by `actionQueueSmart.ts`) to
catch subscriptions never entered as calendar items — higher-value, higher-effort second pass;
ship the calendar-only version first.

**Key files:**
- `utils/calendarRecurrence.ts`, `types/schema.ts`
- `components/budget/BudgetCalendar.tsx`, `pages/Budget.tsx`
- `utils/habitSuggestions.ts`, `utils/money.ts`

### F-MONEY-06 — Monthly Money Recap — budget vs. actual close-out

**Size:** suite · **Value:** high · **Dependencies:** `BucketPeriodSnapshot` history (already written each period close); ideally sequenced after `billingEnabled` for premium-gating teeth, though it can ship dormant like Kid Mode did

A server-generated monthly (or pay-period) money recap — per-bucket over/under, total spend vs.
income, biggest single expense, month-over-month trend — delivered as push + in-app card,
structurally mirroring the already-shipped Weekly Recap but scoped to money.

**Why:** Directly reuses a proven, already-built pattern end-to-end: `WeeklyRecap` (server-written
doc, bounded newest-first listener via `RECAPS_LIMIT`/`weeklyRecapConverter`, premium-gated
narrative via `recap.premium`, push opt-out, `WeeklyRecapCard`/`WeeklyRecapDrawer` UI,
`recap_viewed`/`recap_push_opened` analytics — see CLAUDE.md's Weekly Recap section). A
money-focused monthly variant gives premium another concrete value prop via
`PlanLimits.recapEnabled`.

**Implementation notes:** New type `MonthlyMoneyRecap` (id = `yyyy-MM`, at
`households/{id}/moneyRecaps/{month}`) with `totalIncome`, `totalSpend`,
`bucketResults: {bucketId, bucketName, limit, spent, overUnder}[]` (group existing
`BucketPeriodSnapshot` docs by month — no new aggregation needed), `topExpense`, `netWorthDelta`
(reuse Net Worth History snapshots if F-MONEY-07 ships first), `narrative`/`narrativeSource`/
`premium` fields identical in spirit to `WeeklyRecap`. New scheduled Cloud Function modeled on the
existing weekly recap generator (locate via `functions/src/index.ts`'s exports, likely
`functions/src/recap/`). Client: bounded listener extending `useHouseholdCore()`'s `recaps`
pattern (or a sibling `moneyRecaps` field), a `MoneyRecapCard` dismissible via localStorage (same
idiom as `WeeklyRecapCard`), a `MoneyRecapDrawer`, premium-gating identical to
`WeeklyRecap.premium`. Genuinely suite-scale — plan as 3-4 sequenced PRs (schema+function,
listener+converter, card+drawer UI, premium-gating+analytics), the way Weekly Recap shipped.

**Key files:**
- `types/schema.ts`, `utils/listenerWindows.ts`, `utils/firestoreConverters.ts`
- `contexts/household/listeners`
- `components/dashboard/WeeklyRecapCard.tsx`, `components/dashboard/WeeklyRecapDrawer.tsx`
- `utils/entitlements.ts`, `functions/src/index.ts`

### F-MONEY-07 — Sweep Safe-to-Spend leftover into a savings goal

**Size:** small · **Value:** medium · **Dependencies:** none

In the Safe-to-Spend breakdown drawer, when "Unallocated" leftover is positive, offer a one-tap
"Move to a savings goal" action that contributes that amount to a chosen `SavingsGoal`.

**Why:** `computeSafeToSpendDistribution()` (`utils/safeToSpendDistribution.ts`) already computes
`leftover` as a first-class field, and `contributeToGoal(id, amount)` already exists on the
finance slice as a single cents-safe doc update. This wires two already-built pieces together.

**Implementation notes:** In `components/budget/SafeToSpendBreakdownDrawer.tsx`, near the
"Unallocated" `Row`, add a button visible only when `leftover > 0` and `savingsGoals.length > 0`.
Clicking opens a small goal picker (reuse `Select` or a mini `Drawer`) and calls
`contributeToGoal(goalId, leftover)`. This is a manual, user-confirmed action, fitting the
existing v1 "manual contributions only" design constraint on `SavingsGoal` — and since goals never
feed back into `safeToSpend`, sweeping money out of the leftover pool into a goal can't
double-count. Track with an analytics event like `sts_leftover_swept` (mirrors
`plaid_balance_adopted` in `services/analytics.ts`).

**Key files:**
- `components/budget/SafeToSpendBreakdownDrawer.tsx`
- `utils/safeToSpendDistribution.ts`, `contexts/household/types.ts`, `services/analytics.ts`

### F-MONEY-08 — Archive an account instead of hard-deleting it

**Size:** small · **Value:** medium · **Dependencies:** none

Add an "Archive" option alongside "Delete" on the account row. An archived account is hidden from
active lists, net worth, and Safe-to-Spend eligibility, but historical transactions keep
resolving to it correctly instead of orphaning.

**Why:** `deleteAccount` is a hard delete with no soft-delete concept; `resolveTargetAccount()`
(`utils/accountImpact.ts`) already has explicit fallback-to-checking logic for a transaction
tagged to a *deleted* account — exactly the failure mode archiving avoids (transactions silently
reassign to checking, losing which card a historical purchase was really on).

**Implementation notes:** Add `archived?: boolean` to `Account`. In `BudgetAccounts.tsx`, filter
main lists to `!a.archived` and add a collapsed "Archived accounts" section with an 'Unarchive'
action. Update `calculateSafeToSpendBreakdownFromExpanded`
(`utils/safeToSpendCalculator.ts`) and `sumPendingSpend`'s checking-id `Set` to exclude archived
accounts — otherwise a stale archived-checking balance keeps counting toward Safe-to-Spend. Add
`archiveAccount`/`unarchiveAccount` (simple `updateDoc`) to
`contexts/household/mutations/financeMutations.ts` and `FinanceContextValue`. Keep `deleteAccount`
for genuine mistakes — gate the destructive delete behind "has this account ever been referenced
by a transaction?" and steer to Archive when it has history.

**Key files:**
- `types/schema.ts`, `components/budget/BudgetAccounts.tsx`
- `contexts/household/mutations/financeMutations.ts`, `contexts/household/types.ts`
- `utils/safeToSpendCalculator.ts`, `utils/accountImpact.ts`

### F-MONEY-09 — Net worth history + trend chart

**Size:** medium · **Value:** medium · **Dependencies:** recharts (already a dependency, lazy-loaded per `vite.config.ts` `codeSplitting` groups)

Persist a periodic snapshot of total assets/liabilities/net-worth and render a trend line in
Money → Trends over the last N months.

**Why:** `BudgetAccounts.tsx` already computes `netWorth` live (cent-safe, `utils/money.ts`), but
nothing persists it over time — today's figure is a snapshot with no trend. The Trends tab already
lazy-loads recharts, so one more chart is on-pattern.

**Implementation notes:** New subcollection `households/{id}/netWorthSnapshots/{yyyy-MM-dd}`
(`{date, totalAssets, totalLiabilities, netWorth}`, decimal dollars). Write one snapshot per day
idempotently (`setDoc` merge:false keyed by date), either client-side once `accounts` has loaded
in `FirebaseHouseholdContext.tsx`, OR — cheaper/more reliable — server-side via a new scheduled
function reading every household's `accounts` and computing totals with a shared pure helper
(export `computeNetWorth(accounts)` from `utils/money.ts` or new `utils/netWorth.ts`, duplicated
server-side matching the `functions/src/entitlements.ts` pattern of a documented server-side copy
of client logic). Add a bounded newest-first listener (mirroring `RECAPS_LIMIT`/`recapConverter`)
on the finance slice, and a `NetWorthTrendChart` using the existing lazy recharts pattern in
`pages/Budget.tsx`'s Trends tab.

**Key files:**
- `utils/money.ts`, `components/budget/BudgetAccounts.tsx`
- `contexts/household/listeners/financeListeners.ts`, `utils/firestoreConverters.ts`, `utils/listenerWindows.ts`
- `pages/Budget.tsx`

### F-MONEY-10 — Export transactions to CSV

**Size:** tweak · **Value:** medium · **Dependencies:** none

Add an "Export" button to Money → Transactions (`TransactionMasterList`) that downloads full
transaction history as CSV (date, merchant, category, amount, status, account). Same underlying
pattern as F-HABITS-04's CSV export, applied to a different target/data shape — kept separate
since the mechanism (loader + fields) genuinely differs.

**Why:** The heaviest lifting — fetching every transaction, not just the windowed live set — is
already built and idempotent: `loadAllTransactions()` on the finance slice. Pure client-side, no
new Firestore reads, no schema change, no Cloud Function.

**Implementation notes:** In `TransactionMasterList.tsx`, add an export action near the existing
bulk-action bar (mirror the `selectedIds`/`handleBulkDelete`/`handleBulkVerify` pattern). On
click: `await loadAllTransactions()`, map to CSV rows via a small local `toCsv()` helper (no new
dependency needed), trigger download via `Blob` + `URL.createObjectURL` + a temporary
`<a download>`. Prefer raw decimal-dollar numbers plus a currency-code column over
`useFormatCurrency()`-formatted strings (more spreadsheet-friendly). Respect active filters by
offering "Export filtered" vs "Export all". No rules/schema change.

**Key files:**
- `components/budget/TransactionMasterList.tsx`
- `contexts/household/types.ts`, `hooks/useFormatCurrency.ts`

### F-MONEY-11 — quickAddBillPay — pay a bill via iOS Shortcut voice command

**Size:** medium · **Value:** medium · **Dependencies:** an active `HouseholdApiKey` with a new `bills` permission; iOS Shortcuts setup guide needs a new bill-pay template

A new `quickAddBillPay` HTTP Cloud Function ("Hey Siri, I paid rent") that marks a matching
upcoming calendar bill as paid from the household's default/checking account, extending the
already-shipped iOS Shortcuts quickAdd suite to bills (today only expenses, habits, shopping).

**Why:** `functions/src/quickAdd/index.ts` already has three fully-built endpoints
(`quickAddHabit`, `quickAddExpense`, `quickAddShoppingItem`) sharing API-key auth, rate limiting,
CORS allowlisting, audit logging — bills/calendar is the one domain quickAdd doesn't reach.
`quickAddHabit`'s title-lookup pattern (exact `titleLower`, then fuzzy fallback) is directly
reusable.

**Implementation notes:** Add `bills: boolean` to `ApiKeyPermissions` (extend the API key
creation UI). New endpoint in `functions/src/quickAdd/index.ts` following `quickAddHabit`'s
structure (CORS/OPTIONS/method/API-key/permission/rate-limit boilerplate;
`checkRateLimit(householdId, 'bill')` needs a new bucket name in `apiKeyValidation.ts`). Accept
`{title, today?}`, look up unpaid calendar items due within N days — note `calendarItems` has NO
server-side recurring expansion today, so this needs either matching against stored
templates/instances only, or porting a short-window version of `expandCalendarItems`'s core logic
server-side (similar to how `functions/src/plaid/payPeriod.ts` already ports client pay-period
logic). Reuse/generalize `fuzzyMatchHabit`/`normalizeHabitTitle`
(`functions/src/quickAdd/habitProcessor.ts`) for bill titles. On match, replicate
`payCalendarItem`'s writeBatch server-side with the Admin SDK, defaulting to the household's first
checking account. Budget a full day, not an afternoon — this is the most complex small/medium
item here because it requires porting calendar-item pay logic server-side.

**Key files:**
- `functions/src/quickAdd/index.ts`, `functions/src/quickAdd/apiKeyValidation.ts`
- `functions/src/quickAdd/habitProcessor.ts`, `functions/src/plaid/payPeriod.ts`
- `contexts/household/mutations/calendarMutations.ts`, `types/schema.ts`

### F-MONEY-12 — Duplicate a calendar item

**Size:** tweak · **Value:** low · **Dependencies:** none

Add a "Duplicate" quick action on a calendar item's detail view that pre-fills the Add-Event form
with the same title/amount/type, leaving date/recurrence for the user to adjust.

**Why:** Trivial glue over an existing mutation — `addCalendarItem` already accepts a full
`CalendarItem` and strips the `id`, so "duplicate" is just "open the add form pre-filled minus
id/isPaid/parentRecurringId."

**Implementation notes:** In the calendar item detail/edit affordance (`BudgetCalendar.tsx` or a
modal it opens), add a "Duplicate" button opening the add form with
`{...item, id: undefined, isPaid: false, parentRecurringId: undefined, isDeleted: undefined}` as
initial state, submitting via the existing `addCalendarItem`. Strip `isRecurring`/`frequency`
unless the user explicitly wants a duplicate recurring series (avoid two overlapping recurring
templates by accident).

**Key files:**
- `components/budget/BudgetCalendar.tsx`
- `contexts/household/mutations/calendarMutations.ts`, `contexts/household/types.ts`

### F-MONEY-13 — Shared expense splitting / IOU tracking between household members

**Size:** large · **Value:** high · **Dependencies:** meaningful with 2+ adult household members (already supported)

Let a transaction be marked split between members (e.g. a shared grocery run) with per-member
share amounts, and surface a running "who owes whom" balance in a new Settle-Up view.

**Why:** This is squarely a household-management feature currently entirely absent — every
transaction today implicitly belongs to the household as a whole. `HouseholdMember` already has a
stable `uid` to key shares against, and existing atomic-batch conventions
(`updateTransactionCategory`, `deleteTransaction`) give a clear template. Explicitly out of scope
for the kid-allowance IOU system (parent↔kid only, Plan 080) — this is adult↔adult.

**Implementation notes:** Add optional
`Transaction.splitWith?: Array<{memberId, shareAmount, settled?}>` (decimal dollars, validate
shares sum correctly client-side before save). The payer's account balance is unaffected —
splitting is a bookkeeping overlay exactly like buckets, so it must NOT alter
`accountImpactOf`/`effectiveAccountImpact` (`utils/accountImpact.ts`). Add pure
`utils/settlement.ts`: `computeMemberBalances(transactions, members)` netting unsettled shares
per member-pair (Splitwise-style). Add `markSplitSettled(transactionId, memberId)` (single
`updateDoc` toggling that member's `settled` flag — no balance change, so no batch needed). New
UI: a "Split" toggle in `TransactionReviewForm.tsx`/`EditTransactionModal`, and a new
`SettleUpView` rendering `computeMemberBalances()`'s output with "Mark settled" per pair. Genuine
multi-PR feature given schema + form UI + settlement math + new view + tests.

**Key files:**
- `types/schema.ts`
- `components/transactions/TransactionReviewForm.tsx`, `components/modals/EditTransactionModal.tsx`
- `utils/accountImpact.ts`, `contexts/household/mutations/transactionMutations.ts`, `contexts/household/types.ts`



## Habits & Gamification

### F-HABITS-01 — Habit pause / vacation mode

**Size:** medium · **Value:** high · **Dependencies:** none

Let a user mark a habit "paused until <date>" for a planned break (vacation, injury, kid's summer
break) so it's excluded from the auto-reset penalty and freeze-bank consumption during that
window, with the streak resuming cleanly afterward.

**Why:** The Freeze Bank (Plan 25) is explicitly a small, capped safety net for accidental misses
(2 tokens/month), not a mechanism for "I'm on a 10-day trip and don't want this habit or my
tokens burned the whole time." A deliberate pause is a different, common need the current model
has no answer for.

**Implementation notes:** Add `Habit.pausedUntil?: string` (yyyy-MM-dd). Extend `isHabitStale`
and `getHabitResetUpdate` (`utils/habitLogic.ts`) to skip the reset-to-0 penalty while
`pausedUntil >= today`. Extend `calculateStreak`/`calculateWeeklyStreak` (or callers) to treat the
paused range as bridging continuity the same way `frozenDates` already does — cleanest
implementation is synthesizing the paused-range dates into the existing `frozenDates` bridging
mechanism at read time rather than duplicating streak math. Exclude paused habits from
`makeAutoApplyFreezes` (`contexts/household/mutations/gamificationMutations.ts`) so a paused
habit never burns a freeze token. Add a "Pause until" date field to `HabitFormModal.tsx` and a
paused badge/disabled toggle on `HabitCard.tsx`. Keep the server twin in
`functions/src/quickAdd/habitProcessor.ts` in lockstep per CLAUDE.md.

**Key files:**
- `types/schema.ts`, `utils/habitLogic.ts`
- `contexts/household/mutations/gamificationMutations.ts`
- `components/modals/HabitFormModal.tsx`, `components/habits/HabitCard.tsx`
- `functions/src/quickAdd/habitProcessor.ts`

### F-HABITS-02 — Streak milestone celebrations

**Size:** medium · **Value:** high · **Dependencies:** none for v1 (presentation-only); a bonus-points variant touches the same writeBatch as the points update

Fire a distinct, celebratory toast (and optionally a one-time bonus point award) the moment a
habit's streak or lifetime `totalCount` crosses a meaningful milestone (7, 30, 100, 365 days).

**Why:** `habit.streakDays`/`totalCount` are already tracked in `processToggleHabit`
(`utils/habitLogic.ts`); this is a presentation/engagement layer over existing state, extending
the toggle path's already-established toast-accumulation pattern
(`hooks/useHabitActions.tsx`'s `accumulate`/`pointsToastAccumulatorRef`).

**Implementation notes:** New pure `utils/habitMilestones.ts` exporting `MILESTONES = [7, 30,
100, 365]` and `crossedMilestone(prev, next): number | null`. In `toggleHabit`
(`hooks/useHabitActions.tsx`, after the existing points-toast logic), compare `streakDays`
before/after and fire a distinct toast (reuse `toastIcon` from `components/ui/toastIcon.tsx`)
plus `track('habit_milestone_reached', {habitId, milestone})`. Keep presentation-only in v1 (no
bonus points) to avoid a points-model change; a bonus-points variant needs an extra `increment()`
in the same writeBatch plus a decision on double-counting with challenges.

**Key files:**
- `utils/habitMilestones.ts` (new)
- `hooks/useHabitActions.tsx`, `components/ui/toastIcon.tsx`, `services/analytics.ts`

### F-HABITS-03 — Per-habit timed reminder push

**Size:** medium · **Value:** high · **Dependencies:** `member.notificationPreferences` (existing),
F-TODO-14's `sendtodoreminders` as the scheduling model

Each habit can carry its own reminder — an arbitrary member-local `HH:MM` plus a day-of-week
selection — instead of one household-wide daily nudge. Reminders due in the same window are
coalesced into a single push naming the habits.

This **supersedes** the original brief (a per-habit *mute* on the existing shared nudge). Scope
decisions, taken with the owner 2026-07-24:

- **Coalesce by fire window**, so N habits due together produce one push, not N.
- **Tap behavior is asymmetric by design:** one habit in the window → the tap logs it, with the
  Undo that `toggleHabit`'s points toast already raises. Two or more → the tap opens the habits
  page filtered to what's due, since a single tap can't unambiguously log three habits.
- **Config on the MEMBER doc**, keyed by habit id (`perHabitReminders`) — habits are shared
  documents, so a per-uid map on the habit would put every member on one document's write path,
  the shape behind the habit-history clobber incident.
- **Arbitrary `HH:MM` fired by a 15-minute job**, i.e. at or just after the target. Precision is
  free here: `sendtodoreminders` already runs 96×/day and gates on member eligibility before
  querying items.
- **Suppressed when** the habit is already complete for its period, the habit is paused or
  archived, or it is someone else's personal habit. Quiet hours deliberately omitted — the member
  picked the time. **Digest mode is NOT a suppressor** (revised during PR 2): a reminder aimed at
  one habit at one minute is an alarm, not a briefing, so it follows the `sendtodoreminders`
  precedent rather than the four hourly summary jobs that fold into the digest.
- **Location and API-signal triggers are out of scope.** PRD #1065 already shipped foreground
  geo prompts (`HabitTriggers.locations`), and the app-closed case belongs to an iOS Shortcuts
  automation calling `quickAddHabit` directly — no server round trip to push back to the same phone.
- **No snooze.** A missed habit reminder fires again tomorrow.

**Platform caveat — settled on device (2026-07-24):** a temporary two-button probe on the "Send a
test notification" control confirmed that an installed iOS PWA renders **no** web-push action
buttons at all (long-press does nothing from either the Lock Screen or Notification Center),
matching MDN's compat data and Apple's Declarative Web Push material. Body-tap is therefore the
primary interaction on iOS and the `Log` button is a bonus where it renders (Android/desktop
Chrome). The probe has been removed.

The same probe surfaced a second, larger problem: the deep link only appeared to work because the
service worker was **focusing an already-open window**, not routing it. Two bugs were behind that,
both fixed in PR 2 — `sw.js` was opening a path (`/habits`) that a HashRouter SPA routes as `/`,
and its `postMessage({type:'NAVIGATE'})` for the focused-window case had no listener anywhere in
the app. On iOS, where an installed PWA nearly always has a live window client, that second one
meant deep links effectively never landed.

**Status: SHIPPED.** PR 1 — schema, the reminder editor in `HabitFormModal`, the `log-habit` /
`nhabit` deep-link dispatch. PR 2 — the `sendperhabitreminders` 15-minute job (window coalescing,
once-per-local-day claim, period-aware suppression), the `?due=` filter on the habits page, the
content-aware household-wide nudge, and the two deep-link fixes above.

**Key files:**
- `types/schema.ts` (`HabitReminderConfig`), `utils/habitReminders.ts`, `utils/notificationActions.ts`,
  `utils/swNavigation.ts`
- `components/habits/HabitReminderEditor.tsx`, `components/habits/HabitLogIntent.tsx`,
  `components/modals/HabitFormModal.tsx`, `pages/Habits.tsx`, `public/sw.js`
- `functions/src/shared/habitReminders.ts` (pure send logic), `functions/src/index.ts`

### F-HABITS-04 — Export habit history to CSV

**Size:** small · **Value:** low · **Dependencies:** none

A one-tap "Export" button (Insights or history calendar) that downloads a CSV of a habit's (or
all habits') `completedDates`, streak, and points-earned history. Same pattern as F-MONEY-10
(client CSV export) applied to a different data source — kept as a separate entry since the
export target (habit submissions vs. transactions) genuinely differs.

**Why:** Cheap, self-contained, no backend change — a common "give me my data" ask for any
tracking app.

**Implementation notes:** New pure `utils/habitExport.ts` building a CSV string from
`habit.completedDates` (+ `frozenDates`) and, if available, fetched `HabitSubmission` docs (reuse
the existing on-demand `getDocs` fetch pattern already used by `HabitSubmissionLogModal.tsx`'s
Stats/Calendar tabs — submissions have no standing listener per CLAUDE.md). Trigger a client-side
Blob download from a button in `HabitsInsightsTab.tsx` or `HabitHistoryCalendar.tsx`. No writes,
no Cloud Function.

**Key files:**
- `utils/habitExport.ts` (new)
- `components/habits/HabitsInsightsTab.tsx`, `components/habits/HabitHistoryCalendar.tsx`

### F-HABITS-05 — Archive a habit instead of only hard-deleting it

**Size:** small · **Value:** medium · **Dependencies:** none

Today `deleteHabit` permanently removes the document, losing streak/point history. Add a softer
"Archive" action (seasonal habits, a chore you're pausing indefinitely) that hides a habit from
the Track tab and reminders but keeps its history intact for Insights/export.

**Why:** Users will naturally want to retire habits without nuking months of streak/points
history — the existing delete is a one-way destructive action with no undo, a common source of
regret in habit trackers.

**Implementation notes:** Add `archivedAt?: string` (ISO timestamp) to `Habit`. Add
`archiveHabit`/`unarchiveHabit` in `hooks/useHabitActions.tsx` (simple `updateDoc`, no batch —
no points change). Filter archived habits out of the Track tab's habits array
(`pages/Habits.tsx`/`HabitCategoryList.tsx`) but keep them in `HabitsInsightsTab.tsx` charts and
`HabitSubmissionLogModal` history since those read historical data. Add "Archive" next to
Edit/Log/Delete in `HabitCard.tsx`'s Menu, plus an "Archived" filter reachable from
`HabitsHeaderMenu.tsx`.

**Key files:**
- `types/schema.ts`, `hooks/useHabitActions.tsx`
- `components/habits/HabitCard.tsx`, `components/habits/HabitCategoryList.tsx`, `components/habits/HabitsHeaderMenu.tsx`, `pages/Habits.tsx`

### F-HABITS-06 — Completion notes & mood on habit submissions

**Size:** small · **Value:** medium · **Dependencies:** none

Let a user attach a short free-text note and/or a quick mood tag (great/good/meh/rough) when
logging a completion, surfaced later in the habit's log/calendar history.

**Why:** `HabitSubmission` already stores per-completion metadata purely for display in
`HabitSubmissionLogModal`'s tabs — a note/mood field is a natural, low-risk extension of an
already-built display surface, not a new subsystem.

**Implementation notes:** Add optional `note?: string` (cap ~280 chars) and
`mood?: 'great'|'good'|'meh'|'rough'` to `HabitSubmission`. Thread optional params through
`addHabitSubmission`/`updateHabitSubmission` (`hooks/useHabitActions.tsx`, both already accept
`count`/`timestamp`). Add a textarea + 4-option mood picker to the Log tab of
`HabitSubmissionLogModal.tsx`, render note/mood in its Stats/Calendar tab history and in
`HabitHistoryCalendar.tsx`'s day popover.

**Key files:**
- `types/schema.ts`, `hooks/useHabitActions.tsx`
- `components/modals/HabitSubmissionLogModal.tsx`, `components/habits/HabitHistoryCalendar.tsx`

### F-HABITS-07 — Day-of-week / time-of-day completion pattern chart

**Size:** small · **Value:** medium · **Dependencies:** none

A deterministic (non-AI) chart in Insights showing which days of the week a habit is most/least
completed — e.g. "You almost never do this on Mondays." Always available, no AI quota.

**Why:** `HabitsInsightsTab` already lazy-loads recharts for other charts; `completedDates` is a
flat `yyyy-MM-dd` array that trivially buckets by day-of-week with `date-fns`'s `getDay`. Doesn't
need Gemini at all and costs nothing to run on every page view.

**Implementation notes:** New pure function in `utils/habitLogic.ts` or a new
`utils/habitPatterns.ts`: bucket `completedDates` by `getDay(parseISO(date))` into a 7-bar
histogram. Render via the existing recharts setup in `HabitsInsightsCharts.tsx` (new bar chart
component), surfaced from `HabitsInsightsTab.tsx` per-selected-habit or aggregated.

**Key files:**
- `utils/habitPatterns.ts` (new) or `utils/habitLogic.ts`
- `components/habits/HabitsInsightsCharts.tsx`, `components/habits/HabitsInsightsTab.tsx`

### F-HABITS-08 — "At risk today" streak sort/filter chip

**Size:** tweak · **Value:** medium · **Dependencies:** none

A segmented toggle on the Habits Track tab that re-sorts/filters to habits whose multiplier is
about to drop or whose period is about to close without a completion, so a user with 15 habits
can triage which actually needs attention right now.

**Why:** All the data already exists client-side (`streakDays`, `period`, `count`,
`completedDates`) — pure client sort logic, zero backend/schema change, directly extending the
existing 3/7-day and 2/4-week multiplier ladders already surfaced via HabitCard's "next tier
nudge."

**Implementation notes:** New pure `utils/habitRisk.ts`: "at risk" = incomplete today AND
(`streakDays` === one-below-next-tier per `getMultiplier`'s thresholds, OR `streakDays >= 1` for a
habit that would reset to 0 tonight). Wire a toggle into `HabitsHeaderMenu.tsx` or above
`HabitCategoryList` in `pages/Habits.tsx`; when active, flatten/re-order the habits array across
categories. No writes, no new reads.

**Key files:**
- `utils/habitRisk.ts` (new)
- `components/habits/HabitsHeaderMenu.tsx`, `pages/Habits.tsx`, `components/habits/HabitCategoryList.tsx`
- `utils/habitLogic.ts` (reuse `getMultiplier`)

### F-HABITS-09 — Bulk "catch up yesterday's habits" action

**Size:** small · **Value:** medium · **Dependencies:** none

A single button in the Track tab's overflow menu that one-tap-completes every positive habit done
yesterday but not yet marked today, for anyone who logs habits in the evening and forgot.

**Why:** Pure client-side convenience over an already-existing per-habit mutation (`toggleHabit`);
no new backend logic, schema, or Cloud Function.

**Implementation notes:** Add "Catch up from yesterday" to `HabitsHeaderMenu.tsx`. On click,
compute `yesterday = getLocalDateString(subDays(new Date(), 1))`, filter habits for
`type === 'positive'`, unassigned-or-assigned-to-current-user,
`completedDates.includes(yesterday)`, and `!completedDates.includes(today)`, then sequentially
(not `Promise.all`, to avoid a burst of concurrent writeBatches) `await toggleHabit(habit.id,
'up')` for each. Show a summary toast with the count caught up.

**Key files:**
- `components/habits/HabitsHeaderMenu.tsx`
- `hooks/useHabitActions.tsx` (reuse `toggleHabit`), `utils/dateHelpers.ts`

### F-HABITS-10 — Nudge a housemate about a shared habit / to-do (partner-nudge)

**Size:** medium · **Value:** high · **Dependencies:** existing FCM token + `notificationPreferences` plumbing

*(Merged: this is the same feature independently proposed by the Habits domain as "Nudge a
housemate about a shared habit" and by Notifications as "Partner-nudge notifications" — one
mechanism, two surfaces.)* A "Nudge" action on a shared, incomplete habit (or pending item) that
sends a push to the other household members ("Sam nudged you about Take out trash" /
"remind Alex to log today's spending"), directly from the habit card or budget review screen —
light social accountability without a full chat/comment system.

**Why:** The FCM push infrastructure and per-member `fcmTokens`/preference plumbing already
exists and is exercised by four scheduled reminder crons; this reuses the exact same
`sendNotificationToUser` helper for an ad-hoc, user-triggered push instead of a scheduled one.

**Implementation notes:** New callable Cloud Function (e.g. `functions/src/nudgeHabit.ts` or a
more generic `sendNudge({toMemberUid, context})`), exported from `functions/src/index.ts`, that
validates the caller is a household member, reads the target doc, checks a rate-limit field
(e.g. `Habit.lastNudgedAt?: string`, capped to once per habit/context per hour or day
server-side), and calls the existing `sendNotificationToUser`
(`functions/src/shared/notifications.ts`) against every OTHER member's `fcmTokens` who has the
relevant reminders enabled. Add a "Nudge household" menu item to `HabitCard.tsx`'s Menu (shown
only when `isShared !== false`, `!assignedTo`, incomplete today) and a small icon on
`TransactionReview`/budget review for money-side nudges, both calling the new callable via lazy
`getFunctionsInstance()` per CLAUDE.md's boot-bundle notes.

**Key files:**
- `functions/src/nudgeHabit.ts` (new), `functions/src/index.ts`, `functions/src/shared/notifications.ts`
- `types/schema.ts`, `components/habits/HabitCard.tsx`, `components/budget/`

### F-HABITS-11 — Custom color tags per habit category

**Size:** tweak · **Value:** low · **Dependencies:** none

Let a household pick a color per habit category (Health, Chores, Learning, etc.), rendered as a
colored header/pill in the Track tab's category groups — same visual affordance budget buckets
already have.

**Why:** Categories today are plain strings with a flat neutral header
(`HabitCategoryList.tsx`); the app already has a proven "named color token" pattern for exactly
this (`BudgetBucket.color`/`data/bucketColors.ts`/`bucketColorClass`), so this is direct reuse in
a new spot.

**Implementation notes:** Add `habitCategoryColors?: Record<string,string>` to `Household`
(category name → a key from a new/reused color-token set, mirroring `data/bucketColors.ts`'s
key-based approach post the bucket-color migration). Add a small color-swatch picker to the
category field in `HabitFormModal.tsx`/`CustomHabitForm.tsx`, write via a lightweight
`setHabitCategoryColor` mutation (plain `updateDoc` on the household doc, no rules change). Read
in `HabitCategoryList.tsx` to color the section header.

**Key files:**
- `types/schema.ts`
- `components/modals/HabitFormModal.tsx`, `components/habits/CustomHabitForm.tsx`, `components/habits/HabitCategoryList.tsx`
- `data/bucketColors.ts` (pattern to mirror)

### F-HABITS-12 — Per-member completion attribution + household habit leaderboard

**Size:** large · **Value:** high · **Dependencies:** meaningful with 2+ non-kid household members

Shared habits today are anonymous — completing "Wash dishes" doesn't record WHO did it, so
`household.points` is one shared pool. Add optional per-completion attribution to shared habits
and a household leaderboard (weekly/monthly completion counts per adult member).

**Why:** A real gap, not a bug: `habitPointsTargetRef` (`hooks/useHabitActions.tsx`) only
attributes points to an individual when a habit has `assignedTo` set (the Kid Mode chore path) —
every shared adult habit is a black box of "someone did this." A leaderboard is a proven
engagement mechanic that directly extends the currently-kid-only attribution concept to adults.

**Implementation notes:** Add optional `Habit.completedBy?: Record<string,string>` (yyyy-MM-dd →
member uid). In `toggleHabit`'s batch (`hooks/useHabitActions.tsx`), when `direction === 'up'` and
the date is newly added to `completedDates`, also set `completedBy.<date> = currentUser.uid`
(already passed into the hook); clear the key on the 'down' path removing the date. New pure
`utils/habitLeaderboard.ts` tallying completion counts per uid across shared (non-`assignedTo`)
habits within a week/month window. New `components/habits/HabitLeaderboardWidget.tsx` rendered in
`HabitsInsightsTab.tsx`, gated on `members.filter(m => m.role !== 'kid').length >= 2`. Additive
only — absent `completedBy` just means "unattributed," no migration needed.

**Key files:**
- `types/schema.ts`, `hooks/useHabitActions.tsx`
- `utils/habitLeaderboard.ts` (new), `components/habits/HabitLeaderboardWidget.tsx` (new), `components/habits/HabitsInsightsTab.tsx`

### F-HABITS-13 — Photo-verified habit completion via Gemini vision

**Size:** suite · **Value:** high · **Dependencies:** `aiEnabled` flag, daily AI quota, likely `billingEnabled`/premium gating; new Storage rules surface

Let a household mark specific habits (workout, a kid's chore, practicing an instrument) as
requiring a photo to check off — tapping opens the camera, the photo uploads and gets a quick AI
plausibility check, then the habit completes with the photo attached to its history.

**Why:** Directly reuses the app's most-proven AI pattern — `analyzeReceipt()`/
`parseGroceryReceipt()` already do "upload a photo, get structured AI output back" through the
`geminiproxy` Cloud Function with no client-held API key — applied to habit proof instead. A
meaningful accountability upgrade over an honor-system tap, particularly valuable for the dormant
Kid Mode chore flow once flipped.

**Implementation notes:** Add `Habit.requiresPhotoProof?: boolean`. New `HabitProof` subcollection
doc under `households/{id}/habits/{habitId}/proof/{date}` with
`{date, photoUrl, aiVerdict: 'plausible'|'unclear', confidence, verifiedAt}`. Client: reuse the
existing camera-capture UI pattern from the receipt-scan flow, upload to Firebase Storage at a
new path (needs its own Storage-rules PR, human-watched — same caveat as `TODO.md` §3's G10
receipt-persistence item, scoped narrowly to habit proof). Server: new `analyzeHabitProof()` in
`services/geminiService.ts` + a matching case in `functions/src/geminiProxy.ts`, following the
exact `analyzeReceipt` request/response/retry/timeout pattern, gated by `aiEnabled` and the daily
AI-quota transaction — likely worth premium-gating via `utils/entitlements.ts` given the added AI
cost per household.

**Key files:**
- `types/schema.ts`, `services/geminiService.ts`, `services/geminiService.types.ts`
- `functions/src/geminiProxy.ts`, `components/habits/HabitCard.tsx`, `components/modals/HabitFormModal.tsx`
- `utils/entitlements.ts`, `firestore.rules`/Storage rules (separate human-watched PR)

## Meals & Shopping

Note: meals/grocery spend → Groceries bucket linkage and the AI Weekly Planner save-back-to-calendar
item are already tracked in `TODO.md` §3 — not re-listed here.

### F-HABITS-14 — No-spend day / weekend habit trigger

**Status:** SHIPPED · **Size:** medium · **Value:** high · **Dependencies:** the nightly `bankEmailSync` Cloud Function (`docs/BANK_EMAIL_SYNC_RUNBOOK.md`)

A third habit-automation trigger, alongside transaction keywords and saved locations: the nightly
bank sync judges the day that just ended and, if nothing unplanned was spent, logs any habit wired
to it — with the push notification as the reward.

**Origin:** the sync was sending a "Bank sync failed — Could not find a 'Withdrawals' section"
push on the user's *best* nights, because Wells Fargo omits that section entirely when nothing was
withdrawn. Fixing the false failure (PR #1097) made the underlying signal available, and a
no-spend day is worth celebrating rather than merely not-failing.

**Owner decisions (settled 2026-07-25):**
- **Bills and transfers don't break a day.** The habit measures spending you chose to do; autopay
  set up months ago isn't a decision you made that day, and moving your own money between your own
  accounts isn't spending. Without this, the ~8-10 nights a month carrying a recurring charge would
  all be disqualified.
- **Every account counts, not just checking.** A credit-card charge breaks the day even though
  nothing left checking — otherwise the habit is trivially satisfied by reaching for another card.
- **Fires server-side at sync time** (~3am) rather than on next app open, so the push can carry the
  points and streak. The cost is a duplicated scoring path (see below).
- **Configured on the habit**, with an explicit day/weekend scope, next to the other triggers.
- **A weekend is Saturday AND Sunday**, credited to the Sunday — which also lands the completion in
  the right Mon-Sun ISO week for a weekly habit's streak.

**Implementation notes:** The verdict is computed from **transactions dated to the day**, not from
whether the email was empty. Wells Fargo reports card *authorization* dates, so a Thursday charge
can appear in Saturday's email — an empty Friday email is not evidence that Thursday was clean.
The parser already resolves each withdrawal to its real date, and `noSpendDay.ts` reads those.

`backdatedHabitFire.ts` is a server twin of `utils/habitTriggerFire.ts`'s
`computeBackdatedHabitFire` (the same duplication the project already carries for
`streakLogic.ts` ↔ `utils/habitLogic.ts`). Its test asserts **parity against the client function
directly** rather than duplicating a table — `functions/tsconfig.json` excludes `*.test.ts` and the
suite runs under the root vitest config, so the `@/` alias resolves. That parity test immediately
surfaced one genuine divergence: `isHabitStale` is a *different function* in the two trees (the
server's takes a caller-local `today` and anchors on `completedDates`; the client's does neither),
which is documented and asserted-as-divergent rather than papered over. It is unreachable from this
feature, which never fires into a current period.

`applyNoSpendDay` is split into a read phase and a stage phase with no awaits in the latter,
because it shares the sync's batch: a throw partway through staging would otherwise leave half a
habit fire committed alongside the money writes.

**Key files:**
- `functions/src/quickAdd/noSpendDay.ts` (classifier + weekend rule), `noSpendFire.ts` (reads, verdict, staged fires)
- `functions/src/quickAdd/backdatedHabitFire.ts` + `streakLogic.ts` (historical-streak/scoring primitives)
- `functions/src/quickAdd/bankEmailSync.ts` (integration, push copy, ledger record)
- `types/schema.ts` (`NoSpendScope`, `HabitTriggers.noSpend`, `HabitSubmission.sourceNoSpendDate`)
- `components/habits/HabitAutomationsSection.tsx` + `CustomHabitForm.tsx` + `modals/HabitFormModal.tsx` + `modals/HabitCreatorWizard.tsx`
- `firestore.rules` (`noSpendDays` server-owned), `docs/BANK_EMAIL_SYNC_RUNBOOK.md` §5

### F-MEALS-01 — Cost-per-meal tracking (link recipes to grocery spend)

**Size:** medium · **Value:** high · **Dependencies:** none

Show an estimated/actual cost per recipe/meal, computed from grocery catalog price history, plus
a per-week meal-plan total ("this week's dinners cost ~$87").

**Why:** Money and meals are currently disconnected features. This is the cheapest low-effort
bridge that doesn't touch Safe-to-Spend or bucket math (the owner-confirmed pool/overlay model
stays untouched, per CLAUDE.md) — distinct and lighter-weight than the bucket-linkage item already
in `TODO.md` §3.

**Implementation notes:** Add optional `estimatedCost?: number` (decimal dollars) to
`MealIngredient`, populated manually or backfilled by matching ingredient names against
`GroceryCatalogItem` (no price field exists yet — also needs `GroceryCatalogItem.lastPrice?:
number`, opportunistically settable from `parseGroceryReceipt()`'s returned items if extended to
include per-item price, or left purely manual for v1). Sum ingredient costs in new pure
`utils/mealCost.ts` (cents-based, `utils/money.ts`). Display a cost badge on meal cards in
`MealPlanTab.tsx`/`CookbookModal.tsx`, and a weekly total in the week header. Keep entirely
separate from `safeToSpendCalculator.ts` — informational only.

**Key files:**
- `types/schema.ts`, `utils/mealCost.ts`
- `components/meals/MealPlanTab.tsx`, `components/meals/CookbookModal.tsx`, `services/geminiService.ts`

### F-MEALS-02 — Meal-plan gap reminder push notification

**Size:** medium · **Value:** medium · **Dependencies:** none

A new opt-in scheduled push (e.g. Sunday evening) checking whether the upcoming week has any
unplanned dinner slots and, if so, nudging the user to plan meals.

**Why:** The app already has four scheduled per-timezone notification jobs and a full FCM
plumbing/`NotificationPreferences` pattern — this slots a fifth into an existing, well-understood
system.

**Implementation notes:** Add `mealPlanReminders?: {enabled, time}` to `NotificationPreferences`,
toggle in `NotificationSettings.tsx`. New scheduled function `sendmealplanreminders` in
`functions/src/index.ts`, modeled on `sendbillreminders` (per-member-timezone via
`formatInTimeZone`) — read `mealPlan` items for the next 7 days directly via Admin SDK (not the
client's windowed listener), count dinner slots with no item, send via the shared FCM helper if
any unplanned dinners exist.

**Key files:**
- `types/schema.ts`, `components/settings/NotificationSettings.tsx`
- `functions/src/index.ts`, `functions/src/shared/notifications.ts`

### F-MEALS-03 — Nutrition/dietary tag badges + household allergy profile

**Size:** medium · **Value:** medium · **Dependencies:** none

Let a household record standing dietary restrictions/allergies once in settings so AI meal
suggestions (`suggestMeal`) and the weekly planner (`generateWeeklyPlan`) automatically respect
them, plus show a warning badge on any manually-added recipe whose ingredients match a flagged
allergen.

**Why:** `generateWeeklyPlan()` already accepts an `allergies` constraint per-call but nothing
persists it — this turns a one-off prompt input into a standing household setting, extending
existing AI infra without new endpoints.

**Implementation notes:** Add `Household.dietaryProfile?: {restrictions: string[]; allergens:
string[]}`. Surface an editor in a Settings sub-section or a small modal alongside
`ShoppingSettingsModal.tsx`. Default-populate `allergies` from the stored profile in
`generateWeeklyPlan()`/`suggestMeal()` calls (`WeeklyPlanModal.tsx`, `AISuggestModal.tsx`, both
already pass a constraints object) instead of leaving it to manual per-session entry. For the
badge, add a pure client-side substring check in new `utils/allergenCheck.ts` against
`Meal.ingredients[].name` — no AI call needed, free/instant.

**Key files:**
- `types/schema.ts`
- `components/meals/WeeklyPlanModal.tsx`, `components/meals/AISuggestModal.tsx`
- `utils/allergenCheck.ts`, `pages/Settings.tsx`

### F-MEALS-04 — "Cook at home" habit auto-credit on meal-plan completion

**Size:** small · **Value:** medium · **Dependencies:** none

When a user marks a planned meal `isCooked: true`, optionally auto-complete a linked habit (e.g.
"Cooked dinner at home") for that date, crediting points/streak without a separate manual tap.

**Why:** Meals and Habits never talk to each other today; this is a natural low-effort
cross-domain hook reusing the existing atomic habit-toggle infra (`toggleHabit` already commits a
writeBatch covering habit doc + points).

**Implementation notes:** Add `Household.mealCookedHabitId?: string` (settable via a new field in
a settings modal, e.g. extend `ShoppingSettingsModal.tsx` or the `MealPlanTab` overflow menu). In
the `isCooked` toggle handler in `MealPlanTab.tsx`, after marking cooked, call the existing
`toggleHabit(habitId, date)` from `useGamification()` if `mealCookedHabitId` is set and the habit
isn't already completed for that date. Guard against double-crediting when un-marking cooked (call
`toggleHabit` again to undo — idempotent flip semantics already apply).

**Key files:**
- `components/meals/MealPlanTab.tsx`, `types/schema.ts`
- `hooks/useHabitActions.tsx`, `components/meals/ShoppingSettingsModal.tsx`

### F-MEALS-05 — Leftover / "use it up" nudge on shopping list

**Size:** tweak · **Value:** medium · **Dependencies:** none

Surface a small badge/section at the top of the shopping list for catalog items with an old
`lastPurchased` date not currently on the list — a lightweight "you might be low on these"
reminder, distinct from the AI-driven weekly-plan use-it-up logic (which only fires during full
plan generation).

**Why:** Cheap, pure-client feature reusing the already-loaded `groceryCatalog` slice (bounded to
200, purchase-count ordered) with zero new Firestore writes or AI calls.

**Implementation notes:** Add pure selector `utils/staleCatalogItems.ts` filtering
`groceryCatalog` for `purchaseCount > 1 && lastPurchased older than X days` (configurable, e.g.
21) and not already name-matched in current `shoppingList`. Render as a collapsible "Running low?"
chip row above the main list in `ShoppingListTab.tsx`; tapping a chip calls the existing
`addShoppingItems([...])` mutation (already used by `QuickRestockDrawer.tsx`).

**Key files:**
- `utils/staleCatalogItems.ts`
- `components/meals/ShoppingListTab.tsx`, `contexts/household/mutations/shoppingMutations.ts`

### F-MEALS-06 — Recipe rating prompt after cooking

**Size:** tweak · **Value:** medium · **Dependencies:** none

When a meal-plan item is marked cooked and the linked `Meal` has no `rating` yet (or hasn't been
rated recently), show a lightweight inline 1-5 star quick-rate affordance right in the action
sheet/toast, instead of requiring a trip into the full edit form.

**Why:** `Meal.rating` already exists and is used for cookbook filtering/sorting, but the only way
to set it today is the full edit form — this closes the loop at the moment rating is most
top-of-mind.

**Implementation notes:** In `MealPlanTab.tsx`'s cooked-toggle flow, after `updateMealPlanItem(...,
{isCooked: true})` succeeds, if the resolved `Meal.rating` is undefined show a small star-picker
inline in the action sheet or via `toast.custom()` (react-hot-toast); on tap call the existing
`updateMeal(mealId, {rating, lastCooked: getLocalDateString()})` from `useMealPlan()`.

**Key files:**
- `components/meals/MealPlanTab.tsx`, `contexts/household/mutations/mealMutations.ts`

### F-MEALS-07 — Multi-store optimized shopping route (group + order by store visit)

**Size:** small · **Value:** medium · **Dependencies:** none

When more than one store is used, offer a "shop by store" mode grouping items under store headers
in the household's configured visit order (not just alpha/section), with drag-to-reorder of
stores themselves.

**Why:** The shopping list already supports store-grouped sort mode
(`sortShoppingItems`/`shoppingGroupLabel` in `utils/shoppingSort.ts`) and `Store` docs already
carry an implicit array order in `Household.stores`; this wires store *ordering* into the
existing sort utility.

**Implementation notes:** Add `Store.order?: number` (mirrors `Account.order`/`Habit.order`
convention). Extend `shoppingSort.ts`'s `'store'` mode to sort store-groups by `Store.order`
(falling back to alpha for unset). Add drag-reorder for stores in `ShoppingSettingsModal.tsx`
(store management UI already lives there via `makeStoreSettingsMutations`) using the same
`Reorder` from framer-motion already used for item drag-drop in `ShoppingListTab.tsx`. New
`reorderStores` mutation writing updated `order` values.

**Key files:**
- `types/schema.ts`, `utils/shoppingSort.ts`
- `components/meals/ShoppingSettingsModal.tsx`, `contexts/household/mutations/shoppingMutations.ts`

### F-MEALS-08 — Recipe tag filter + smart collections in Cookbook

**Size:** small · **Value:** medium · **Dependencies:** none

Add tag-based filter chips (using the existing free-text `Meal.tags` array) plus a few
auto-computed smart collections ("Not cooked in 30+ days," "Never tried," "5-star favorites") to
`CookbookModal` so browsing 50+ saved recipes is navigable.

**Why:** `Meal.tags`/`rating`/`lastCooked` are already-stored fields with zero UI to filter/browse
by them; pure client-side UX layer over data already loaded via `loadAllMeals()`, no schema or
mutation changes.

**Implementation notes:** In `CookbookModal.tsx`, derive a distinct tag set via `useMemo` over the
loaded `meals` array, render as filter chips (reuse `Badge`/chip primitives). Add computed
smart-collection filters as pure predicates in new `utils/recipeCollections.ts`: "not cooked in
30+ days" (`lastCooked` older than 30 days or absent), "never tried" (`lastCooked` absent),
"favorites" (`rating >= 4`). Combine with existing search/filter state via `useMemo`.

**Key files:**
- `components/meals/CookbookModal.tsx`, `utils/recipeCollections.ts`, `components/ui/Badge.tsx`

### F-MEALS-09 — Shopping list voice/photo hand-off: multi-item paste import

**Size:** small · **Value:** medium · **Dependencies:** none

Extend the shopping capture story with a companion "Add to shopping list" flow: paste/share a
block of text (e.g. copied ingredient list from a website) and have it parsed into individual
shopping items via Gemini, landing pre-populated for review — instead of one `quickAddShoppingItem`
call per item.

**Why:** Leverages the already-live quickAdd pipeline and Gemini proxy infra, but
`quickAddShoppingItem` today only handles one item/phrase at a time — multi-item paste is a real
everyday friction point (e.g. copying a recipe's ingredient block).

**Implementation notes:** Cheapest v1: purely client-side, reuse the existing
`optimizeGroceryList()` (`services/geminiService.ts`) directly from a new "Import list" text-paste
option in `ShoppingListTab.tsx` — no Cloud Function work needed. A server-side variant, if
warranted later, would add `quickAddShoppingItems` (plural) alongside the existing
`quickAddShoppingItem` in `functions/src/quickAdd/index.ts`, reusing the same API-key auth
middleware and a new Gemini prompt (pattern of `parseGroceryReceipt`) splitting text into
`{name, quantity, category}[]`, batch-written via `addShoppingItems`
(`contexts/household/mutations/shoppingMutations.ts`).

**Key files:**
- `services/geminiService.ts`, `components/meals/ShoppingListTab.tsx`
- `functions/src/quickAdd/index.ts` (optional server variant), `contexts/household/mutations/shoppingMutations.ts`

### F-MEALS-10 — "Repeat last week's shop" one-tap restock

**Size:** tweak · **Value:** medium · **Dependencies:** none

A single button that re-adds every item purchased in the most recent completed shopping trip back
onto the current list, for households that buy roughly the same groceries weekly but don't want
to maintain a formal QuickStockList template.

**Why:** `clearPurchasedShoppingItems` already wipes purchased items after a trip; capturing what
was cleared as a lightweight "last trip" snapshot is cheap and serves the same repeat-shopper need
as QuickStockList but with zero manual template setup — a complement, not a duplicate.

**Implementation notes:** In `makeClearPurchasedShoppingItems`
(`contexts/household/mutations/shoppingMutations.ts`), before deleting purchased items, snapshot
`{name, category, store, quantity}` into a new bounded field `Household.lastShoppingTrip?: {items:
[...], clearedAt: string}` (small array, similar bounding to `redemptionHistory`). Add a "Repeat
last shop" button in `ShoppingListTab.tsx` (near the `QuickRestockDrawer` trigger) calling the
existing `addShoppingItems()` with the snapshot, filtering out names already on the current list
(reuse `QuickRestockDrawer.tsx`'s normalization logic).

**Key files:**
- `contexts/household/mutations/shoppingMutations.ts`, `types/schema.ts`
- `components/meals/ShoppingListTab.tsx`, `components/meals/QuickRestockDrawer.tsx`

### F-MEALS-11 — Portion-scaling on recipes (servings multiplier)

**Size:** tweak · **Value:** medium · **Dependencies:** none

Add an optional `servings` field to a Meal and a +/- stepper on the recipe detail view that scales
ingredient quantities proportionally for display, purely a view-time calculation feeding the
"add ingredients to shopping list" flow.

**Why:** `MealIngredient.quantity` is currently free-text (not structured numeric+unit) — the main
blocker, worth calling out as a real cost — but even a best-effort numeric-prefix parser covers the
common case ("2 cups," "1 lb") and meaningfully improves the ingredient-selector → shopping-list
handoff.

**Implementation notes:** Add `Meal.servings?: number`. Add pure `utils/scaleQuantity.ts` parsing
a leading numeric/fraction token off `quantity` (regex `^(\d+(\.\d+)?|\d+\/\d+)\s*(.*)$`),
multiplying by scale factor, reassembling the string; falls through unchanged if unparseable
(never throws). Add a servings stepper to `RecipeModal.tsx`'s detail view; when non-1x, pass
scaled quantities into `IngredientSelectorModal.tsx`'s "add to shopping list" flow. Stored
`Meal.ingredients` are never mutated by scaling — only the transient add-to-list payload.

**Key files:**
- `types/schema.ts`, `utils/scaleQuantity.ts`
- `components/meals/RecipeModal.tsx`, `components/meals/IngredientSelectorModal.tsx`

### F-MEALS-12 — Recipe photo attachment (own-photo, not OCR import)

**Size:** small · **Value:** low · **Dependencies:** Firebase Storage bucket + security rules for household-scoped image uploads (verify existing usage elsewhere before assuming set up)

Let a user attach a photo to a saved Meal (finished-dish photo, or a handwritten family recipe
card snapshot) — distinct from the receipt-OCR/recipe-URL-import flows, which extract structured
data rather than preserve a personal image.

**Why:** The app already has a full image-capture pipeline (`CaptureModal`, receipt scanning) and
Firebase Storage is implicitly available elsewhere (photo uploads for gamification/profile
avatars) — reuses that infra for a low-effort Cookbook personalization touch.

**Implementation notes:** Add `Meal.photoUrl?: string`. In `RecipeModal.tsx`/`AddMealModal.tsx`,
add an optional image picker (reuse the `CaptureModal`/camera-input pattern, or a plain
`<input type="file" accept="image/*">` if no shared uploader exists) uploading to Firebase Storage
under `households/{householdId}/mealPhotos/{mealId}`, storing the download URL on `photoUrl`.
Display as a thumbnail/header image in `CookbookModal.tsx`/`RecipeModal.tsx`. Verify Storage
security rules permit household-scoped writes before shipping.

**Key files:**
- `types/schema.ts`
- `components/meals/RecipeModal.tsx`, `components/meals/AddMealModal.tsx`, `components/meals/CookbookModal.tsx`, `firebase.config.ts`

### F-MEALS-13 — Shopping list collaborative presence ("who's shopping now")

**Size:** small · **Value:** low · **Dependencies:** none

Show a small avatar/indicator on the Shopping tab when another household member currently has the
shopping list open, so two people don't accidentally duplicate a trip.

**Why:** Firestore's real-time `onSnapshot` sync already makes the list live across devices; this
surfaces that liveness as a small social signal at the cost of one ephemeral presence write.

**Implementation notes:** Lightweight presence doc `households/{id}/presence/{uid}` with
`{screen: 'shopping', updatedAt: serverTimestamp()}`, written on mount/unmount of
`ShoppingListTab.tsx` (or a small reusable `usePresence(screen)` hook), refreshed every ~30s while
mounted; treat entries older than ~2 min as stale (computed client-side, no cleanup function
needed). Subscribe via a small bounded listener. Given CLAUDE.md's emphasis on
bounded/minimal listeners, weigh whether the added listener count is worth it — genuinely
nice-to-have, not core.

**Key files:**
- `contexts/household/listeners/shoppingListeners.ts`, `components/meals/ShoppingListTab.tsx`
- `hooks/usePresence.ts` (new), `types/schema.ts`

### F-MEALS-14 — Weekly meal-plan + shopping list print export for the fridge

**Size:** tweak · **Value:** low · **Dependencies:** none

A "Print week" action rendering the current week's planned meals and shopping list as a clean,
print-friendly page. Related, complementary pattern to `TODO.md` §3's G9 (dedicated `/print`
route + `@media print`) — this is a narrower, tab-scoped "print this week" affordance rather than
a standalone fridge-view route; sequence together if G9 is picked up.

**Why:** `utils/shoppingListFormatter.ts` already produces a text-formatted shopping list for
sharing — extending it to also cover the meal-plan week and wiring to `window.print()` is close to
zero marginal engineering cost.

**Implementation notes:** Add `utils/mealPlanFormatter.ts` (mirroring
`utils/shoppingListFormatter.ts`'s shape) rendering the week's `MealPlanItem`s grouped by day/type
into plain-text or simple HTML. Add a "Print / Share week" action in `MealPlanTab.tsx`'s week
overflow menu calling `navigator.share()` (existing pattern) or opening a dedicated print view
with a `@media print` Tailwind utility, per DESIGN.md conventions.

**Key files:**
- `utils/mealPlanFormatter.ts`, `utils/shoppingListFormatter.ts`, `components/meals/MealPlanTab.tsx`

## To-Dos & Lists

### F-TODO-01 — Recurring / repeating to-dos

**Size:** large · **Value:** high · **Dependencies:** none

Let a to-do be marked recurring (weekly/bi-weekly/monthly, mirroring `CalendarItem.frequency`) so
chores like "take out trash" don't need manual re-creation. Completing a recurring task auto-spawns
the next instance; the completed instance stays in history like any other.

**Why:** The #1 flagged gap by the domain explorer: "No task recurring/repeating feature (unlike
calendar items and habits)." The single most-requested category of household chore management
missing from the domain, and the codebase already has a working precedent
(`CalendarItem.frequency`) to model from.

**Implementation notes:** Add `recurrence?: {frequency: 'weekly'|'bi-weekly'|'monthly';
parentRecurringId?: string}` to `ToDo`, mirroring `CalendarItem`'s
`frequency`/`parentRecurringId` fields. On completion, extend `makeCompleteToDo`
(`contexts/household/mutations/todoMutations.ts`) so the SAME writeBatch also creates the
next-instance doc (pre-generate a doc ref, `batch.set`) with `completeByDate` advanced by the
frequency — add a small unit-tested `utils/todoRecurrence.ts` for the date math (or reuse
whatever helper `calendarMutations.ts`'s recurring-item deferral already uses). This keeps
completion + next-instance-spawn atomic, matching CLAUDE.md's `payCalendarItem` atomicity
conventions. Surface a recurrence picker (None/Weekly/Bi-weekly/Monthly) in the add/edit drawer
next to Due Date, plus a repeat-icon badge on `TodoRow.tsx`. Keep `deleteToDo` instance-scoped
(deleting one occurrence shouldn't delete future ones), matching calendar items' `isDeleted`-flag
model if that affordance is wanted later.

**Key files:**
- `types/schema.ts`
- `contexts/household/mutations/todoMutations.ts`, `contexts/household/mutations/calendarMutations.ts`
- `pages/ToDosPage.tsx`, `components/todos/TodoRow.tsx`, `utils/todoRecurrence.ts` (new)

### F-TODO-02 — Completion points for every household member, not just managed kids

**Size:** medium · **Value:** high · **Dependencies:** new household settings toggle; interacts with Kid Mode's points display, which currently assumes only managed kids earn to-do points

Today `computeTodoCompletionCredit` only ever credits a managed kid; a parent or teen who
completes their own to-dos earns nothing. Add a household-level toggle extending the same points
system so any assignee can optionally earn points, feeding the same daily/weekly/total
points/leaderboard habits already use.

**Why:** Habits already have a full points/streak/leaderboard system; to-dos are
gamification-adjacent but currently opt out for everyone except kids. Surfacing this as a
deliberate, toggleable extension respects the existing dormancy-gate design intent rather than
silently changing behavior for existing households.

**Implementation notes:** Add `Household.settings.choresEarnPointsForAll?: boolean` (default
`false`, existing behavior unchanged), toggle in `pages/Settings.tsx`. Modify
`computeTodoCompletionCredit` (`utils/todoPoints.ts`, currently
`if (!assignee || assignee.isManaged !== true) return null`) to accept the setting and, when true,
also credit non-managed assignees at a smaller default (new distinct constant, or reuse
`DEFAULT_TODO_POINTS`). No change needed to the atomic write path — `makeCompleteToDo`
(`contexts/household/mutations/todoMutations.ts`) already batches the completion write with the
member's points increment; it just needs the gate function to return non-null more often. Loosen
`TodoRow.tsx`'s points-badge conditional (currently gated on `assignee?.isManaged === true`) in
tandem so non-kid assignees also see their earned-points chip.

**Key files:**
- `utils/todoPoints.ts`, `contexts/household/mutations/todoMutations.ts`
- `components/todos/TodoRow.tsx`, `pages/Settings.tsx`, `types/schema.ts`

### F-TODO-03 — Task templates ("Quick Task Lists")

**Size:** medium · **Value:** high · **Dependencies:** none

One-tap creation of a bundle of recurring tasks from a saved template — e.g. "Trash day" (take out
trash, bring in bins) or "Guest prep" (clean bathroom, fresh towels, vacuum). Mirrors
`QuickStockList`, already shipped for the Shopping tab.

**Why:** The exact same product shape (`QuickStockList`) already exists and is proven UX for
Shopping; the domain explorer flagged this precise gap ("no equivalent task-template system").
Reusing the pattern minimizes design risk.

**Implementation notes:** Add a `TaskTemplate` interface near `QuickStockList`:
`{id, name, items: {text, assignedTo?, points?}[], icon?, color?}`. Add a Firestore subcollection
`households/{id}/taskTemplates` with a matching converter (`utils/firestoreConverters.ts`).
Attach a listener alongside the existing todo listeners
(`contexts/household/listeners/todoListeners.ts`) and add a `makeTaskTemplateMutations` factory
modeled on `shoppingMutations.ts`'s `addQuickStockList`/`updateQuickStockLists`/
`deleteQuickStockList`. Expose `taskTemplates` + CRUD on the `TodosContextValue` slice. In
`pages/ToDosPage.tsx` add a template picker (chip row, or a Menu item under quick-add's 'details'
button) that on tap calls `addToDo` once per template item with
`completeByDate: getLocalDateString()` and `assignedTo` falling back to the current user.

**Key files:**
- `types/schema.ts`, `utils/firestoreConverters.ts`
- `contexts/household/mutations/todoMutations.ts`, `contexts/household/mutations/shoppingMutations.ts` (pattern to mirror)
- `contexts/household/types.ts`, `contexts/FirebaseHouseholdContext.tsx`, `pages/ToDosPage.tsx`

### F-TODO-04 — Chore rotation & fairness suite

**Size:** suite · **Value:** high · **Dependencies:** builds on F-TODO-01 (recurrence schema) and the "who does what" analytics view below; FCM tokens + `actionQueueReminders` preference must be enabled per member

Turns recurring chores into a fair rotation system: a recurring to-do can be assigned to a
rotating pool of members instead of one fixed person, auto-reassigning to the next person each
recurrence; a fairness indicator shows each member's completed-vs-assigned ratio over the last 30
days; the morning reminder is enriched to call out whose turn it is.

**Why:** Combines three flagged gaps (no recurrence, no analytics, to-dos points-dormant for
adults) into one coherent, higher-ambition surface — the household's answer to "whose turn is it
to take out the trash," genuinely differentiated versus a generic to-do app.

**Implementation notes:** Builds on F-TODO-01's `recurrence` field: extend to `recurrence:
{frequency; rotation?: string[] /* ordered member uids */; rotationIndex?: number}`. When
`makeCompleteToDo`'s recurring-spawn batch creates the next instance, if `rotation` is set it
assigns to `rotation[(rotationIndex + 1) % rotation.length]` and advances `rotationIndex` —
denormalize onto each spawned instance the same way `CalendarItem.parentRecurringId` already
denormalizes recurrence identity, rather than a new parent-doc model. The fairness indicator
reuses the "who does what" analytics view's per-member completion counts, filtered to
recurrence-having tasks. For the reminder digest, extend `sendactionqueuereminders`
(`functions/src/index.ts`) — it already computes each member's incomplete todos due today per
their stored timezone; no new cron needed, just enrich the notification body with rotation
context when marked as a rotating chore. Ship in phases: (1) recurrence + rotation assignment +
tests, (2) fairness view, (3) notification copy enrichment — each independently shippable.

**Key files:**
- `types/schema.ts`, `contexts/household/mutations/todoMutations.ts`, `contexts/household/mutations/calendarMutations.ts`
- `functions/src/index.ts`, `components/todos/TodoStatsDrawer.tsx`, `pages/ToDosPage.tsx`

### F-TODO-05 — "Who does what" completion analytics view

**Size:** large · **Value:** medium · **Dependencies:** optional premium gating via `billingEnabled` + `entitlements.ts` `historyMonths` for windows beyond 30 days

A stats view showing per-member completion counts and on-time rate over the last 7/30 days — a
simple bar chart giving visibility into whether chore load is actually balanced.

**Why:** The domain explorer flagged "no task performance metrics/analytics on completion rates
per assignee" as a gap. The app already has a `components/analytics/` folder with recharts-based
widgets for finance/habits — this extends the pattern to to-dos, and can be premium-gated the same
way weekly recap is, giving billing a second differentiator.

**Implementation notes:** The live todos array is already windowed to a 30-day completed set
(`TODO_COMPLETED_PAGE_SIZE`, `utils/listenerWindows.ts`) plus on-demand older pages via
`loadOlderCompletedTodos`, sufficient for a 30-day view without a new query. For longer windows,
gate on `getLimits(household).historyMonths` (`utils/entitlements.ts`, same free/premium split
used elsewhere) and repeatedly page via `loadOlderCompletedTodos`. Build
`components/todos/TodoStatsDrawer.tsx` (or a chart in `components/analytics/`), grouping
`todos.filter(t => t.isCompleted)` by `assignedTo`, computing count + `completedAt`-minus-
`completeByDate` lateness per member using the same date-parsing already in `ToDosPage.tsx`'s
completed-bucket memo. Add an entry point in the overflow menu. Lazy-load the drawer/chart
component — recharts is already vendor-chunked off the boot path per CLAUDE.md.

**Key files:**
- `pages/ToDosPage.tsx`, `components/todos/TodoStatsDrawer.tsx` (new)
- `utils/entitlements.ts`, `utils/listenerWindows.ts`

### F-TODO-06 — Photo-to-tasklist: snap a whiteboard/note into multiple to-dos

**Size:** small · **Value:** medium · **Dependencies:** none

A camera-capture option photographing a handwritten list (fridge whiteboard, chore chart, paper
note) parsed via Gemini into discrete task lines, each pre-filled and reviewable before being
added as separate to-dos — mirroring the existing grocery-receipt-to-shopping-list flow.

**Why:** Directly reuses the existing Gemini receipt/grocery-parsing infrastructure and
camera-capture UI already proven for `parseGroceryReceipt()`/`analyzeReceipt()` — the household
already snaps photos for shopping and expenses, so a parallel task-list parse is a small marginal
addition.

**Implementation notes:** Add `parseTaskList(imageBase64)` to `services/geminiService.ts`
following the exact shape of `parseGroceryReceipt()`/`analyzeReceipt()` (shared retry/timeout
helper, routed through the `geminiproxy` callable when `VITE_USE_GEMINI_PROXY=true`, direct SDK
otherwise). Add the response type to `services/geminiService.types.ts` (SDK-free, per CLAUDE.md's
External Services section). Reuse/extend the existing camera-capture flow in
`components/modals/CaptureModal.tsx` with a task-list capture mode, or add a dedicated entry point
from `ToDosPage.tsx`'s overflow menu. On parse success, show a review list (checkbox per line,
editable text) before calling `addToDo` once per confirmed line with `completeByDate:
getLocalDateString()`; extend `ToDo.source` with a `'photo'` value alongside `'manual'`/`'voice'`/
`'shortcut'`.

**Key files:**
- `services/geminiService.ts`, `services/geminiService.types.ts`
- `pages/ToDosPage.tsx`, `components/modals/CaptureModal.tsx`, `types/schema.ts`

### F-TODO-07 — quickAddTodo endpoint for iOS Shortcuts / Siri

**Size:** medium · **Value:** medium · **Dependencies:** none

A `quickAddTodo` HTTP Cloud Function so an iOS Shortcut ("add trash day to my LifeBalance list")
can create a to-do without opening the app, mirroring `quickAddHabit`/`quickAddShoppingItem`/
`quickAddNaturalLanguage`.

**Why:** The domain explorer flagged "no API for iOS Shortcuts to read/write todos (unlike
quickAdd expense/habit endpoints)" — the auth/rate-limit/CORS/API-key plumbing already exists.

**Implementation notes:** Add `quickAddTodo` in `functions/src/quickAdd/index.ts` modeled on
`quickAddShoppingItem`/`quickAddHabit`: API-key auth + rate limiting via
`apiKeyValidation.ts` (already fail-closed per `TODO.md` §2B), accepts
`{text, dueDate?, assignedTo?, isImportant?}`, defaults `dueDate` to the caller's local "today" by
forwarding `req.body.today` the same way `quickAddExpense`/`quickAddHabit` already do (Cloud
Functions run in UTC — see CLAUDE.md's habit-tracking timezone notes), resolves `assignedTo` by
display-name fuzzy match against members (adapt `functions/src/quickAdd/accountMatch.ts`'s
matching style if a name string is passed instead of a uid), writes with `source: 'shortcut'`
(already a valid `ToDo.source` value, no schema change). Export alongside existing quickAdd
re-exports in `functions/src/index.ts`. Add a unit test file following
`functions/src/quickAdd/index.test.ts` conventions; extend the `ShortcutSetupGuide` docs.

**Key files:**
- `functions/src/quickAdd/index.ts`, `functions/src/quickAdd/apiKeyValidation.ts`
- `functions/src/index.ts`, `types/schema.ts`

### F-TODO-08 — Lightweight subtask checklist within a task

**Size:** medium · **Value:** medium · **Dependencies:** none

Let a to-do carry an optional checklist of small steps (e.g. "Plan birthday party" → Book venue /
Order cake / Send invites), shown as a mini progress indicator on the row and a checkable list in
the edit drawer.

**Why:** The domain explorer flagged "no task dependencies" and an underused notes field; a
structured checklist is a lower-risk, higher-value alternative to full dependency graphs — one
added array field on the existing single-document `ToDo` model instead of a relational feature.

**Implementation notes:** Add `subtasks?: {id: string; text: string; isDone: boolean}[]` to
`ToDo` (near `notes`/`priority`). No new subcollection — a plain array field; `todoConverter`
needs no special handling beyond passthrough. In the edit drawer add a checklist editor
(add/remove/check rows as local state, persisted via existing `updateToDo`/`addToDo`). On
`TodoRow.tsx`, when `subtasks?.length`, render a compact "n/m done" progress chip next to the
due-date chip (reuse `ProgressBar`/`CountBadge` primitives per the UI-unification-sweep
conventions) with subtask checkboxes toggleable from a popover or expand affordance (pairs
naturally with the notes-indicator idea below). Toggling a subtask is a plain
`updateToDo(id, {subtasks: updatedArray})` — no batch/atomicity concerns since it never touches
points.

**Key files:**
- `types/schema.ts`, `pages/ToDosPage.tsx`
- `components/todos/TodoRow.tsx`, `utils/firestoreConverters.ts`

### F-TODO-09 — Assignee filter chips

**Size:** small · **Value:** medium · **Dependencies:** none

A horizontal row of member-avatar filter chips above the active-view sections/quadrants ('All',
then one per member). Tapping filters every visible section/quadrant to that assignee's tasks.

**Why:** The domain explorer flagged "no task filtering UI (must use search overlay for
discovery)." The single highest-leverage filter given tasks are always assigned to exactly one
member.

**Implementation notes:** In `ToDosPage.tsx` add `const [assigneeFilter, setAssigneeFilter] =
useState<string | null>(null)` (session-only, transient — not persisted). Apply inside the
existing `useMemo`s that build `{immediate, upcoming, radar}` and the quadrants, filtering on
`t.assignedTo === assigneeFilter` before categorization. Render chips using the same avatar-button
visual pattern already used in the assign-to fieldset, placed above the sticky quick-add. Skip
rendering entirely when `members.length <= 1`.

**Key files:**
- `pages/ToDosPage.tsx`

### F-TODO-10 — Batch reassign in the floating action bar

**Size:** small · **Value:** medium · **Dependencies:** none

The batch selection FAB currently offers Complete, Reschedule, Delete. Add a fourth action,
Reassign, opening a small member picker and updating `assignedTo` on every selected task in one
batch.

**Why:** Natural sibling to the existing batch-reschedule flow — same shape of problem (bulk
`updateToDo` across `selectedIds`), and a common real need: moving last week's overflow from one
person to another.

**Implementation notes:** Add `BatchReassignModal.tsx` modeled directly on
`BatchRescheduleModal.tsx` (same `isOpen`/`onClose`/`onConfirm`/`count` shape, swapping the date
picker for the member-chip picker already used in the assign-to fieldset). Add
`isBatchReassignOpen` state and a `handleBatchReassign(uid)` mirroring `handleBatchReschedule` but
calling `updateToDo(id, {assignedTo: uid})` via `Promise.allSettled` over `selectedIds`. Add the
FAB button next to Reschedule with a `User` icon (lucide-react).

**Key files:**
- `pages/ToDosPage.tsx`, `components/modals/BatchRescheduleModal.tsx`, `components/modals/BatchReassignModal.tsx` (new)

### F-TODO-11 — Instant undo toast on task completion

**Size:** tweak · **Value:** medium · **Dependencies:** none

Completing a task shows a plain success toast with no way to reverse it short of switching to the
Completed tab. Show an undo action directly in that success toast, mirroring the
`DeleteUndoToast` pattern already shipped for shopping-list deletes (PR #898).

**Why:** The exact UX precedent already shipped recently — porting it to todo completion is
low-risk and closes a rough edge in the most frequent interaction on the page.

**Implementation notes:** Add an `UndoToast` modeled on `ShoppingListTab.tsx`'s local
`DeleteUndoToast`, either duplicated into `TodoRow.tsx` or generalized into
`components/ui/UndoToast.tsx`. Wire into `TodoRow.tsx`'s `handleComplete`: replace
`toast.success('To-Do completed!')` with `toast.custom` rendering the undo toast whose `onUndo`
calls `updateToDo(id, {isCompleted: false, completedAt: undefined})` (same call
`ToDosPage.tsx`'s `handleUncomplete` already uses), then `toast.dismiss`. Requires threading an
`onUncomplete`/`updateToDo` capability down through `Section.tsx` into `TodoRow.tsx` (currently
only passed to `CompletedSection`). **Gotcha:** `completeToDo`'s kid-points credit
(`todoMutations.ts`, a `writeBatch` with a member points increment) is NOT reversed by a plain
`updateToDo` uncomplete — for a managed-kid assignee, undo must also decrement points in a batch
mirroring `completeToDo`'s credit logic, or the toast should be suppressed/annotated for
kid-assigned tasks until that's handled.

**Key files:**
- `components/todos/TodoRow.tsx`, `components/todos/Section.tsx`
- `pages/ToDosPage.tsx`, `contexts/household/mutations/todoMutations.ts`

### F-TODO-12 — Sort control for list sections and quadrants

**Size:** tweak · **Value:** low · **Dependencies:** none

Immediate/Upcoming/Radar sections and Eisenhower quadrants are always sorted by due date,
hardcoded. Add a small sort dropdown (Due date / Alphabetical / Assignee) in the page header,
persisted per-device like the arrangement choice.

**Why:** The domain explorer flagged "no task sorting options within sections" as a gap — a user
with a long Radar section currently has no way to group by who owns what.

**Implementation notes:** Add a `SORT_KEY` localStorage-persisted `sortMode`
(`'due'|'alpha'|'assignee'`) state, same pattern as `ARRANGEMENT_KEY`/`setArrangementPersisted`.
Replace the hardcoded `sortByCompleteByDate` comparator and the quadrant `byDueDate` comparator
(`utils/eisenhower.ts`'s `isUrgent`/`quadrantForTodo` unaffected) with a comparator selected by
`sortMode`; assignee sort needs `memberMap` for display-name lookup so keep it in `ToDosPage`
rather than `eisenhower.ts`. Add a compact control near the existing arrangement `Button` using
`components/ui/Menu.tsx`.

**Key files:**
- `pages/ToDosPage.tsx`, `utils/eisenhower.ts`

### F-TODO-13 — Notes indicator + inline expand on task rows

**Size:** tweak · **Value:** low · **Dependencies:** none

`ToDo` already has an optional `notes` field but `TodoRow` never renders it. Add a small note icon
next to the due-date chip when `item.notes` is non-empty, and let tapping it expand a truncated
notes preview inline (2-line clamp) without opening the full edit drawer.

**Why:** The data model already supports this; a pure display gap. Cheapest possible win — no
schema or mutation change.

**Implementation notes:** In `TodoRow.tsx`'s metadata row, add a conditional chip when
`item.notes` is set (a `FileText` icon from lucide-react, already imported elsewhere in the file).
Add local `useState(false)` for `notesOpen` and render a line-clamp-2 `<p>` when open, toggled by
tapping the chip with `stopPropagation` so it doesn't trigger selection-mode toggling. Notes
already round-trip through `addToDo`/`updateToDo` and `todoConverter` untouched.

**Key files:**
- `components/todos/TodoRow.tsx`, `types/schema.ts`

## Dashboard & AI

### F-DASH-01 — Dashboard universal AI quick-capture bar

**Size:** medium · **Value:** high · **Dependencies:** AI kill-switch (`aiEnabled`) must be on; reuses `parseMagicAction` (already shipped)

A persistent free-text input pinned near the top of the Dashboard (built on `QuickAddBar`) that
accepts natural language — "spent $12 at Target," "buy milk," "call the vet tomorrow" — and routes
it through the already-built `parseMagicAction()` classifier to create a transaction, shopping
item, or todo directly, without opening the full `CaptureModal`.

**Why:** `parseMagicAction` today is only reachable via `CaptureModal`'s "Magic" tab — an extra
open-modal-then-switch-tab step. This reuses three already-shipped pieces (the `QuickAddBar`
primitive, the `parseMagicAction` classifier, each domain's existing add mutations) to remove
friction for the single most common capture action, right from the page users land on.

**Implementation notes:** New `components/dashboard/QuickCaptureBar.tsx` wrapping
`components/ui/QuickAddBar.tsx`. On submit, call `parseMagicAction(householdId, text,
{categories, groceryCategories, stores, todayDate})` — extract the context-building logic out of
`components/modals/CaptureMagicAction.tsx` into a shared helper both call, rather than duplicating
it. Branch on `result.type` to call `useFinance().addTransaction`, `useTodos().addToDo`, or
`useShopping().addShoppingItem`, matching `CaptureMagicAction`'s existing status/`needsAmount`
conventions. Show a toast with an "Edit" action opening the relevant existing edit drawer so a
misparse is one tap to correct. Mount above the Action Queue in `pages/Dashboard.tsx`, gated on
`getAiEnabled()`.

**Key files:**
- `components/dashboard/QuickCaptureBar.tsx` (new), `components/modals/CaptureMagicAction.tsx`
- `services/geminiService.ts`, `pages/Dashboard.tsx`, `contexts/FirebaseHouseholdContext.tsx`

### F-DASH-02 — AI Daily Briefing push notification

**Size:** suite · **Value:** high · **Dependencies:** FCM push already configured; reuses the existing per-timezone scheduled-function pattern

An opt-in daily push, delivered in each member's local morning per their stored timezone,
summarizing in one or two AI-written sentences what needs attention today — bills due,
pending-review count, a streak at risk, today's habit consistency — delivered proactively instead
of requiring the user to open the app.

**Why:** Every building block already exists individually: four scheduled, per-member-timezone
notification Cloud Functions, a working server-side Gemini call path (the weekly recap generator
already calls Gemini directly server-side), and an opt-out `NotificationPreferences` pattern. This
is a genuinely new delivery *channel* (push vs. in-app card), non-duplicative of any in-app
proactive-insight idea.

**Implementation notes:** New scheduled Cloud Function `functions/src/dailyBriefing/index.ts`
that, per household per member's stored timezone (mirror `formatInTimeZone` in
`sendstreakwarnings`/`sendbillreminders`), assembles the same inputs `useActionQueue`/
`PulseStripWidget` compute client-side (due calendar items, pending-review transactions, today's
habit completion rate, streaks at risk — reuse helpers from `functions/src/recap/dataAssembly.ts`
where they overlap instead of reimplementing). Feed a short structured summary into a new minimal
`generateBriefingText()` Gemini call (single-sentence `{text: string}` schema) using the same
direct-SDK server-side pattern `functions/src/recap/index.ts` already uses (not the client-facing
`geminiproxy` callable, since this is function-to-function). Send via the existing FCM helper in
`functions/src/shared/notifications.ts` with a deep link into `/`. Add `dailyBriefing:
{enabled, time}` to `NotificationPreferences`, default OFF (unlike `weeklyRecap`'s default-ON,
since this is a new higher-frequency channel), toggle in `NotificationSettings.tsx`. Consider a
per-household cost check against `entitlements.ts`'s AI daily quota since this adds one Gemini
call per household per day.

**Key files:**
- `functions/src/dailyBriefing/index.ts` (new), `functions/src/shared/notifications.ts`, `functions/src/recap/dataAssembly.ts`
- `functions/src/index.ts`, `types/schema.ts`, `components/settings/NotificationSettings.tsx`

### F-DASH-03 — Habit Coach card (wire up `analyzeHabitPatterns`)

**Size:** medium · **Value:** high · **Dependencies:** none (`analyzeHabitPatterns` already shipped and tested)

New dashboard widget surfacing `analyzeHabitPatterns()` — a fully implemented, unit-tested Gemini
function that returns 3-5 "praise / critique / suggestion" insights (e.g. "Weekend Slump
Detected") but is currently called from nowhere in the UI — as a small card near
`DailyHabitsWidget`, with its own manual refresh mirroring `InsightWidget`'s pattern.

**Why:** This is dead but fully paid-for backend capability (prompt, schema, validation, and tests
already exist); wiring it up is the highest-leverage new surface in this domain for the least new
AI-plumbing work.

**Implementation notes:** Add `makeRefreshHabitPatterns` to
`contexts/household/mutations/coreMutations.ts` modeled directly on `makeRefreshInsight`, writing
to a single household-scoped doc (`households/{id}/habitInsights/current`, not a growing
collection since these are ephemeral/regenerable) with `patterns: HabitPatternInsight[]` +
`generatedAt`. New `components/dashboard/HabitCoachWidget.tsx` consumes
`useGamification().habits`, calls `analyzeHabitPatterns(householdId, habits)`, renders each
`HabitPatternInsight` as a Row with an icon keyed off `type` (`praise`→Trophy,
`critique`→AlertTriangle, `suggestion`→Lightbulb, lucide-react). Mount in `pages/Dashboard.tsx`
right after `DailyHabitsWidget`, gated on `isModuleEnabled('habits')`. No new backend endpoint
needed — `analyzeHabitPatterns` already routes through `generateJsonContent` → the existing
geminiProxy/quota path.

**Key files:**
- `services/geminiService.ts`, `services/geminiService.types.ts`
- `contexts/household/mutations/coreMutations.ts`, `contexts/household/types.ts`
- `components/dashboard/HabitCoachWidget.tsx` (new), `pages/Dashboard.tsx`

### F-DASH-04 — Itemized receipt line-item splitting

**Size:** large · **Value:** high · **Dependencies:** none

When scanning a receipt, extract individual line items (not just a merchant total) and let the
user split one physical purchase into several categorized transactions — e.g. a Target run
becomes a $40 Groceries transaction plus a $25 Household transaction — instead of forcing the
whole receipt into a single bucket the way `analyzeReceipt` does today.

**Why:** `analyzeReceipt` only returns `{merchant, amount, category, date, suggestedHabits,
store}` — a single lump category — even though line-item OCR clearly already exists for groceries
(`parseGroceryReceipt`) and multi-row extraction exists for bank statements
(`parseBankStatement`). Generalizing that capability directly serves the app's bucket-based
budgeting model, which currently can't represent a mixed-category trip accurately.

**Implementation notes:** Add `parseReceiptLineItems(householdId, base64Image,
availableCategories)` to `services/geminiService.ts` modeled on `parseGroceryReceipt`'s
line-item schema but returning `{merchant, date, store, items: Array<{description, amount,
category}>}`. Extend `Transaction` with optional `receiptGroupId?: string` so N line-item
transactions can be visually grouped (`TransactionMasterList.tsx`) without inventing a new
document type; update the transaction converter for the new optional field. In
`CaptureModal.tsx`'s receipt tab, when OCR returns more than one item, show a review step letting
the user adjust/merge/delete line items before commit — copy the UI pattern from the existing
multi-transaction bank-statement review flow (closest existing precedent for "array of
transactions from one image"). On confirm, call `useFinance().addTransaction` once per surviving
line item, all sharing the same generated `receiptGroupId` and `date`.

**Key files:**
- `services/geminiService.ts`, `services/geminiService.types.ts`, `types/schema.ts`
- `utils/firestoreConverters.ts`, `components/modals/CaptureModal.tsx`, `components/budget/TransactionMasterList.tsx`

### F-DASH-05 — Scoped insight regeneration (Spending / Habits / Surprise me)

**Size:** small · **Value:** medium · **Dependencies:** none

A small segmented control next to "Get Insight" letting the user pick a lens — Spending, Habits,
or Surprise me — before generating, so the AI insight targets the domain the user actually wants.

**Why:** `generateInsight` already takes transactions and habits separately; scoping is a matter
of slicing inputs and adding one prompt line, and it fixes a latent gap where the written
`Insight.type` is always hardcoded to `'general'` even though `InsightWidget` already has dormant
domain-gating logic keyed on `'spending'`/`'habits'`.

**Implementation notes:** Extend `generateInsight()` with an optional `focus?: 'spending' |
'habits'` param slicing `simplifiedTransactions`/`simplifiedHabits` to just that domain and
appending a one-line prompt hint. Thread `focus` through `makeRefreshInsight`
(`contexts/household/mutations/coreMutations.ts`) and write it as the new Insight's `type`
(`focus ?? 'general'`) instead of the current always-`'general'` literal — this activates the
existing `insightDomainHidden` gating already written in `InsightWidget.tsx`. Add the segmented
control to `InsightWidget`'s action row, hiding Spending/Habits options per `isModuleEnabled`.

**Key files:**
- `services/geminiService.ts`, `contexts/household/mutations/coreMutations.ts`
- `contexts/household/types.ts`, `components/dashboard/InsightWidget.tsx`

### F-DASH-06 — AI usage transparency meter

**Size:** small · **Value:** medium · **Dependencies:** reads the existing quota-tracking doc `geminiProxy` already writes

Show "X of Y AI requests used today" as a small caption near "Get Insight," using the entitlement
limits and daily-usage counter that already exist server-side but today are only visible to the
admin via the Developer Console.

**Why:** `utils/entitlements.ts` already computes `getLimits(household).aiDailyCap`, and the
geminiProxy quota transaction already tracks per-household daily usage; surfacing it builds user
understanding of the AI cap and primes the eventual premium upsell once `billingEnabled` flips on.

**Implementation notes:** Locate the existing per-household daily usage read used by the Developer
Console's AI meter (grep `DeveloperConsole.tsx`) and reuse the same doc/collection shape. Add a
small one-shot/listener read in `InsightWidget.tsx` (or a small hook `useAiUsageToday()`)
computing `used` vs `getLimits(household).aiDailyCap`, render `{used}/{cap} AI requests today` in
the widget header, hidden when usage is 0 or the read fails (fail-quiet, matching the app's other
degrade-gracefully widgets).

**Key files:**
- `components/dashboard/InsightWidget.tsx`, `components/modals/DeveloperConsole.tsx`
- `utils/entitlements.ts`, `services/geminiService.ts`

### F-DASH-07 — Streaks-at-risk quick actions in Weekly Recap

**Size:** small · **Value:** medium · **Dependencies:** none

In `WeeklyRecapDrawer`'s "Streaks at risk" list, add an inline "Mark done today" button per habit
(when not already completed today) so a user who notices a threatened streak can save it without
leaving the recap.

**Why:** The data already exists (`recap.streaksAtRisk`); today it's a static, non-actionable list
even though the whole point of surfacing it is to prompt action.

**Implementation notes:** `WeeklyRecap.streaksAtRisk` entries currently carry only `{habitTitle,
streakDays}` with no habit id — add `habitId` there and in the server-side writer
`functions/src/recap/dataAssembly.ts` (update `dataAssembly.test.ts` accordingly). In
`WeeklyRecapDrawer.tsx`, pull `habits` from `useGamification()` and the atomic toggle from
`hooks/useHabitActions.tsx`, resolve each entry by `habitId`, render a Button calling the habit
toggle for today's date when not yet completed; hide/disable once done.

**Key files:**
- `types/schema.ts`, `functions/src/recap/dataAssembly.ts`, `functions/src/recap/dataAssembly.test.ts`
- `components/dashboard/WeeklyRecapDrawer.tsx`, `hooks/useHabitActions.tsx`

### F-DASH-08 — Point-rebalance nudge (wire up `analyzeHabitPoints`)

**Size:** medium · **Value:** medium · **Dependencies:** none (`analyzeHabitPoints` already shipped and tested)

A periodic, dismissible card running the already-built `analyzeHabitPoints()` to suggest
raising/lowering a habit's `basePoints` when it's clearly over- or under-rewarding relative to
actual effort/frequency, with one-tap Apply or Dismiss.

**Why:** Like the Habit Coach card, `analyzeHabitPoints` is implemented and tested but has zero UI
callers — this closes that loop for the points-tuning use case specifically.

**Implementation notes:** New `components/dashboard/PointRebalanceCard.tsx` (or a second tab
inside `HabitCoachWidget` if built together) calling `analyzeHabitPoints(householdId, habits)`,
returning `HabitPointAdjustmentSuggestion[]`. Render the top suggestion; "Apply" calls
`useGamification().updateHabit(id, {basePoints: suggested})`; "Dismiss" persists a per-habit
cooldown (localStorage or a `lastPointReviewAt` ISO timestamp on `Household` via a small new
mutation next to `setHouseholdCurrency`). Gate visibility on a cadence check (don't re-offer
within 30 days) so it doesn't nag on every visit.

**Key files:**
- `services/geminiService.ts`, `services/geminiService.types.ts`
- `components/dashboard/PointRebalanceCard.tsx` (new), `contexts/household/mutations/coreMutations.ts`, `types/schema.ts`

### F-DASH-09 — Shareable weekly recap card

**Size:** medium · **Value:** medium · **Dependencies:** none

A "Share" button in `WeeklyRecapDrawer` rendering the week's headline numbers (spend vs. last
week, habit completions, top streak) as a branded image, handed to the Web Share API (or a
download link) — a Spotify-Wrapped-style moment built entirely from data already server-computed.

**Why:** `WeeklyRecap` already carries every needed number; pure client-side rendering, no new AI
call or backend work.

**Implementation notes:** Add `utils/recapShareCard.ts` exporting `renderRecapShareCard(recap):
Promise<Blob>` drawing to an offscreen `<canvas>` using DESIGN.md's brand-*/accent-*/warm-* token
hex values (canvas text can't reliably consume `@font-face` without pre-loading via the FontFace
API — either preload `public/fonts/besley*.woff2` or fall back to a system serif). Add a Share
button in `WeeklyRecapDrawer.tsx` calling `navigator.share({files: [...]})` when
`navigator.canShare` supports files, falling back to an `<a download>` on the generated blob.
Track `recap_shared` (register in `docs/PRODUCT_ROADMAP.md` Part 7).

**Key files:**
- `utils/recapShareCard.ts` (new), `components/dashboard/WeeklyRecapDrawer.tsx`, `services/analytics.ts`, `docs/PRODUCT_ROADMAP.md`

### F-DASH-10 — "Explain this number" tap-to-ask AI

**Size:** medium · **Value:** medium · **Dependencies:** none

Tapping a headline stat — PulseStrip's Spent/Consistency figures, or the recap's spend delta —
opens a small inline popover with a one-sentence, on-demand AI explanation of why the number
moved, rather than waiting for the pre-written weekly narrative.

**Why:** Gives raw stat-band numbers narrative context in the moment, using the same
transaction-summarization approach `generateInsight` already does, just scoped to one metric and
called ad hoc.

**Implementation notes:** Add `explainMetric(householdId, metricLabel, contextData)` to
`services/geminiService.ts` following `generateInsight`'s exact pattern (`generateJsonContent`,
`sanitizeForPrompt`, geminiProxy/quota path) but with a small pre-filtered data slice (e.g. just
this week's transactions for "Spent") and a minimal `{text: string}` response schema — no actions.
Add a small `HelpCircle` icon button (16px) next to the stat in `PulseCell`
(`PulseStripWidget.tsx`) calling it and showing the answer in a lightweight popover with a loading
skeleton; check `components/ui` for an existing Popover primitive first, otherwise build a minimal
absolutely-positioned one. Cache the answer per session (ref keyed by metric + day) so repeat taps
don't burn AI quota.

**Key files:**
- `services/geminiService.ts`, `services/geminiService.types.ts`, `components/dashboard/PulseStripWidget.tsx`, `components/ui/`

### F-DASH-11 — Insight thumbs up/down feedback

**Size:** tweak · **Value:** medium · **Dependencies:** none

Add thumbs-up/down buttons under the AI Insight text so the household can flag whether an insight
was useful, stored on the insight doc and fed back into the next `generateInsight` call as an
"avoid this style" list.

**Why:** Nearly free UI riding on data that already exists; gives the product its first quality
signal on AI output with essentially no new infrastructure.

**Implementation notes:** Add optional `feedback?: 'up' | 'down'` to `Insight`. Add a
`rateInsight(insightId, feedback)` mutation next to `makeRefreshInsight`
(`contexts/household/mutations/coreMutations.ts`, plain `updateDoc`), expose on the core slice.
Add two small icon buttons under the insight paragraph in `InsightWidget.tsx`. Track
`insight_rated` (register in `docs/PRODUCT_ROADMAP.md` Part 7). Optionally pass
`insightsHistory.filter(i => i.feedback === 'down').slice(0,3).map(i => i.text)` as an extra
negative-example list into `generateInsight`'s prompt.

**Key files:**
- `types/schema.ts`, `contexts/household/mutations/coreMutations.ts`, `contexts/household/types.ts`
- `components/dashboard/InsightWidget.tsx`, `services/geminiService.ts`, `docs/PRODUCT_ROADMAP.md`

### F-DASH-12 — Insight archive filter and search

**Size:** small · **Value:** low · **Dependencies:** none

Add type filter chips (All / Spending / Habits / General) and a text search box to
`InsightsArchiveModal` so users can find a specific past insight instead of scrolling a flat
chronological list.

**Why:** `insightsHistory` is already fully loaded via `loadAllInsights()` when the modal opens;
pure client-side filtering over existing data using primitives already in the design system.

**Implementation notes:** In `InsightsArchiveModal.tsx` add local `typeFilter`/`query` state;
render a segmented control bound to `Insight['type']` above the `SurfaceList`; filter
`insightsHistory` client-side with `.filter(i => (typeFilter === 'all' || i.type === typeFilter)
&& i.text.toLowerCase().includes(query.toLowerCase()))`; reuse `EmptyState` for a distinct "no
matches" state vs the existing "no insights yet" state.

**Key files:**
- `components/modals/InsightsArchiveModal.tsx`

### F-DASH-13 — Tappable PulseStrip cells

**Size:** tweak · **Value:** low · **Dependencies:** none

Make the "Spent" and "Consistency" cells in `PulseStripWidget` tap targets: Spent navigates to
Money → Trends, Consistency navigates to Habits.

**Why:** Reuses the exact `navigate('/budget', {state: {tab: 'trends'}})` call already present in
`pages/Dashboard.tsx`'s header button; turns a static stat band into a real navigation shortcut
for almost no code.

**Implementation notes:** In `PulseStripWidget.tsx`, change `PulseCell` to optionally wrap its
content in a `<button>` when an `onClick`/`aria-label` prop is passed; import `useNavigate` and
call `navigate('/budget', {state: {tab: 'trends'}})` for Spent and `navigate('/habits')` for
Consistency. Only wire the click when the corresponding module is enabled (`showSpend`/
`showHabits` already gate rendering).

**Key files:**
- `components/dashboard/PulseStripWidget.tsx`

## Notifications & Server Jobs

Note: F-HABITS-10 (Partner-nudge / "Nudge a housemate") lives in the Habits & Gamification
section since it was merged there — a housemate-nudge callable serving both habit and money
surfaces. Quiet hours / DND is listed once here (cross-cutting critic and this domain proposed the
same feature); the per-category-only variant below is the fuller spec.

### F-NOTIF-01 — Quiet hours / do-not-disturb window

**Size:** small · **Value:** high · **Dependencies:** none

Users set a nightly window (e.g. 9pm-7am) during which push notifications are suppressed or
deferred, so streak warnings and bill reminders don't wake anyone or interrupt dinner. *(Merged
with the critic's cross-cutting "Global quiet hours / notification digest schedule" idea — same
feature, one spec.)*

**Why:** All four hourly jobs and budget alerts currently fire any hour the per-type `time`
matches; there's no global do-not-disturb, a common expectation for household apps with several
members and habits risking notification fatigue.

**Implementation notes:** Add `NotificationPreferences.quietHours?: {enabled, start, end}` (local
HH:mm) to `types/schema.ts`. Each of the four scheduled Cloud Functions in
`functions/src/index.ts` already computes "today" in the member's stored timezone via
`formatInTimeZone` — extend that same per-member timezone-aware check to also test
current-local-time-in-window before sending; apply uniformly across habit/actionQueue/streak/bill
jobs via a shared gate in `functions/src/shared/notifications.ts`'s `isTimeToSend`/
`sendNotificationToUser`. Budget alerts (Firestore-triggered, not scheduled) need a "defer to
window end" queue doc rather than just skip, or simplest: suppress and rely on the next trigger.
Add one time-range control (not per-category) in `NotificationSettings.tsx` above the existing
per-type toggles.

**Key files:**
- `types/schema.ts`, `functions/src/shared/notifications.ts`, `functions/src/index.ts`
- `components/settings/NotificationSettings.tsx`

### F-NOTIF-02 — In-app notification inbox/history

**Size:** medium · **Value:** high · **Dependencies:** none

A bell icon with a scrollable feed of past notifications (bill reminders, streak warnings, recap,
budget alerts) the user can revisit — useful when a push was missed, dismissed, or the device was
offline.

**Why:** Currently notifications are fire-and-forget: `sw.js` shows them once and there's no
persisted record; users lose context if they swipe away a push.

**Implementation notes:** New Firestore subcollection `households/{id}/notificationLog/{id}`
written by `sendNotificationToUser` alongside the FCM send. Client listener (bounded, newest-first
like recaps) in a new slice or extending `useHouseholdCore`; new `NotificationInboxDrawer`
component; mark-read state per member.

**Key files:**
- `functions/src/shared/notifications.ts`, `contexts/household/listeners/`
- `components/layout/TopToolbar.tsx`, `types/schema.ts`

### F-NOTIF-03 — Digest mode (daily/weekly single summary push)

**Size:** medium · **Value:** medium · **Dependencies:** none, but coordinate with the planned cron-dispatcher merge (`TODO.md` §2A)

Opt into one consolidated daily push ("3 bills due, 2 habits pending, streak at risk") instead of
separate pushes throughout the day.

**Why:** The four hourly jobs each send independently; a household member with all four enabled
can get 4+ separate pushes in a day. A digest reduces notification fatigue while preserving reach.

**Implementation notes:** New `NotificationPreferences.digestMode{enabled, time}` flag; when
enabled, the four hourly jobs skip per-type sends for that member and a new scheduled function (or
the existing `actionQueueReminders` job extended) aggregates pending items across habit/bill/streak
state at the user's digest time and sends one push. Build the digest aggregation to reuse whatever
shared aggregation the already-planned 4-cron dispatcher merge (`TODO.md` §2A) introduces, rather
than building a second one.

**Key files:**
- `functions/src/shared/notifications.ts`, `types/schema.ts`, `components/settings/NotificationSettings.tsx`

### F-NOTIF-04 — FCM token health & multi-device management UI

**Size:** small · **Value:** medium · **Dependencies:** requires a data migration

Settings shows which devices are registered for push ("iPhone - last active 2 days ago," "Chrome
on Desktop") and lets users remove stale/duplicate tokens instead of the array silently
accumulating.

**Why:** `fcmTokens` is currently a plain string array with no per-token metadata; users have no
visibility or control over which devices receive pushes.

**Implementation notes:** Change `fcmTokens` from `string[]` to `{token, addedAt, deviceLabel,
lastUsedAt}[]` (needs a data migration since existing docs are flat strings — write a
converter/migration similar to the bucket-color migration pattern). UI in
`NotificationSettings.tsx` to list/revoke.

**Key files:**
- `types/schema.ts`, `services/notificationService.ts`, `components/settings/NotificationSettings.tsx`, `utils/migrations/`

### F-NOTIF-05 — Notification action buttons (mark done / snooze) in `sw.js`

**Size:** medium · **Value:** medium · **Dependencies:** none

Bill-reminder and habit-reminder pushes get inline action buttons ("Mark Paid," "Snooze 1hr,"
"Complete") so users can act without opening the app.

**Why:** `sw.js` currently has no `actions:[]` array on `showNotification` and no per-action click
routing — pure additive capability, high perceived polish for a PWA.

**Implementation notes:** Add an `actions` array to the payload built server-side per notification
type; extend `sw.js`'s `notificationclick` handler to branch on `event.action` and either
postMessage the open client or hit a lightweight authenticated Cloud Function endpoint (new
`quickAction` HTTP function) to mutate Firestore directly since there may be no open window;
requires action semantics to be safe without full app context.

**Key files:**
- `public/sw.js`, `functions/src/shared/notifications.ts`, `functions/src/index.ts`

### F-NOTIF-06 — Smart bill-reminder lead time (learn from pay cycle)

**Size:** small · **Value:** medium · **Dependencies:** none

Instead of a fixed `daysBeforeDue`, the reminder lead time auto-suggests based on the household's
pay period cadence so reminders land right after a paycheck lands, not before.

**Why:** `billReminders.daysBeforeDue` is a flat user-set number (1-7); many users don't tune it
and miss the sweet spot relative to when checking balance is actually funded.

**Implementation notes:** Compute a suggested lead time from `calendarItems` income cadence
(existing pay-period expansion logic already in `useExpandedCalendarItems`) and surface it as a
one-time suggestion chip in `NotificationSettings.tsx`; `sendbillreminders` job logic itself is
unchanged.

**Key files:**
- `components/settings/NotificationSettings.tsx`, `utils/safeToSpendCalculator.ts`

### F-NOTIF-07 — Web App Badging (unread count on home-screen icon)

**Size:** small · **Value:** medium · **Dependencies:** Badging API browser support (Chromium-based only; no-op elsewhere)

The PWA icon shows a small numeric badge (e.g. count of unpaid bills due soon + at-risk streaks)
when installed to home screen. *(Same mechanism as the critic's cross-cutting "PWA app badge for
pending action-queue count" — merged; the count source can be either the notifications-domain
figure or `useActionQueue`'s figure, pick one source of truth when implementing.)*

**Why:** No `navigator.setAppBadge` usage exists anywhere in the codebase currently; near-zero-cost
win for an already-PWA app with home-screen install flows.

**Implementation notes:** Call `navigator.setAppBadge(count)`/`clearAppBadge()` on relevant state
changes (unpaid bills count, at-risk streaks, or `useActionQueue`'s existing count — reuse rather
than compute twice) from a small hook wired into `FirebaseHouseholdContext.tsx` or a dedicated
`useAppBadge` hook; feature-detect (`'setAppBadge' in navigator` — iOS Safari support is spotty,
must no-op gracefully). Also update the badge from `sw.js` on push receipt for background updates.

**Key files:**
- `hooks/`, `contexts/FirebaseHouseholdContext.tsx`, `public/sw.js`, `hooks/useActionQueue.ts`

### F-NOTIF-08 — Low-balance alert tuning: relative + trend-based thresholds

**Size:** small · **Value:** medium · **Dependencies:** trend mode needs a new snapshot collection

Let `budgetAlerts` trigger not just on an absolute dollar threshold crossing but also on a
percentage-of-typical-balance drop or a "trending toward zero within N days" prediction.

**Why:** `budgetAlerts.threshold` is a single flat number today (default $100); household spending
patterns vary widely, so a fixed number is either too noisy or too late for different households.

**Implementation notes:** Extend `budgetAlerts` prefs with `mode: 'absolute'|'percent'|'trend'`;
trend mode needs a rolling average of `safeToSpend` history, which doesn't currently exist as a
stored series — would need a lightweight daily snapshot write (new subcollection) to compute a
slope (can share the Net Worth History snapshot mechanism from F-MONEY-09 if that ships first).
Keep absolute as default/simple case.

**Key files:**
- `functions/src/shared/notifications.ts`, `types/schema.ts`, `components/settings/NotificationSettings.tsx`

### F-NOTIF-09 — Weekly recap push-open deep content teaser

**Size:** tweak · **Value:** low · **Dependencies:** none

The weekly recap push body includes a real headline stat ("You saved $120 more than last week")
instead of a generic "Your recap is ready" message, increasing open rate.

**Why:** `sendweeklyrecap` already computes the full `WeeklyRecap` doc server-side before sending
the push; the push body can pull one headline number from data it already has.

**Implementation notes:** In `functions/src/recap/index.ts`, after building the `WeeklyRecap` doc,
pass a computed headline string into the notification payload body instead of a static string.

**Key files:**
- `functions/src/recap/index.ts`

### F-NOTIF-10 — Per-notification-type custom sound/vibration pattern

**Size:** tweak · **Value:** low · **Dependencies:** none

Streak warnings vibrate differently than bill reminders, so users can distinguish urgency by feel
alone.

**Why:** `sw.js` already sets a generic `vibrate` pattern on every notification; differentiating by
`type` in the payload is a near-trivial addition.

**Implementation notes:** `sw.js`'s push handler already parses a payload `type` field for
`?nsrc=` attribution — reuse that to pick a vibrate array per type (e.g. `streakWarning`:
long-short-long, `billReminder`: two short pulses).

**Key files:**
- `public/sw.js`

### F-NOTIF-11 — Snooze a specific reminder type for N days

**Size:** tweak · **Value:** low · **Dependencies:** none

From the notification itself or Settings, snooze e.g. bill reminders for 3 days (useful right
after paying bills manually) without disabling the whole category permanently.

**Why:** Today it's all-or-nothing enabled/disabled per type; a temporary snooze is a common
pattern users expect and is a small addition on top of existing per-type enabled flags.

**Implementation notes:** Add `snoozedUntil?: string` (yyyy-MM-dd) per notification-type
sub-object in `NotificationPreferences`; the hourly job's gate checks `snoozedUntil` in addition
to `enabled` before sending.

**Key files:**
- `types/schema.ts`, `functions/src/shared/notifications.ts`, `components/settings/NotificationSettings.tsx`

## Platform & Growth

Note: TODO.md §3 already tracks the landing page/waitlist decision (DIR-08), referral/invite
rewards, achievements/badges, year-in-review, i18n, multi-household switching, TWA/app-store wrap,
and a re-consent flow as pre-traction/deferred. F-PLAT-04 below (in-app waitlist capture) is a
narrower, code-only alternative that needs neither a landing page nor a domain decision — flagged
as distinct, not a duplicate.

### F-PLAT-01 — PWA install prompt capture + custom banner

**Size:** medium · **Value:** high · **Dependencies:** none

Listen for the browser's `beforeinstallprompt` event, suppress the native mini-infobar, and show
LifeBalance's own "Add to Home Screen" banner at a well-timed moment (e.g. after the first habit
completion or third session) with dismiss-and-remember.

**Why:** `public/manifest.json` is fully configured (standalone display, icons, shortcuts) but
nothing in the app captures or surfaces the install prompt — the browser's default UI (easy to
miss/dismiss) is the only path today. Given the app's substantial PWA infra already (service
worker, FCM, shortcuts), a home-screen install materially improves retention and is currently pure
upside left on the table.

**Implementation notes:** New hook `hooks/usePwaInstallPrompt.ts`: attach a
`window.addEventListener('beforeinstallprompt', ...)` calling `e.preventDefault()` and storing the
event in a ref/state; expose `promptInstall()` (calls `.prompt()` then awaits `.userChoice`) and
`canInstall: boolean`. New `components/ui/InstallPwaBanner.tsx` (dismissible, localStorage-
remembered like `WeeklyRecapCard`'s per-week dismiss pattern) rendered from `MainLayout` or
Dashboard only when `canInstall` is true and an engagement gate is met (session-count ≥ 3, or
after `first_habit_completed` from `utils/firstTimeFlags.ts`). Fire
`track('pwa_install_prompted'|'pwa_install_accepted'|'pwa_install_dismissed')`. Also listen for
`appinstalled` to fire `track('pwa_installed')` and permanently hide the banner. No-ops
gracefully on iOS Safari (no `beforeinstallprompt` support).

**Key files:**
- `public/manifest.json`, `hooks/usePwaInstallPrompt.ts` (new), `components/ui/InstallPwaBanner.tsx` (new)
- `components/layout/MainLayout.tsx`, `services/analytics.ts`, `utils/firstTimeFlags.ts`

### F-PLAT-02 — Freemium usage-limit nudge banners

**Size:** large · **Value:** high · **Dependencies:** none

A cohesive set of contextual, non-blocking upgrade nudges firing exactly at the entitlement
boundaries the app already computes but never surfaces to end users: an inline banner when the AI
daily cap is nearly/fully used, an explanatory message (instead of a silent failure) when a
household tries to add a member past `maxMembers`, and similarly for the Kid Mode profile cap.
Each nudge opens the existing `PaywallModal`.

**Why:** `utils/entitlements.ts`'s `getLimits()`/`kidProfileLimitReached()` and geminiService's
AI-quota transaction are all enforcement-ready, and `PaywallModal.tsx` already exists as the
upgrade surface — but there is no in-context "you've hit your limit, here's why, upgrade to unlock
more" messaging at the actual point of friction. Highest-leverage conversion surface for the
freemium model once `billingEnabled` flips.

**Implementation notes:** Three coordinated call sites, each gated on `billingEnabled`
(`useBillingEnabled`) so they stay silent while billing is dormant: (1) AI cap — grep call sites of
`checkAndIncrementAiUsage`'s thrown quota error (receipt scan / meal suggestion / insight refresh
flows), catch the quota error and open `PaywallModal` instead of a generic toast, naming the actual
`FREE_LIMITS.aiDailyCap`. (2) Member cap — in the "Add Member" flow (`pages/Settings.tsx`
`handleAddMember`), before opening `MemberModal` check `members.length >=
getLimits(householdSettings).maxMembers` and open `PaywallModal` instead. (3) Kid profile cap —
`kidProfileLimitReached()` already exists (`utils/entitlements.ts`) as a pure predicate; grep its
current call site in the kid-profile-add mutation and confirm/add a UI-level check before the
mutation runs. Each nudge fires `track('upgrade_nudge_shown', {surface: 'ai'|'members'|'kids'})`.

**Key files:**
- `utils/entitlements.ts`, `services/geminiService.ts`, `pages/Settings.tsx`
- `components/modals/PaywallModal.tsx`, `services/analytics.ts`

### F-PLAT-03 — Post-onboarding setup checklist widget

**Size:** medium · **Value:** high · **Dependencies:** none

A dismissible checklist card on the Dashboard (and/or Settings) for the first couple weeks after
onboarding, nudging a few high-value setup actions the 5-step wizard doesn't cover: connect a bank
(if `plaidEnabled`), enable push notifications, add a budget bucket, invite a second member. Each
item deep-links to the right place and checks itself off automatically from existing state.

**Why:** `OnboardingWizard.tsx` seeds only a checking balance + up to 3 habits + surfaces the
invite code — deliberately doesn't touch buckets, notifications, or Plaid (out of scope for an
"about a minute" wizard). Households that skip steps or finish quickly are left to discover the
rest on their own; a lightweight, self-clearing checklist improves activation depth using only
data the app already tracks.

**Implementation notes:** New `components/dashboard/SetupChecklistCard.tsx` (lazy-loaded like
other dashboard widgets), items computed as pure booleans from existing context state — no new
Firestore fields: `hasBucket = budgetBuckets.length > 0`, `notificationsEnabled` from the existing
permission check pattern already in `pages/Settings.tsx`, `hasSecondMember = members.length > 1`,
`plaidConnected` from the account's Plaid-linked flag (only shown when `usePlaidEnabled()` is
true). Dismiss-per-household via localStorage keyed on `householdId` (same idiom as
`WeeklyRecapCard`'s per-week dismiss) plus an auto-hide once every item is checked or ~14 days
since `onboardingComplete`. Each row deep-links via `navigate()`. Track
`setup_checklist_item_completed` with the item id.

**Key files:**
- `components/dashboard/SetupChecklistCard.tsx` (new), `components/onboarding/OnboardingWizard.tsx`
- `hooks/usePlaidEnabled.ts`, `pages/Settings.tsx`, `services/analytics.ts`

### F-PLAT-04 — Public "request early access" waitlist capture (in-app, code-only)

**Size:** medium · **Value:** medium · **Dependencies:** ships its own `[rules]`-tagged PR

A simple public form (reachable from Login when signup is closed) where an interested visitor
leaves their email to be notified when LifeBalance opens up, writing to a new
`waitlist_requests` Firestore collection. `DeveloperConsole` gets a "Waitlist" tab to review
requests and one-click promote an email into the existing `beta_testers` allowlist.

**Why:** Today, when `openSignup` is false (current Private Alpha state), an interested but
non-allowlisted user hits a dead end at Login. `TODO.md` §3's "Marketing/landing page + waitlist
capture (DIR-08)" needs a hosting/domain decision — this lightweight in-app capture form needs
neither, and gives the team a growth-interest signal well before open signup, feeding directly
into the existing `beta_testers` review flow.

**Implementation notes:** New collection `waitlist_requests/{id}` with `{email, requestedAt,
note?}`. New `firestore.rules` match block (own `[rules]`-tagged PR):
`allow create: if request.resource.data.keys().hasOnly(['email','requestedAt','note']) &&
request.resource.data.email is string && request.resource.data.email.size() < 200; allow read,
delete: if isSuperAdmin();` — no update, no auth required for create (mirrors the field-
allowlisting pattern already used elsewhere). On `pages/Login.tsx`, when the sign-in flow surfaces
a "not on the allowlist" error (`contexts/AuthContext.tsx`'s `beta_testers` check), show an inline
form instead of a dead-end toast, writing via a small `services/waitlistService.ts`. In
`DeveloperConsole.tsx`, add a 5th `TABS` entry (`waitlist`) alongside testers/ai_meter/
reports/flags, with a `loadData()` branch querying `waitlist_requests` ordered by `requestedAt
desc`, and a "Promote to beta" button per row reusing the existing `handleAddTester`-style
`addDoc(collection(db,'beta_testers'), {...})` logic, then deleting the waitlist doc.

**Key files:**
- `pages/Login.tsx`, `contexts/AuthContext.tsx`, `components/modals/DeveloperConsole.tsx`
- `services/appConfig.ts`, `firestore.rules`

### F-PLAT-05 — Stripe customer billing portal (self-serve subscription management)

**Size:** medium · **Value:** medium · **Dependencies:** one-time manual Stripe Dashboard step (configure Customer Portal allowed actions/products); shares the human-activation gate from `TODO.md` §1.3

A "Manage billing" row in Settings → Account (visible only to premium households once billing is
live) opening the Stripe-hosted Customer Portal, so the household admin can update their card,
view invoices, or cancel — without an operator doing it manually.

**Why:** `functions/src/stripe/` only has `checkout.ts` (start a subscription) and `webhook.ts`
(receive events) — no portal/cancel path exists today, so once `billingEnabled` flips on, a
subscriber has no self-serve way to manage or cancel, both a support burden and a legal/UX gap.

**Implementation notes:** New `functions/src/stripe/portal.ts`, an `onCall` (same secrets/auth/
admin-role-check pattern as `checkout.ts`) named `createbillingportalsession` that reads
`household.subscription.stripeCustomerId`, calls
`stripe.billingPortal.sessions.create({customer, return_url})`, returns `{url}`. Deliberately do
NOT export it from `functions/src/index.ts` yet — mirrors the existing dormancy pattern for
`createcheckoutsession`/`stripewebhook`, so it activates only as part of the same `TODO.md` §1.3
human activation step. Client-side: addition to `pages/Settings.tsx`'s Account section, gated on
`billingEnabled && isPremium(householdSettings)`, calling the callable via `getFunctionsInstance()`
+ `httpsCallable` exactly like `PaywallModal.tsx`'s `handleUpgrade` does for
`createcheckoutsession`.

**Key files:**
- `functions/src/stripe/portal.ts` (new), `functions/src/stripe/checkout.ts`, `functions/src/index.ts`
- `pages/Settings.tsx`, `utils/entitlements.ts`, `docs/STRIPE_SETUP_RUNBOOK.md`

### F-PLAT-06 — Trial period on Stripe checkout

**Size:** small · **Value:** medium · **Dependencies:** none (data model already supports `trialing`)

Offer a 14-day free trial on the premium subscription via `subscription_data.trial_period_days` on
the Stripe Checkout session, updating `PaywallModal`'s copy/CTA to "Start your 14-day free trial."

**Why:** `checkout.ts`'s `stripe.checkout.sessions.create` call has no trial configuration today,
and `Household['subscription']['status']` already models `'trialing'` and is already treated as
premium-granting in `entitlements.ts`'s `PREMIUM_STATUSES` — the data model supports trials
end-to-end, just nothing initiates one. A trial materially lowers activation-energy for the first
paid conversion.

**Implementation notes:** In `functions/src/stripe/checkout.ts`, add `subscription_data:
{trial_period_days: 14}` to the `stripe.checkout.sessions.create({...})` call. No webhook change
needed — `webhook.ts` already handles `checkout.session.completed`/subscription events
generically and `subscriptionEvent.ts` already parses `status` off the Stripe subscription object,
so `trialing` flows through unchanged. Update `PaywallModal.tsx`'s `BENEFITS` array/CTA copy. Make
the trial length a named constant (`TRIAL_PERIOD_DAYS = 14`) shared between the function and any
Settings copy referencing it.

**Key files:**
- `functions/src/stripe/checkout.ts`, `functions/src/stripe/webhook.ts`, `functions/src/stripe/subscriptionEvent.ts`
- `components/modals/PaywallModal.tsx`

### F-PLAT-07 — Module visibility presets

**Size:** small · **Value:** medium · **Dependencies:** none

Add 2-3 one-tap preset buttons above the per-module toggle list in Settings → App Modules (e.g.
"Finance only," "Everything," "Habits + Money") that set several `ModuleKey` toggles at once,
instead of requiring 6 individual taps to reconfigure a household's shape.

**Why:** `Household.moduleVisibility` and `utils/moduleVisibility.ts` already support arbitrary
per-module on/off (Plan 090, shipped), but `pages/Settings.tsx`'s "App Modules" section only
exposes one-at-a-time toggles via `handleModuleToggle`. A finance-only or habits-only household
today has to manually flip 3-4 switches.

**Implementation notes:** In `pages/Settings.tsx`'s "App Modules" `Section`, add a small preset
row above the existing toggle list using `SegmentedControl` or a row of subtle Buttons. Each
preset is a static `Partial<Record<ModuleKey,boolean>>` object; on click, either loop the existing
`handleModuleToggle`, or add a batched `updateModuleVisibility(patch)` mutation to the core
slice's household mutations doing one `updateDoc` with dotted-path merges, then wire the preset
buttons to it. Reuse `utils/moduleVisibility.ts`'s `ModuleKey` type; no schema change (already
`Partial<Record<ModuleKey, boolean>>`).

**Key files:**
- `pages/Settings.tsx`, `utils/moduleVisibility.ts`, `types/schema.ts`

### F-PLAT-08 — Regenerate invite code

**Size:** small · **Value:** medium · **Dependencies:** none

Add an admin-only "Regenerate code" action next to the invite code in Settings/
`HouseholdInviteCard` that rotates the household's 6-character invite code, invalidating any
previously shared code or link.

**Why:** `HouseholdInviteCard.tsx` only offers copy/share of the existing code today — no way to
revoke a leaked code short of deleting the household. Small, self-contained security/hygiene
feature reusing existing invite-code generation logic.

**Implementation notes:** Find/reuse the invite-code generator used by
`services/householdService.ts`'s `createHousehold` (grep the `inviteCode` generation helper) and
add `regenerateInviteCode(householdId)` writing a freshly generated code (same uniqueness check as
`createHousehold`). Add a mutation entry point via `useHouseholdCore` (mirror other single-field
household updates, e.g. `updateHouseholdSettings`). Wire a confirm-guarded button (`ConfirmDialog`
primitive) in `HouseholdInviteCard.tsx`, admin-role-gated (mirror the `currentUser?.role ===
'admin'` check already used around member actions in `pages/Settings.tsx`). If invite codes also
live in a lookup collection, ship any `firestore.rules` change as its own `[rules]`-tagged PR (the
current `invites/{code}` rule currently disallows update/delete).

**Key files:**
- `components/auth/HouseholdInviteCard.tsx`, `services/householdService.ts`
- `pages/Settings.tsx`, `firestore.rules`

### F-PLAT-09 — Feature-flag household allowlist targeting

**Size:** medium · **Value:** medium · **Dependencies:** none

Extend the operator feature-flag system so a flag like `kidModeEnabled` or `plaidEnabled` can be
turned on for a specific list of household IDs before flipping it globally, instead of the
current all-or-nothing boolean.

**Why:** `services/appConfig.ts`'s six flags are strictly global booleans with a 60s TTL cache —
no staged-rollout mechanism, so "reveal Kid Mode" (`TODO.md` §1.4) is necessarily instant-on for
every household simultaneously, with no way to soft-launch to a handful of real families first.

**Implementation notes:** Add an optional per-flag allowlist field to `app_config/global`, e.g.
`kidModeEnabledHouseholds: string[]`. In `appConfig.ts`, change each getter (e.g.
`getKidModeEnabled`) to accept an optional `householdId` param and resolve `true` if either the
global boolean is true OR `householdId` is in the flag's `<flagKey>Households` array (fall back
to global-only when no id is passed, so DEV/kill-switch call sites are unaffected). Update call
sites with a `householdId` in scope (`useKidModeEnabled.ts`, `usePlaidEnabled.ts`) to pass it
through from `useHouseholdCore()`. In `DeveloperConsole.tsx`'s Feature Flags tab, add a "Target
specific household" expandable input next to each flag's toggle (reuse the `setAppFlag` merge
pattern, or add sibling `addFlagTargetHousehold`/`removeFlagTargetHousehold` functions). Keep
fail-open/fail-closed defaults unchanged — this only adds an OR-clause.

**Key files:**
- `services/appConfig.ts`, `hooks/useKidModeEnabled.ts`, `hooks/usePlaidEnabled.ts`, `components/modals/DeveloperConsole.tsx`

### F-PLAT-10 — GA4 user properties for segmentation

**Size:** small · **Value:** medium · **Dependencies:** none

Set Firebase Analytics user properties (plan tier, member count bucket, which modules are
enabled, kid-mode active) once per session so GA4 reports/audiences can be segmented by household
shape, not just raw events.

**Why:** `services/analytics.ts` only exposes `track(event, params)` — no `setUserProperties`
call anywhere, so every GA4 report is stuck aggregating across all households with no way to slice
"free vs premium" or "habits-only vs full-suite" cohorts, which matters once billing/module
toggles are used for growth decisions.

**Implementation notes:** Add `setUserProperties(props: Record<string,string>)` to
`analytics.ts` mirroring `track()`'s defensive/queued pattern (import `setUserProperties`
alongside `logEvent` in the dynamic `import('firebase/analytics')`). Call once from a
low-frequency spot such as `FirebaseHouseholdContext.tsx` after the household doc first loads (gate
with a ref, not on every render), passing `plan: getPlan(household)`, `moduleCount: <n enabled>`,
`kidModeActive: <bool>` from `household.moduleVisibility`/`household.subscription`. Keep property
values short strings per GA4's 25-char value limit.

**Key files:**
- `services/analytics.ts`, `contexts/FirebaseHouseholdContext.tsx`, `utils/entitlements.ts`

### F-PLAT-11 — Onboarding funnel analytics

**Size:** small · **Value:** medium · **Dependencies:** none

Instrument each `OnboardingWizard` step transition and key choice (balance entered vs skipped,
count of starter habits picked, invite step reached, wizard finished vs skipped early) as
discrete GA4 events, instead of the single `onboarding_completed` event fired today.

**Why:** `components/onboarding/OnboardingWizard.tsx` currently only calls
`track('onboarding_completed', {step})` once at the end — no visibility into per-step drop-off,
the highest-leverage funnel for a household-management app's activation.

**Implementation notes:** In `OnboardingWizard.tsx`, add `track()` calls inside `goToStep` for a
generic `onboarding_step_viewed` event with `{step}`, plus targeted events:
`onboarding_balance_entered` (in `submitBalance`, param whether `parsed > 0`),
`onboarding_habits_selected` (in `submitHabits`, param `count: chosen.length`), and keep the
existing `onboarding_completed`. Add the new events to `docs/PRODUCT_ROADMAP.md` Part 7's
dictionary. No schema changes; `track()` is already a safe no-op outside production.

**Key files:**
- `components/onboarding/OnboardingWizard.tsx`, `services/analytics.ts`, `docs/PRODUCT_ROADMAP.md`

### F-PLAT-12 — Plan badge + limits summary in Settings

**Size:** tweak · **Value:** low · **Dependencies:** none

When billing is live, show a small "Free plan"/"Premium plan" badge in Settings → Account with a
one-line summary of the household's current limits (members, AI/day, history) pulled from
`utils/entitlements.ts`.

**Why:** `entitlements.ts` already computes `getPlan()`/`getLimits()` but nothing in end-user UI
surfaces them today — only `DeveloperConsole`'s AI meter (admin-only) shows plan-ish data. Cheap,
reuses existing pure functions, zero risk (read-only display).

**Implementation notes:** In `pages/Settings.tsx`'s Account section, gate on `const
billingEnabled = useBillingEnabled();` so it stays invisible while billing is dormant, matching
`PaywallModal`/`ConnectBankCard`'s pattern. Import `getPlan`/`getLimits` from
`utils/entitlements`, pass `householdSettings` (from `useHouseholdCore`). Render a Row
(`components/ui/Section`) with a `CountBadge`-style pill ("Free"/"Premium") and small subtext e.g.
"2 of 2 members · 3 AI actions/day." No new Firestore reads — `householdSettings.subscription` is
already in the core slice.

**Key files:**
- `pages/Settings.tsx`, `utils/entitlements.ts`, `hooks/useBillingEnabled.ts`

### F-PLAT-13 — "What's New" changelog drawer

**Size:** small · **Value:** low · **Dependencies:** none

A "What's New" entry in Settings (with a one-time badge/dot on first load after a version bump)
that opens a drawer listing recent release highlights, keyed off the existing `APP_VERSION`
constant.

**Why:** `pages/Settings.tsx` already hardcodes `const APP_VERSION = '0.8.0-alpha'` purely for
display — no changelog surface at all, so users have no visibility into what changed between the
frequent PR-per-feature ships this repo does.

**Implementation notes:** New static `data/changelog.ts` exporting an ordered array of `{version,
date, highlights: string[]}`, hand-maintained per release alongside `APP_VERSION` bumps. New
`components/settings/ChangelogDrawer.tsx` (`Drawer` primitive) rendered near the existing
`APP_VERSION` display, opened via a `DisclosureRow`. First-run badge: on mount, compare
`localStorage.getItem('lifebalance-last-seen-version')` to `APP_VERSION`; if different, show a
small dot on the Settings entry point and update localStorage once opened. No backend/Firestore
involvement.

**Key files:**
- `pages/Settings.tsx`, `data/changelog.ts` (new), `components/settings/ChangelogDrawer.tsx` (new)

## Cross-Cutting

These came from the critic pass — ideas none of the seven domain-scoped agents could see because
each only saw their own slice.

### F-XCUT-01 — Household activity log / audit trail

**Size:** medium · **Value:** high · **Dependencies:** none; should exclude AI/quota-sensitive events to avoid clutter

A chronological, filterable feed of who-did-what-when across every domain — "Paul paid Electric
Bill ($142)," "Kid completed Reading habit," "Mia deleted 3 shopping items," "Admin changed
Groceries bucket limit." Surfaced in Settings → Household (or a Dashboard card) so admins can see
activity from other members, especially managed kid profiles.

**Why:** Every domain team proposed within-domain history (habit CSV export, redemption history,
points-breakdown edits) but nobody proposed the cross-cutting equivalent. The app already has
multiple household members plus Kid Mode's managed profiles (parent oversight is the whole point),
and no single place shows cross-domain activity today.

**Implementation notes:** Add a bounded `ActivityLogEntry {id, actorUid, actorName, domain,
action, summary, timestamp}` to `types/schema.ts` and a converter in
`utils/firestoreConverters.ts`. Append-only writes should ride inside the SAME `writeBatch` each
mutation family already uses (per CLAUDE.md's atomicity section: `hooks/useHabitActions.tsx`
`toggleHabit`/`resetHabit`, `transactionMutations.ts`, `calendarMutations.ts`
`payCalendarItem`, `todoMutations.ts`, `shoppingMutations.ts`, `mealMutations.ts`) rather than a
separate write — so a log entry can never diverge from the mutation it describes. Bound the
listener like `recaps` (`RECAPS_LIMIT` pattern in `utils/listenerWindows.ts`) to avoid an
unbounded collection — `TODO.md` §2A already flags 3 unbounded listeners as the top perf risk;
don't add a 4th. Expose via a new slice or extend `useHouseholdCore()`. Gate visibility to admin
role only (mirrors the `currentUser?.role === 'admin'` gating already used for `removeMember` in
`pages/Settings.tsx`) to respect member privacy.

**Key files:**
- `types/schema.ts`, `utils/firestoreConverters.ts`, `utils/listenerWindows.ts`
- `contexts/household/mutations/*.ts`, `hooks/useHabitActions.tsx`
- `pages/Settings.tsx`, `contexts/household/types.ts`

### F-XCUT-02 — Dashboard widget customization (reorder/hide cards)

**Size:** medium · **Value:** medium · **Dependencies:** none

Let each member choose which Dashboard widgets show and in what order — PulseStrip,
`DailyHabitsWidget`, `MoneyPulseWidget`, `UpcomingBillsWidget`, `WeeklyRecapCard`, action queue,
etc. — via drag-to-reorder in Settings, persisted per-member.

**Why:** The Dashboard is the one screen that already stitches money+habits+meals+todos together,
but every domain team proposed features that assume a fixed widget set. As more widgets
accumulate (this roadmap alone adds several Dashboard & AI suite ideas), a single fixed order
stops scaling — this is the cross-cutting layout layer none of the domain teams owns.

**Implementation notes:** Add `HouseholdMember.dashboardLayout?: string[]` (widget-id order) and
`dashboardHidden?: string[]` to `types/schema.ts`, persisted via the existing `updateMember`
mutation. `Dashboard.tsx` renders its widget list from this order (default = current hardcoded
order) with a fallback for members who haven't customized. Reuse the drag primitive already in the
codebase for `Reorder.Group` (see `components/meals/ShoppingListTab.tsx`'s documented
drag-gesture pattern, `TODO.md` §2E) rather than adding a new drag library.

**Key files:**
- `pages/Dashboard.tsx`, `types/schema.ts`
- `contexts/household/mutations/memberMutations.ts`, `components/meals/ShoppingListTab.tsx` (drag pattern to mirror)

### F-XCUT-03 — Unified trash / recently-deleted recovery

**Size:** medium · **Value:** medium · **Dependencies:** Firestore rules PR (separate, human-watched)

A "Recently Deleted" view in Settings listing transactions, habits, todos, shopping items, meals,
and calendar items deleted in the last 30 days, with a one-tap Restore. Distinct from the
per-item undo toast (session-only, single-item, PR #898) and from the per-domain "archive instead
of hard-delete" ideas (F-MONEY-08, F-HABITS-05) — those hide an item from active views but don't
cover accidental *permanent* deletion recovery.

**Why:** CLAUDE.md documents `deleteTransaction`/`deleteHabitSubmission`/etc. as atomic hard
deletes. The only safety net today is a few-second toast (shopping) or nothing at all
(transactions, habits, todos, meals) — table-stakes in every consumer app with a delete button
(Gmail, Drive, Notion), currently absent as a cross-cutting capability even though 5+ domains each
hard-delete records.

**Implementation notes:** Add a shared soft-delete convention: instead of `deleteDoc`, mutations
set `deletedAt: serverTimestamp()` (or move to a `deleted/{id}` mirror doc within the existing
`writeBatch`) and a scheduled Cloud Function purges anything older than 30 days (pattern similar
to the existing scheduled jobs in `functions/src/index.ts`). Reads (`financeListeners.ts`,
gamification listeners, `todoMutations`, `shoppingMutations`, `mealListeners.ts`) filter
`where('deletedAt', '==', null)`. Restore just clears `deletedAt`. Needs a `firestore.rules`
change (own human-watched PR) since queries change shape.

**Key files:**
- `contexts/household/listeners/financeListeners.ts`, `contexts/household/mutations/transactionMutations.ts`
- `contexts/household/mutations/shoppingMutations.ts`, `hooks/useHabitActions.tsx`
- `functions/src/index.ts`, `firestore.rules`

### F-XCUT-04 — Full household data export/backup (JSON)

**Size:** small · **Value:** medium · **Dependencies:** none

A single "Export all my data" button in Settings → Data downloading one JSON file containing
every domain's records (accounts, transactions, buckets, calendar items, habits + submissions,
meals, shopping, todos, members). Distinct from the per-domain CSV exports (F-MONEY-10,
F-HABITS-04) — this is a single portable backup/GDPR-style export, not a spreadsheet view of one
domain.

**Why:** Settings → Data already has an import path (`components/settings/CsvImportDrawer.tsx`,
transactions-only) with no full-fidelity export counterpart. Data portability/backup is table
stakes for an app that is the sole system of record for a household's finances and habit history,
and becomes a real gap once `deleteHousehold` (`TODO.md` §1.7) goes live — a user should be able
to grab their data before an admin nukes the household.

**Implementation notes:** New button beside `CsvImportDrawer` in Settings' Data section; reuse
the already-loaded slice hooks (`useFinance`/`useGamification`/`useMealPlan`/`useShopping`/
`useTodos`/`useHouseholdCore`) to assemble one JSON blob client-side (data already subscribed in
memory, no new reads needed) and trigger a Blob download, same pattern as F-MONEY-10's CSV export.
No server function needed for the common case; for households with data outside bounded listener
windows (meals >50, calendarItems, groceryCatalog >200 per CLAUDE.md's bounded-listener section)
call the existing `loadAllMeals()`/`loadFullGroceryCatalog()` loaders first so the export isn't
silently truncated.

**Key files:**
- `pages/Settings.tsx`, `components/settings/CsvImportDrawer.tsx`, `contexts/FirebaseHouseholdContext.tsx`

### F-XCUT-05 — Self-serve "Leave household" for non-admin members

**Size:** small · **Value:** medium · **Dependencies:** none

Let a non-admin member remove themselves from the household from their own Settings/profile —
today `removeMember()` exists but the UI only exposes it to admins.

**Why:** Table-stakes account-management capability once open signup / multi-member households are
real (`TODO.md` §1.2) — a member joined via invite code should be able to leave without depending
on the admin. Distinct from admin-triggered `deleteHousehold` (`TODO.md` §1.7, nukes the whole
household) and from `removeMember` used to kick someone else out.

**Implementation notes:** Add a "Leave household" action in `ProfileMenu.tsx` or `Settings.tsx`,
visible to the signed-in member for their OWN row only, calling the existing
`removeMember(currentUser.uid)`. Guard against the last admin leaving (block or force an
admin-transfer step first — `HouseholdMember.role` is `'admin'|'member'`). After leaving, redirect
like `deleteHousehold` does today (`window.location.reload()` → `AuthContext` resolves
no-household → routes to `/setup`).

**Key files:**
- `components/layout/ProfileMenu.tsx`, `pages/Settings.tsx`
- `contexts/household/mutations/memberMutations.ts`, `types/schema.ts`

### F-XCUT-06 — Accessibility settings: text size and high-contrast mode

**Size:** small · **Value:** medium · **Dependencies:** none

A Settings panel control for base font scale (100%/115%/130%) and a high-contrast theme variant,
on top of the existing light/dark `ThemeToggle`.

**Why:** Confirmed absent — no `fontSize`/`textSize`/`highContrast`/accessibility hits anywhere in
`pages/Settings.tsx`. This is a household app explicitly spanning multiple generations (Kid Mode
for managed child profiles alongside adult admins) — varied vision needs across members is the
norm in this product category, and none of the domain teams' ideas touch it at all.

**Implementation notes:** Extend `ThemeContext` (paired with `components/settings/
ThemeToggle.tsx`) with a `fontScale` and `highContrast` preference, applied as a root
`data-font-scale`/`data-contrast` attribute the way `data-theme` is already stamped for dark/light.
The token layer already centralizes colors in `index.css`'s `@theme` block — a high-contrast
variant is a second set of CSS custom-property overrides scoped under `[data-contrast="high"]`, no
per-component changes needed if components already consume tokens (DESIGN.md is the source of
truth to audit against).

**Key files:**
- `contexts/ThemeContext.tsx`, `components/settings/ThemeToggle.tsx`
- `index.css`, `pages/Settings.tsx`, `DESIGN.md`

---

## Suggested first picks

High-value, low-effort starters spanning the domains — good candidates for a first PR from this
roadmap:

- **F-MONEY-02** (Daily spend pace indicator) — small/high, pure derived display over already-memoized data, zero risk to the Safe-to-Spend formula.
- **F-HABITS-08** ("At risk today" filter chip) — tweak/medium, pure client sort logic over data already in memory, ships in an afternoon.
- **F-NOTIF-01** (Quiet hours) — small/high, closes a real notification-fatigue gap and unifies two independently-proposed specs (domain + critic) into one.
- **F-DASH-03** (Habit Coach card) — medium/high, wires up fully-built and tested backend (`analyzeHabitPatterns`) that currently has zero UI callers — pure upside.
- **F-TODO-09** (Assignee filter chips) — small/medium, the single highest-leverage to-do filter flagged by the domain explorer, self-contained to `ToDosPage.tsx`.
- **F-MEALS-05** (Leftover / "use it up" nudge) — tweak/medium, zero new writes or AI calls, reuses an already-loaded slice.
- **F-PLAT-01** (PWA install prompt capture) — medium/high, pure upside left on the table given the app's PWA infra is already substantial.
- **F-XCUT-04** (Full household data export/backup) — small/medium, straightforward client-side assembly over already-subscribed data, and becomes materially more important once `deleteHousehold` (`TODO.md` §1.7) sees real use.
