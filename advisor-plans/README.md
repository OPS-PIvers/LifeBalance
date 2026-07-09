# Advisor Plans

## Pass 2 — "Next Steps" direction audit (2026-07-09, commit `fce26e4`)

Pass 1 (below) is fully executed except Plan 09's human flips. This pass audited
*direction*: roadmap promises vs. code reality, launch/monetization readiness. The owner's
own sequencing rule (retention → monetization → growth) still governs; these plans clear
what stands between today's private alpha and safely opening the doors.

**Selection note:** run non-interactively; the top 5 findings by leverage were planned by
default. Execute in numeric order unless noted; 10 and 11 are the P1s.

| # | Plan | Priority | Effort | Risk | Depends on | Status |
|---|------|----------|--------|------|------------|--------|
| 10 | [Server-side AI quota in `geminiproxy`](./10-server-side-ai-quota.md) — the proxy checks auth only; the entire daily cap is client-side and bypassable. Hard prerequisite to billing; cost exposure at open signup | P1 | M | MED | — | TODO |
| 11 | [Client error tracking (Sentry)](./11-client-error-tracking.md) — ErrorBoundary only console.errors; the last unshipped "stop flying blind" roadmap item | P1 | S | LOW | — | TODO |
| 12 | [Data-export completeness](./12-export-completeness.md) — "Download my data" omits todos, meal plan, challenges, rewards, stores | P2 | S | LOW | — | TODO |
| 13 | [Retire `/migrate-submissions`](./13-retire-migrate-submissions.md) — one-off migration page still routed to every signed-in user; CLI twin remains | P2 | S | LOW | — | TODO |
| 14 | [Global search spike + v1](./14-global-search-spike.md) — roadmap Tier-1 "expected consumer baseline"; all entities already in memory, no data layer needed | P2 | M | LOW | — | TODO |

**Corrections to Pass 1 records:** Plan 09 §B's precondition ("premium features must
exist first — Plan 02") is now MET — `sendweeklyrecap` is shipped and exported, and the
recap function has a real server-side `subscription.status` check. Stripe activation is
now gated only on Plan 10 (server-side AI cap) plus the human runbook steps. Also, the
`plans/015` money-model decision referenced in older checklists was resolved and shipped
in the 2026-06 bug-hunt PRs (#734–#741, verified-only balance model) — treat any doc
still listing it as an open gate as stale.

## Pass 3 — Product-scope specs (2026-07-09, commit `fce26e4`)

Executor-ready plans for the audit's actionable items (see the audit doc below for the
findings behind them). Full build plans where the work is mechanical; **spike-gated**
plans (22–24) where a design decision or a `firestore.rules` change is involved — rules
changes ALWAYS ship as their own human-watched PR in this repo.

| # | Plan | Priority | Effort | Risk | Depends on | Status |
|---|------|----------|--------|------|------------|--------|
| 15 | [Dead-surface cleanup](./15-dead-surface-cleanup.md) — `weatherSensitive`, Telegram phantom, `quickAddReceipt` 501 stub, backfill un-export | P1 | S–M | LOW | — | TODO |
| 16 | [Remove sub-buckets](./16-remove-sub-buckets.md) — write-only feature spanning schema, 2 AI prompts, merge logic, forms | P2 | M | LOW-MED | best after 15 | TODO |
| 17 | [Flag-gate power tools](./17-flag-gate-power-tools.md) — `powerToolsEnabled` fail-open gate over the 5 June "pause" surfaces | P2 | S–M | LOW | — | TODO |
| 18 | [PWA manifest shortcuts](./18-pwa-manifest-shortcuts.md) — long-press quick actions, navigation-only v1 | P2 | S | LOW | — | TODO |
| 19 | [Recipe URL import](./19-recipe-url-import.md) — `fetchrecipepage` callable (SSRF-guarded) + URL field in the import modal | P2 | M | MED | — | TODO |
| 20 | [Subscription detection](./20-subscription-detection.md) — pure detector over existing transactions + panel in RecurringBillsModal | P2 | M | LOW | — | TODO |
| 21 | [CSV transaction import](./21-csv-import.md) — investigation-gated; reuses the statement-scan commit path + identity dedup; pending-review only | P2 | M | MED | — | TODO |
| 22 | [Calendar ICS feed](./22-calendar-ics-feed.md) — spike-gated; tokened read-only feed, Admin-SDK token write (no rules change) | P3 | M | MED | — | TODO |
| 23 | [Transaction comments](./23-transaction-comments-spike.md) — spike + build; rules diff DRAFTED only, ships as human-watched rules PR | P3 | M | MED | rules PR first | TODO |
| 24 | [Savings goals](./24-savings-goals-spike.md) — spike + build; StS-decoupled by design; rules PR separate | P3 | M–L | MED | rules PR first | TODO |

**Owner decisions (recorded 2026-07-09 via Q&A):** Freeze Bank → auto-applied,
max-2 stock, economy deleted (→ Plan 25). YearlyGoal → parked behind the
`powerToolsEnabled` flag, decide later with usage data (→ folded into Plan 17 as
gated surface #6; Challenges stay). Routing → `/lists` container wins; standalone
`/todos`/`/meals`/`/shopping` become tab-seeding redirects, MealsPage/ShoppingPage
wrappers deleted (→ Plan 26). ToDos views → keep all three arrangements, move-only
extraction of matrix/grid out of the 2,038-line page (→ Plan 27). Still unplanned:
the hourly-cron merge (B12 — fold into the next functions-touching PR).

| # | Plan | Priority | Effort | Risk | Depends on | Status |
|---|------|----------|--------|------|------------|--------|
| 25 | [Freeze Bank → auto-applied](./25-freeze-bank-simplification.md) — `frozenDates` streak continuity (zero points), refill-to-2, manual patch UI removed; client+functions parity | P2 | M–L | MED-HIGH | not concurrent with other habit-logic work | TODO |
| 26 | [Routing consolidation](./26-routing-consolidation.md) — `/lists` wins; redirects seed the tab preference; wrappers deleted | P2 | S–M | LOW-MED | sequence with 27, either order | TODO |
| 27 | [ToDos view extraction](./27-todos-view-extraction.md) — move-only; matrix/grid into `components/todos/`; zero behavior change | P3 | M | LOW-MED | sequence with 26 | TODO |

**Recommended execution order (all passes):** 15 → 13 → 12 → 10 → 11 → 17 (now incl.
YearlyGoal parking) → 16 → 26 → 18 → 19 → 20 → 25 → 14 → 27 → 21 → 22 → 23 → 24.

**Product-scope audit (same day, follow-up):** the owner asked two further questions —
must-use family-tool gaps, and implemented-but-misaligned scope. Full vetted record with
verdicts: [audit-2026-07-09-product-scope.md](./audit-2026-07-09-product-scope.md)
(12 gap findings G1–G12, 13 scope findings B0–B13; headline: the June `plans/audit/07`
Remove/Pause remediation was never executed and several dead surfaces grew UI since).
Items become numbered plans (15+) only on owner selection.

**Findings considered and rejected/deferred this pass** (so they aren't re-audited):
- *Referral / invite-reward system* — premature before open signup produces a funnel to
  attribute; revisit post-launch (roadmap Phase 3). Spike-worthy then, not now.
- *Achievements/badges layer* — grounded (gamification engine has all the milestone data)
  but a product call; owner should opt in before planning.
- *Monthly/annual recap payloads on the recap rail* — cheap and high-virality (esp. "year
  in review"); deferred as a product call, strong candidate for a future pass.
- *`quickAddTodo` endpoint + `quickAddReceipt` 501 stub* — real asymmetry, moderate value;
  below the cut line this pass.
- *axe/a11y CI gate* — cheap and worthwhile; below the cut line, fold into the next
  E2E-touching PR.
- *i18n* — currency groundwork exists but full localization is explicitly deferred by the
  roadmap pre-traction. Not worth doing now.
- *Multi-household switching, TWA/app-store wrap* — roadmap Tier-3; not before traction.
- *Free-tier member/history caps server-side* — real gap, but it belongs to the existing
  `plans/050`/051 Stripe work (server entitlements + rules PR); noted there rather than
  duplicated. Also note: flipping `billingEnabled` drops the free AI cap 100→3/day for
  alpha users — sequence the flip with comms.
- *Re-consent flow for policy changes* — needed before changing terms with live users,
  not before launch itself; revisit when legal copy is finalized.
- *Legal placeholders, admin-claim provisioning, CSP enforce-flip, `openSignup`* — human-led
  items already tracked in `docs/PRELAUNCH_CHECKLIST.md`; no new plan needed.

---

# Pass 1 — "Next Level" Pass (2026-07-04)

A fresh senior-advisor audit of LifeBalance at commit `b6b153d` (post-#792), independent of
the earlier `plans/` and `todo/` backlogs. Every claim below was verified against source
during this pass; each plan is self-contained (an executor needs zero session context).

## The thesis

The engineering floor is high: 1,901 unit tests, strict TS on current majors (React 19,
Vite 8, TS 6, Tailwind 4), a real design system (DESIGN.md), atomic money paths, and a
suppression count you can count on your fingers. That is no longer where the leverage is.

The leverage is that **the app doesn't yet close its own loops**. Three loops, specifically:

1. **The data loop doesn't close.** Eight transaction-ingestion paths exist (manual,
   receipt scan, statement scan, magic/voice, iOS-Shortcut quickAdd, bank-alert email,
   Apple Pay $0 stub, Plaid) but reconciliation is pairwise and path-specific. Plaid — the
   single biggest capability jump, already deployed and cron-synced — is stuck behind its
   flag *because* turning it on would double-ingest what the email/shortcut pipeline
   already captures. → Plan 03 builds the unified transaction-identity layer; Plan 04
   then activates Plaid safely (with balance sync).
2. **The value loop doesn't close.** The paywall (`components/modals/PaywallModal.tsx:30`)
   sells "proactive insights" and a weekly recap; `utils/entitlements.ts` has
   `recapEnabled`; Stripe checkout/webhook code is written and tested but unexported.
   None of the promised intelligence exists — insights are real Gemini analysis but
   strictly button-triggered. → Plan 02 ships the recap/proactive engine, which is both
   the retention loop and the substance behind the subscription.
3. **The learning loop doesn't close.** Exactly two analytics events exist
   (`sign_up`, `login` in `services/authService.ts:23`). Activation, retention, and
   feature engagement — the metrics the owner's own roadmap calls the whole ballgame —
   are unmeasurable. → Plan 01 instruments the funnel in an afternoon.
   **✅ DONE (2026-07-04):** Plan 01 is shipped and its doc removed — ~20 activation/
   engagement/retention events now fire client-side; the event dictionary lives in
   `docs/PRODUCT_ROADMAP.md` Part 7.

Everything else is supporting: cost/scale correctness before growth (06), a safety net
for the money paths before the reconciliation work (07), keeping the agent-facing docs
truthful (05), decomposing the 4,861-line context file before it hits 6k (08), and the
runbook for flipping on the finished-but-dormant features (09).

## Priority order

| # | Plan | Impact | Effort | Risk | Confidence | Depends on |
|---|------|--------|--------|------|------------|------------|
| 01 | ~~Analytics: activation & retention events~~ **✅ DONE 2026-07-04** (doc removed; event dictionary in `docs/PRODUCT_ROADMAP.md` Part 7) | HIGH — unlocks measurement for everything else | S | LOW | HIGH | — |
| 02 | ~~Weekly recap + proactive insight engine~~ **✅ DONE 2026-07-04** (doc removed; `sendweeklyrecap` scheduled function + recap card/drawer/deep link + streak-rescue proactive insights with 2/week cap; budget-anomaly trigger deferred — `sendbudgetalerts` has no bucket-spend data server-side) | HIGH — flagship differentiator, retention loop, premium substance | M | MED | HIGH | 01 (to measure it) |
| 03 | ~~Unified transaction identity & reconciliation~~ **✅ DONE 2026-07-04** (doc removed; shared `transactionIdentity` module both sides, ±1-day auto-merge / 2-3-day `possible` policy, Plaid+quickAdd wire-ins, review-UI Merge/Keep-both with balance-safe batch merge; Plaid cross-path matches cap at `possible` until Plan 04 adds account mapping) | HIGH — unblocks Plaid; kills duplicate-transaction distrust | L | MED | HIGH | 07 recommended first |
| 04 | ~~Plaid activation: balance sync, dedup, runbook~~ **✅ DONE 2026-07-05** (doc removed; `modified`/`removed` handling + advisory balance sync + account mapping shipped in #807; webhook skipped per time-box; activation = flip `plaidEnabled`, link an account, watch two sync cycles) | HIGH — automatic bank sync, the category-defining feature | M | MED | HIGH | 03 |
| 05 | ~~Docs truth pass (CLAUDE.md et al.)~~ **✅ DONE 2026-07-04** (doc removed; CLAUDE.md/README/AGENTS.md/TODO.md/LINT_SUPPRESSIONS.md verified against source, stale docs pruned, analytics layer documented) | MED — compounds across every future agent session | S | LOW | HIGH | — |
| 06 | ~~Notification fan-out cost fix~~ **✅ DONE 2026-07-05** (doc removed; `anyNotificationsEnabled` flag + backfill + collection-group index shipped in PR-1/#805-#806; the four scheduled jobs + `sendweeklyrecap` switched to the flagged `collectionGroup("members")` query with a `FALLBACK_FULL_SCAN` escape hatch in this PR) | MED — 4 hourly full-collection scans; cost/scale correctness | M | MED | HIGH | — |
| 07 | ~~E2E money-path suite~~ **✅ DONE 2026-07-04** (doc removed; 5 money-path specs in `e2e/` + Test-Mode parity fixes in `MockHouseholdContext`; recap spec deferred until Plan 02 ships) | MED — safety net under 03/04 | M | LOW | HIGH | — |
| 08 | ~~FirebaseHouseholdContext decomposition~~ **✅ DONE 2026-07-05** (doc removed; 5 move-only PRs — types+selectors, todo/meal/shopping, gamification, core/members/kid, finance/transactions/calendar — `FirebaseHouseholdContext.tsx` ~4,992 → 2,070 lines as the provider + re-export shim, listener/mutation factories under `contexts/household/{listeners,mutations}`; entangled closures deliberately left in the provider: the pending-items voice drain and the members listener) | MED — 4,861-line file, still growing; pure mechanical split | L | MED | MED | best after 03 |
| 09 | [Dormant-feature activation runbook (Kid Mode, Stripe)](./09-dormant-activation-runbook.md) | MED — ships finished work; mostly human go/no-go | S | LOW | HIGH | 02 (for Stripe) |

**Suggested execution sequence:** ~~01~~ (done) → ~~05~~ (done) → ~~07~~ (done) → ~~02~~ (done) → ~~03~~ (done) → ~~04~~ (done) → ~~06~~ (done) → ~~08~~ (done),
with 09's Kid-Mode half whenever the owner wants and its Stripe half after 02 ships.

## What this pass deliberately does NOT re-plan

- Bounding the remaining unbounded listeners (`meals`, `groceryCatalog`, `calendarItems`
  in `contexts/FirebaseHouseholdContext.tsx:1154-1176`) — still real, still unshipped, but
  `plans/040-bound-unbounded-listeners.md` remains accurate and human-watch-gated; nothing
  to add.
- The `firestore.rules` hardcoded admin UID (`firestore.rules:31`) — still live; blocked on
  the owner provisioning the `admin` custom claim (`todo/05-admin-gate-serverside.md`).
  Called out in Plan 09's checklist.
- UI/design-system work — the June refresh (#697–#778) finished this; DESIGN.md governs.

## Conventions for executors

- **pnpm only** (`pnpm install --frozen-lockfile`). Gate every PR on `pnpm lint`
  (root), `pnpm lint:all` when `functions/` is touched, `pnpm test`, `pnpm run build`.
- No lint/type suppressions (see CLAUDE.md "Zero Tolerance" policy).
- `@/` path alias for all cross-directory imports; parent-relative imports are lint errors.
- Money in integer cents via `utils/money.ts`; "today" via `getLocalDateString()`
  (`utils/dateHelpers.ts`), never `toISOString().split('T')[0]`.
- Any change touching `firestore.rules` or `firestore.indexes.json` ships in its own PR,
  behind the emulator rules tests, with a human watching the deploy (atomic deploy, no
  staging).
- Update `contexts/MockHouseholdContext.tsx` for parity whenever the real context's public
  surface changes (Test Mode must not drift).
