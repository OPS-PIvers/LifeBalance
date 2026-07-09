# Product-Scope Audit — Must-Use Gaps & Bloat Re-Audit (2026-07-09)

> **Audited at commit:** `fce26e4` · **Method:** 2 parallel read-only auditors (must-use
> gaps · scope/bloat) over the whole app, each verified against source by the advisor
> before inclusion. **Baseline for Part 2:** `plans/audit/07-feature-bloat-and-direction.md`
> (2026-06-23) — this pass re-verifies its verdicts ~100 PRs later.
>
> Owner's two questions: (1) what's NOT built that would make this a MUST-USE family
> tool; (2) what IS built that widens/fragilizes scope beyond the core.
> Core positioning (docs/PRODUCT_ROADMAP.md): *"the app a couple/family runs together to
> stay on the same page about money and habits — and have a little fun doing it."*

## Vetting corrections (claims rejected or amended by the advisor)

- **REJECTED:** "a deployed public Stripe webhook is live attack surface" — false.
  `functions/src/index.ts:31-39` deliberately does NOT export `stripewebhook`/
  `createcheckoutsession`; nothing Stripe is deployed. No action needed.
- **AMENDED (June record):** `utils/migrations/payPeriodMigration.ts` is NOT dead code
  (June [1]-Remove list was wrong by the time of this pass): `FirebaseHouseholdContext.tsx:56`
  imports and runs it on household load. KEEP; do not delete on June's stale advice.
- **AMENDED:** exported Cloud Functions count is ~18 (not 21); 6 scheduled (4 hourly
  notification crons + weekly recap + daily Plaid sync). The thrust of the ops-surface
  finding stands.
- Note on framing: June's verdicts were *audit recommendations*, not owner decisions.
  Where this doc says "contradicts June," read "the recommendation was neither executed
  nor explicitly overruled."

---

## Part 1 — Must-use gaps (not implemented, not planned)

Ranked by (family-retention value ÷ effort), grounded in repo evidence. Top-3 bets first.

| # | Gap | Rationale | Effort | Confidence |
|---|-----|-----------|--------|------------|
| G1 | **Shared family calendar + ICS feed** | `CalendarItem` (types/schema.ts:229) models only money (`income|expense`, `isPaid`); zero ICS/Google-Calendar code repo-wide. The daily-open family habit (Cozi's moat — soccer, appointments, who's-driving) is the retention loop finance/habits alone don't create. Recurrence math (`utils/calendarRecurrence.ts`) already exists. Ship read-only ICS-out (`webcal://` feed, S–M) before any events UI (L) or Google OAuth (ops burden). | L (ICS slice S–M) | HIGH absent; MED it's the right bet |
| G2 | **Recipe import from URL** | `parseRecipe` (geminiService.ts:1904) is paste-text only ("The model can't browse", :958). URL import is *the* reason people pay Paprika/Plan-to-Eat; families cook from links. Only the server-side fetch is missing — a Cloud Function pulling JSON-LD `Recipe` → existing parser. | M | HIGH |
| G3 | **Subscription / recurring-charge detection** | Transactions already carry merchant+date+`isRecurring` (schema.ts:161-168) but nothing scans for periodicity; recurring bills exist only when hand-created. "You have 9 subscriptions totaling $147/mo" is Rocket Money's entire hook, feeding the existing insights surface + one-tap create-bill. Near-zero new data. | M | HIGH |
| G4 | **PWA manifest `shortcuts`** | `public/manifest.json` has no `shortcuts` array (verified). Long-press icon → Add expense / Shopping list / Log habit. Free re-engagement, pure config + deep-link params. | S | HIGH |
| G5 | **CSV/OFX statement import** | CaptureModal file-upload is image-OCR only (`readAsDataURL`); export exists with no import twin. Switchers from Mint/YNAB hold a CSV; the `transactionIdentity` dedup pipeline already exists to route it through. Cheapest onboarding-wall removal. | M | HIGH |
| G6 | **Comments on transactions/todos** | `Transaction.notes`/`ToDo.notes` are single-author strings; no comment/thread entity exists. "What was this $80 charge?" is the canonical couple conflict — a bounded comment thread turns silent edits into the on-the-same-page conversation the positioning promises. No budgeting competitor has shared comments. | M | HIGH absent; MED demand |
| G7 | **Savings goals / sinking funds** | Only goal primitive is `Account.monthlyGoal` (one number). No entity models "save $1,200 for Christmas by Dec"; `allowanceCents` IOU has no goal attached. Shared visible-progress goals are the emotional rally feature; reusing the entity as a kid "save for a Switch" jar makes Kid Mode compelling. Must stay clearly distinct from spend-buckets. | M–L | MED-HIGH |
| G8 | **Generalized email-in inbox** | `functions/src/quickAdd/emailParser.ts` is a hardcoded Wells-Fargo regex reachable only via a manual iOS Shortcut — Android households have NO capture automation at all. A per-household inbound address (SendGrid/Mailgun/CF Email Workers → existing parser) generalizes tested code. Vendor + spoofing-auth burden is the trade-off. | M | MED |
| G9 | **Printable "fridge" views** | Chore/meal/bill data all exists; no print stylesheet. Cozi's most-loved low-tech feature; reaches the family members who never open the app. A `/print` route + `@media print` CSS. | S | MED |
| G10 | **Receipt image persistence / document shelf** | No `firebase/storage` usage anywhere; scanned receipts are OCR'd and discarded. Attaching the image to its transaction is a natural OCR extension ("the receipt for the returned blender"). Storage cost + a new rules surface — needs quotas. | M–L | MED |
| G11 | **Kid allowance payout tracking** | `allowanceCents` is explicitly "NOT an in-app payout" (schema.ts:87). A parent-confirmed "mark paid" ledger event + savings jar (G7) closes most of the emotional loop WITHOUT the Tier-4 real-money/KYC version (Greenlight territory — separate business decision, not a build). | L (tracking) / XL (real money — don't) | MED |
| G12 | **Alexa/Google Home shopping entry** | Only iOS-Shortcut voice capture exists; `quickAddShoppingItem` endpoint is reusable. But: separate skill codebase, platform certification, account-linking ops. Investigate-only; weakest ROI here. | L | LOW-MED |

## Part 2 — Scope/bloat list (implemented but misaligned, overwhelming, or fragile)

Ordered by scope-cost. Verdicts: REMOVE / PARK-BEHIND-FLAG / SIMPLIFY / KEEP.

**Meta-finding B0 — the June audit's remediation never shipped.** Neither the "[1] Remove"
batch nor the "[4] Pause-behind-flag" batch from `plans/audit/07` was executed; several
items grew MORE surface since. Most of the list below is that debt compounding.

| # | Item | Evidence | Rationale (the cost) | Verdict |
|---|------|----------|----------------------|---------|
| B1 | **Write-only dead fields grew input UI**: `weatherSensitive`, `subBucketId` | schema.ts:173/70-73; HabitFormModal.tsx:124, HabitCreatorWizard.tsx:119,189, CaptureTransactionManual.tsx:62,87-93 | Both fields are collected/persisted and read by ZERO business logic (no hits in habitLogic/bucketSpentCalculator/safeToSpendCalculator). Users fill in controls that do nothing; code+rules+test weight with no output. | **REMOVE** (or promote sub-buckets to a real aggregated feature — not the current limbo) |
| B2 | **Telegram phantom integration** | schema.ts:68 `telegramChatId`, :288 `telegramAlias`; carried in HabitFormModal.tsx:128, HabitCreatorWizard.tsx:196, useHabitActions.tsx:115; `'telegram'` in the source union (schema.ts:169). **Zero Telegram code in functions/** (verified) | A third-party channel modeled across schema, forms, and rules with no bot, no delivery, no maintainer. Pure fragility-signal + dead weight. | **REMOVE** |
| B3 | **Gamification = ~8 competing concepts** | points, streaks, dual-cadence multipliers, freeze-token economy (freezeBankValidator.ts:83,142 — full 2+1-rollover monthly economy, never simplified), challenges (ChallengeHubModal), yearly goals, rewards+redemption | A new family meets eight motivational primitives. June's "collapse freeze economy to Duolingo-simple" and "pick Challenges OR YearlyGoal" both unexecuted. Biggest onboarding-overwhelm cluster. | **SIMPLIFY** — auto-applied freeze, one shared-goal primitive; keep points/streaks/rewards |
| B4 | **YearlyGoal grew full CRUD against June's "drop" recommendation** | components/modals/YearlyGoalFormModal.tsx (+test) now exists (verified); utils/yearlyGoal.ts | Deepened a concept the audit said to drop, while Challenges (the overlapping concept) also remains. Two shared-goal features is the scope smell — the issue isn't either one, it's both. | **Owner decision**: commit to ONE of YearlyGoal/Challenges, cut or park the other |
| B5 | **13 Gemini call surfaces** | geminiService.ts exports: load-bearing analyzeReceipt/parseBankStatement/generateInsight/NL-capture; long-tail suggestMeal, parseGroceryReceipt, optimizeGroceryList, analyzeHabitPoints, analyzeHabitPatterns, reorganizeHabits, parseRecipe, generateWeeklyPlan (+ server-side insights/recap narrative) | Every prompt surface is a place a model bump breaks silently, a cost vector, and a re-test burden for a solo owner. The habit-AI trio + grocery optimizer were June "park behind flag" — still live, unflagged. | **PARK-BEHIND-FLAG** habit-AI trio + grocery optimizer; KEEP the core four |
| B6 | **7 transaction-capture paths post-Plaid** | source union (schema.ts:169): manual, camera-scan, file-upload, telegram (dead), recurring, shortcut, plaid; 4 live quickAdd HTTP endpoints (+1 stub returning 501); three dedup/merge util families exist purely to reconcile the paths | With Plaid live, overlapping entry paths each carry dedup burden and security surface. `telegram` is dead (B2); `quickAddReceipt` is a 501 stub. | **SIMPLIFY** — drop dead source values + the 501 stub; measure shortcut usage before further trims |
| B7 | **Route duplication after modular pages** | `/lists` (3-tab container) AND standalone `/meals`, `/shopping`, `/todos`; MealsPage embeds ShoppingListTab while ShoppingPage wraps the same component; ToDosPage renders in two hosts | ShoppingListTab reachable from three URLs. Triple deep-link/scroll/state surface, confusing IA. June's "orphan routes" became duplicate entry points instead. | **SIMPLIFY** — one routing model (container OR discrete routes) |
| B8 | **ToDos: 3 arrangements + landscape 2×2 Eisenhower grid** | pages/ToDosPage.tsx:39-54 (`list|matrix|grid`, orientation prompt), 2,038 lines (verified); utils/eisenhower.ts | Productivity-power-tool complexity on a family chore list; largest page file in the repo. NOTE: this is deliberate owner work from THIS month (#839-#841) — flagged for cost-awareness, not as a unilateral cut. | **Owner decision** — cost stated; if kept, consider extracting the matrix views from the 2k-line file |
| B9 | **Shopping sub-domain = ~9 user-facing concepts** | stores, storeMatch, grocery catalog, quick-restock, smart-defaults, AI optimizer (useGroceryOptimizer), settings modal, quick-lists, formatter | AnyList-tier depth on a secondary module; the AI optimizer is one of the June park-items still live. | **SIMPLIFY** — cut AI optimizer; collapse catalog/quick-restock toward one "saved items" concept |
| B10 | **Operator console inside the family bundle** | Settings mounts DeveloperConsole (541 lines, verified — flags incl. openSignup/billing/plaid, beta testers, AI meter) + ApiKeyManager + ShortcutSetupGuide | Runtime-gated to the admin UID, but it's shipped code weight and a security-sensitive control panel co-located with family settings. | **PARK** — lazy-load behind the admin check (likely already lazy — verify) and/or split to an ops route; low urgency, real polish |
| B11 | **June "Pause" items all still live, unflagged** | HabitCoach.tsx, SmartHabitAdjust/ReorderModal, BudgetHistory.tsx, SavedViewChips.tsx, useGroceryOptimizer.ts — none carry a flag | "Recommended pause" with no flag = full maintenance cost with none of the risk containment. The flag infra (app_config/global + Developer Console) already exists. | **PARK-BEHIND-FLAG** (or explicitly promote to Keep and close the June items) |
| B12 | **6 always-on scheduled jobs + one-off backfill still deployed** | 4 hourly notification crons + weekly recap + daily Plaid sync; `backfillanynotificationsenabled` (index.ts:746) is a completed one-off still exported | Each cron is a silent-failure vector and cost line for a solo maintainer; the four hourly jobs share the same member-scan shape and could be one dispatcher. Backfill is done and admin-gated but needn't stay deployed. | **SIMPLIFY** — merge the 4 hourly crons into one scheduler; un-export the backfill |
| B13 | **Stripe/billing dormant stack** | functions/src/stripe (unexported), entitlements, PaywallModal | Settled decision (dormant by design, runbook exists) — listed only for completeness because the paywall UI is reachable when `billingEnabled` flips. NOT a change recommendation. | **KEEP (settled)** |

## Suggested next actions (pending owner selection)

1. **"June-debt cleanup" PR batch** — B1 + B2 + B6's dead source values + B12's backfill
   un-export: behavior-neutral, CI-green, S effort. The single cheapest de-bloat move.
2. **Flag-gating PR** — B5/B11: wrap the habit-AI trio, grocery optimizer, BudgetHistory,
   SavedViewChips in `app_config/global` flags (default ON to avoid behavior change; flip
   at leisure).
3. **Owner decisions — RESOLVED 2026-07-09 (via Q&A, recorded in README Pass 3):**
   B3 freeze economy → auto-applied/max-2 (Plan 25); B4 → YearlyGoal parked behind
   `powerToolsEnabled` (Plan 17 #6), Challenges stay; B7 → `/lists` wins (Plan 26);
   B8 → keep all three ToDos views, move-only extraction (Plan 27).
4. **Must-use bets:** G2 (recipe URL import) and G4 (manifest shortcuts) are the
   cheap-and-loved slices; G1 (family calendar, ICS-out first) is the strategic bet;
   G3 (subscription detection) is the best data-already-there win.

None of these are planned as numbered plans yet — selection is the owner's call; the
advisor will spec chosen items as self-contained plans (15+) on request.
