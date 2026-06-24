# Audit 07 — Feature bloat & product direction (remove / finish / update / pause)

> **Audited at commit:** `274721c` · **Date:** 2026-06-23 · **Method:** 5 parallel
> read-only subagents (finance · gamification · meals/shopping/todos · AI-infra/dead-code ·
> product-surface) over the whole app, then a **market-comparison** pass (YNAB, Simplifi,
> Monarch, EveryDollar · Habitica, Duolingo, Streaks, OurHome, Greenlight · Mealime, Plan to
> Eat, Paprika, AnyList · Cozi, Family Link). Source: this session.
>
> **Companion plan:** the "finish-it" verdicts that form a family chore→points→reward loop are
> carved into [`plans/080`](../080-kid-mode-family-profiles.md) (Kid Mode), which **absorbs
> Rewards, Todos→points, and Challenges**. This doc is the durable record of *everything else*.

## Why this doc exists
The original brief was "find what *could* be cut." That framing is cut-biased. Re-run through a
market lens — *does a category-leading app validate this, and is the problem that it's over-built
or that it's unfinished?* — most "cut candidates" are **under-built core, not overkill**. This doc
records the corrected verdicts so the analysis isn't lost to the chat log.

## Diagnosis
LifeBalance has a **solid, load-bearing core** (Safe-to-Spend, the budget/accounts/transactions/
calendar loop, basic habit tracking, receipt/statement AI capture) surrounded by features that
**accreted without clear ownership**. The reliable tell for dead weight is **missing CRUD**:
Rewards have no "create reward" UI, Challenges have no `addChallenge`, the AI Weekly Planner can't
save its plan back, sub-buckets are written but never read. Those aren't features users quietly
enjoy — they're **empty or one-way for any real household**, carrying full code weight.

**Pivotal lens (now resolved):** the owner confirmed **kids may be users** → the chores→points→
rewards loop is core (OurHome/Greenlight market), which is why Rewards/Todos-points/Challenges are
"finish," not "cut." See [`plans/080`](../080-kid-mode-family-profiles.md).

## Verdict legend
**[1] Remove** · **[2] Implement** (finish under-built core) · **[3] Update & implement** (rework, then finish) · **[4] Pause** (park, don't delete) · **Keep** (core, do not touch)

---

## [1] Remove — genuine dead weight (ships as one CI-green cleanup PR, low risk)
Nothing here is reachable or read by a normal user; removal is behavior-neutral.

| Item | Why it's safe to delete | Files (audit pointers) | Effort/Risk |
|---|---|---|---|
| `/shopping`, `/meals`, `/todos` orphan routes | No nav link points to them; each re-renders a component already shown as a tab inside `/lists`. `ShoppingPage` is ~12 lines wrapping `ShoppingListTab`. | `pages/ShoppingPage.tsx`, `pages/MealsPage.tsx`, routes in `App.tsx` (~L200/210/220) | S / low |
| `MigrateSubmissions` page + route | One-off migration tool, **still a live route** a user could click and corrupt Firestore; job long done. | `pages/MigrateSubmissions.tsx`, `App.tsx:22,240`, hidden launcher `pages/Habits.tsx:228` | S / low |
| `payPeriodMigration` | Exported helpers not imported outside the migration page; the migration is past. | `utils/migrations/payPeriodMigration.ts` | S / low |
| `weatherSensitive` field | Stored on every habit, **read by zero business logic** (Weather is documented future work). | `types/schema.ts:173`, `data/presetHabits.ts:259,429`, `utils/onboardingSeed.ts:65` | S / low |
| `BudgetBucket.spent` (deprecated) | Already superseded; converter drops it. | `types/schema.ts:79` | S / low |
| Sub-buckets | `subBucketId` written to Firestore but **never aggregated or displayed**. Remove unless nested categories are actually wanted (then it's a [2]). | `types/schema.ts:70-73`, `BucketFormModal`, `EditTransactionModal`, context ~`:2451` | S / low |

## [2] Implement — finish under-built core (real near-term roadmap)
| Item | Comp / rationale | Status |
|---|---|---|
| **Rewards CRUD + redemption** | OurHome/Greenlight/Habitica custom rewards — chores→reward is the family loop. No creation UI today = empty modal. | **In [`080`](../080-kid-mode-family-profiles.md)** (080d) |
| **Todos → points** | OurHome awards points for assigned chores; ties the isolated todos into gamification. | **In [`080`](../080-kid-mode-family-profiles.md)** (080c) |
| **HabitSubmission → history/stats view** | Data is **already captured** (`schema.ts:180`, `pointsEarned`/`streakDaysAtTime`/`multiplierApplied`) with no reader; Streaks/HabitKit prove people love completion history. High value, low cost — surface it, don't delete. | Backlog |
| **Meals/grocery spend → Groceries budget bucket** (net-new) | **No mainstream app links meal planning to the budget** (Cozi/YNAB don't). A genuine differentiator that justifies finance + household in one app. | Backlog (highest-value net-new) |
| **AI Recipe Parser polish** | Recipe import is *the* reason people buy Paprika. Keep & polish. | Keep/polish |

## [3] Update & implement — good idea, wrong shape
| Item | Comp / rationale | Files |
|---|---|---|
| **AI Weekly Planner → save-back** | Mealime/Plan to Eat/Eat This Much = "plan week → auto grocery list." The hard part (AI generates a structured plan) is built; it just **can't write back to the calendar/shopping list** — a stranded island. Wire the save path. | `components/meals/WeeklyPlanModal.tsx`, `MealGuide.tsx`, `types/weeklyPlan.ts`, `utils/weeklyPlanMapper.ts`, `geminiService.ts:~1846` |
| **Freeze Bank → Duolingo-simple** | The *concept* is beloved (Duolingo Streak Freeze, Finch). The **token economy** (3-token monthly budget, rollover, expiry, 4 event types) is over-built vs. Duolingo's auto-applied freeze. Keep the idea, collapse the economy. | `utils/freezeBankValidator.ts`, `utils/freezeBankMigration.ts`, context |
| **Challenges → family, drop YearlyGoal** | Habitica challenges / Fabulous journeys validate shared goals; YearlyGoal is half-bolted-on. Add a creation path, simplify. | `components/habits/ChallengeHubModal.tsx` (697 LOC), `utils/challengeCalculator.ts`, `schema.ts:203` — **reshape in [`080`](../080-kid-mode-family-profiles.md) (080e)** |
| **Bucket reallocation → friendlier UX** | YNAB's signature "roll with the punches" — core to envelope budgeting, **not** overkill. Fix is UX (feel like "cover this overspend from X", not a bank transfer). | `components/budget/BudgetBuckets.tsx`, `reallocateBucket` in context |

## [4] Pause — park, don't delete
| Item | Why park (not cut) | Files |
|---|---|---|
| Habit-AI trifecta (Coach / Smart-Reorder / Smart-Adjust) | AI habit coaching is nascent; no mainstream family app ships it, and it's 3 fragile Gemini surfaces. Park behind a flag. | `SmartHabitAdjustModal`, `SmartHabitReorderModal`, `components/habits/HabitCoach.tsx`, `geminiService.ts:~1204/1341/1659` |
| Stripe/billing | Premium tiers are normal (Cozi Gold/YNAB); fit for a 1–2-person household is the open question. Dormant + cheap to hold — decide activate-or-delete near launch. | `functions/src/stripe/**`, `utils/entitlements.ts`, `PaywallModal` |
| Streak-multiplier simplification | Works, well-tested; the dual daily/ISO-week tiers are more than Streaks/HabitKit do. Optional, low priority. | `utils/habitLogic.ts` |
| Bucket history / period snapshots | Monarch/YNAB show trends, but the snapshot ledger largely duplicates a transaction date-filter. Revisit as a simple trend later. | `components/budget/BudgetHistory.tsx` |
| Saved filter views | Real (Monarch) but power-user; low priority for a family. | `components/budget/SavedViewChips.tsx` |
| AI Grocery Optimizer (store-route sort) | AnyList does aisle order, but marginal over the manual category/store fields; don't spend more Gemini here. | `hooks/useGroceryOptimizer.ts`, `geminiService.ts:~938` |
| Pay-period reset refactor | Paycheck budgeting (EveryDollar) is the right *feature*; the snapshot-writing impl is heavy + high-risk to rebuild. Don't touch now. | context (paycheck approval), `BucketPeriodSnapshot` |

## Keep — core, do not cut
- **Safe-to-Spend** (Simplifi's whole "Spending Plan") — defining metric.
- **Transaction split** — table-stakes in YNAB/Monarch/Rocket Money (a Target run *is* multi-category); keep, don't hide.
- **Receipt + bank-statement scan** — highest-ROI AI (Rocket Money/Copilot).
- **Dashboard `generateInsight`** — it's *real* AI on real data (the "randomized" note in CLAUDE.md is **stale** — worth correcting).
- **Magic capture / NL command**, **single-meal AI suggest**, **notifications (5 jobs)**, **grocery catalog / quick-stock** (AnyList favorites) — all pulling weight.

## A deeper, separate observation (strategy, not a cut)
Meals/Shopping/Todos are **isolated islands** — no wiring to the core loop (grocery spend doesn't
touch the Groceries bucket; a completed todo awards no points). Cozi proves these *belong*
integrated. 080 fixes the Todos↔points half; the Meals↔budget half is the standout net-new [2].

## Suggested next actions
1. **Quick-cleanup PR** for the **[1] Remove** batch — orphan routes + dead fields + MigrateSubmissions. CI-green, behavior-neutral, low risk; good autonomous slice.
2. **[`080`](../080-kid-mode-family-profiles.md)** carries the kid-loop [2]/[3] items (Rewards, Todos-points, Challenges).
3. Spec the remaining high-value items into their own numbered plans when prioritized: **Meals→budget link** ([2], best net-new), **Weekly-Planner save-back** ([3]), **HabitSubmission history** ([2]), **Freeze-Bank simplification** ([3]).

> Line numbers are from the 2026-06-23 audit pass; a few are approximate (marked `~`). Re-verify against `274721c`+ before editing.
