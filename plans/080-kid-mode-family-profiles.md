# Plan 080 — Kid Mode: managed family profiles + chores → rewards

> **Status:** TODO · **Tag:** `[C]` end-to-end (no new secrets, no auth surface, and the
> foundation needs **no `firestore.rules` change** — see Principle 1) · **Risk:** MED (new
> cross-cutting concept) but **LOW on the blast-radius axis** (no rules/atomic-deploy hazard for
> 080a–080c; only 080d's optional rule touches rules) · **Effort:** L (ship as a sequence of
> dormant-then-reveal PRs) · **Planned against commit:** `16e3ed3`
>
> Source: this session's bloat audit + the product-direction pass that re-classified Rewards,
> Todos→points, and Challenges from "cut candidates" to **under-built core**. This epic **absorbs**
> those three items (they only make sense once kids exist to receive them). Decisions locked with the
> owner: **managed profiles (no kid login)**, **both reward types (parent chooses per reward)**,
> **parent approves every redemption**.

## Why / what exists today
The data model is *almost there* for a family/kid loop — this is an additive layer, not a refactor:
- **Members already have per-member points and a role.** `HouseholdMember` (`types/schema.ts:42-58`)
  carries `points: {daily, weekly, total}` and `role: Role` where `Role = 'admin' | 'member'`
  (`schema.ts:2`). Members live as an **array on the household doc** (`Household.members`,
  `schema.ts:334`), so adding a kid is a push into that array — no new collection.
- **Access control is a *separate* array.** Firestore gates every household read/write on
  `request.auth.uid in resource.data.memberUids` (`firestore.rules:63,67`), and `memberUids` is
  **not** the same as `members[]` (it's the denormalized uid allow-list, guarded by the SENTINEL
  rules at `firestore.rules:124-144`). This is the unlock: a managed kid is a `members[]` entry that
  is **never added to `memberUids`**, so it has no credential and grants no access.
- **Rewards are thin and creation-less.** `RewardItem` is just `{id, title, cost, icon, createdBy}`
  (`schema.ts:195-201`); there is **no add/delete reward UI** (audit finding) and `redeemReward`
  redeems immediately with no approval. Today a new household sees an empty rewards modal forever.
- **Todos are assignable but award nothing.** `ToDo.assignedTo` already exists (`schema.ts:417`), but
  completing a todo grants no points — the todos domain is an island, disconnected from gamification.
- **Habits have ownership but no assignment.** `Habit` has `isShared`/`ownerId` (`schema.ts:162-163`)
  but no per-member *chore assignment* field.

**Competitive frame (baked in so the build keeps the target in view).** This is the proven
**OurHome / S'moresUp** loop (assign chores → earn points → redeem from a family store), wrapped in
**Netflix/Disney+ switchable profiles** (a kids-locked profile, PIN to exit), with
**Greenlight / Google Family Link** parent-approval gating. We are deliberately *not* building
Greenlight's real-money rails (see Principle 3).

## Non-negotiable principles
1. **Managed profiles never get a credential → no rules regression.** A kid is a `members[]` entry
   with a **synthetic, non-auth `uid`** (e.g. `kid_<id>`) and `role:'kid'`, and is **never** placed in
   `memberUids`. Therefore no child can read or write Firestore; the existing access rules already
   deny them. **080a–080c require zero `firestore.rules` changes.** Do not "fix" this by giving kids a
   login or a memberUids entry — that would reopen the exact attack surface the rules close.
2. **Authorization is the parent; attribution is the kid.** When a parent "switches into" a kid, that
   is a **client-side active-member selection**. Habit/chore completions and redemptions set
   `createdBy`/points to the **kid's** synthetic uid, but the Firestore write is executed by the
   **parent's** authenticated session (a uid in `memberUids`), so `request.auth.uid` is always a real
   parent and rules pass unchanged.
3. **Allowance is a tracked IOU, never an in-app payout.** The "money" reward type credits a
   per-kid `allowanceCents` ledger ("Leo has earned $12") that a parent settles **in real life** (cash,
   or their existing Greenlight/bank). LifeBalance **must not** move real money to a minor — that
   requires money-transmitter licensing/KYC (it's why Greenlight is a chartered institution). No
   ACH/card/Stripe-to-kid. This keeps the feature in-scope and compliant.
4. **Dormant by default.** Everything ships behind `app_config/global.kidModeEnabled` (mirror
   `getBillingEnabled()` in `services/appConfig.ts`, default **false**) so the profile switcher and kid
   surfaces stay hidden until the owner flips it. No behavior change for existing households until then.
5. **Atomic money/points mutations.** Any write that moves points or allowance (redemption approval,
   chore-completion points) commits in a single `writeBatch`, matching the app's habit+points
   atomicity rule (CLAUDE.md). Approval is idempotent (a re-tapped "approve" can't double-credit).
6. **Never gate the core loop on plan.** If kid-profile count is later gated for billing (Principle
   in Plan 050 §3), gate the *number of profiles* (scale), never the chore/points/reward mechanics.

## Existing infra to reuse (don't reinvent)
- **Per-member points** (`HouseholdMember.points`) + the daily/weekly reset machinery already handle a
  kid's score — no new counter.
- **`addMember` atomic batch** (member doc + `memberUids`, per CLAUDE.md) is the template for
  `addKidProfile` — except it writes **only** the `members[]` entry and **skips `memberUids`**.
- **Notification jobs.** The hourly FCM scheduled functions (`functions/src/index.ts`) and
  `sendtestnotification` are the delivery path for "Leo wants to redeem Movie Night → approve?" push.
- **Flag pattern** (`services/appConfig.ts` `getOpenSignup`/`getBillingEnabled`) → `getKidModeEnabled`.
- **Entitlements** (`utils/entitlements.ts`) for the optional per-plan kid cap (see 080e tie-in).
- **MockHouseholdContext** mirrors the context slices for Test Mode — extend it so the whole kid loop
  is walkable at `/#/login?test=true` with no Firebase.

---

## PR sequence

### PR 080a — Managed-profile foundation + profile switcher (dormant; no rules change)
1. **Schema** (`types/schema.ts`): extend `Role` to `'admin' | 'member' | 'kid'`. Add to
   `HouseholdMember` (all optional, legacy-safe): `isManaged?: boolean` (true = login-less kid),
   `managedByUid?: string` (parent who created them), `avatarColor?: string`, `avatarEmoji?: string`,
   `allowanceCents?: number` (the IOU ledger, default 0). Add `kidModePinHash?: string` to `Household`
   settings (hashed PIN to *exit* kid view). Treat absent fields as today's behavior.
2. **Context**: `addKidProfile(displayName, avatar)` / `updateKidProfile` / `removeKidProfile` on the
   household-core slice — each a `writeBatch` writing **only** `members[]` (synthetic `uid: 'kid_'+id`,
   `isManaged:true`, `role:'kid'`), **never** `memberUids`. Add an **active-member** context value +
   `actAs(memberId)` / `exitToParent(pin)` (client/session state only; not persisted to Firestore).
3. **Profile switcher UI** (in `ProfileMenu`/`TopToolbar`, gated by `getKidModeEnabled()`): list
   parents + kids; tapping a kid enters Kid Mode (free); returning requires the parent PIN
   (Netflix-Kids pattern). Set/clear the PIN in Settings.
4. **No rules change** (Principle 1). **Verify**: `pnpm lint`/`test`/`build`; Test-Mode walkthrough
   add-kid → switch-in → switch-out-with-PIN. Confirm an existing (flag-off) household is unchanged.

### PR 080b — Kid dashboard (the simplified, scoped view)
A dedicated kid surface shown while `actAs` is a kid: today's assigned chores/habits (large tap
targets, `habit-*` theme), their **points** balance + streak, their **allowance** balance, and a
**reward store** (request buttons). **Hidden:** all finance (Safe-to-Spend, accounts, budget,
transactions), other members' data, Settings, AI capture, the bottom-nav finance tabs. Optional
read-only family calendar/meals. This is the "only what makes sense for them" view the owner asked
for. No Firestore writes that a parent session doesn't authorize (Principle 2).

### PR 080c — Chore assignment + Todos→points (wires the islands into the loop)
1. Add `assignedTo?: string` to `Habit` (member uid / synthetic kid uid), mirroring `ToDo.assignedTo`.
   Habit create/edit gains an "assign to" picker (members incl. kids). Kid dashboard filters to
   `assignedTo === activeKidUid` (+ shared chores flagged kid-appropriate).
2. **Todos award points**: add optional `points?: number` to `ToDo` (default e.g. 5). Completing an
   assigned todo credits that member's points in the same `writeBatch` as the completion (Principle 5).
   This is the [3] "Todos→points" item — OurHome's core chore-points mechanic.
3. Tests for assignment filtering + todo-completion point credit (incl. the kid-uid attribution path).

### PR 080d — Rewards CRUD + redemption approval + allowance ledger
1. **Reward CRUD** (the missing [2] core): `addReward`/`updateReward`/`deleteReward`. Extend
   `RewardItem`: `type?: 'realWorld' | 'allowance'` (default `realWorld`), `allowanceCents?: number`
   (for `allowance`), `targetMemberId?: string` (a specific kid, or absent = all kids), `active?:boolean`.
   "Parent chooses" per reward = this `type` switch at creation (locked owner decision).
2. **Redemption requests** (parent-approval, locked owner decision): new `RewardRedemption`
   `{id, rewardId, rewardTitle, memberId, requestedByUid, cost, type, allowanceCents?, status:
   'pending'|'approved'|'denied', requestedAt, resolvedAt?, resolvedByUid?}` as a household
   **subcollection** (history/scale-friendly). A kid taps "request"; a parent approves/denies from a
   review queue (reuse the Plan 063 pending-badge pattern on the parent nav). **On approve** (one
   `writeBatch`, idempotent): deduct `cost` points from the kid; if `allowance`, credit
   `allowanceCents` to the kid's `allowanceCents`. Push notification via the existing FCM jobs.
3. **Rules (the only rules touch in this epic — own PR, Plan 010 tests, human-watched):** if
   `redemptions` is a subcollection, add a rule allowing create/update **only** by a `memberUids`
   parent (kids have no credential anyway, but make the parent-only write explicit and tested). If
   redemptions are instead modeled on the household doc array, **no rules change** (the existing
   member-update rule covers it) — prefer that to keep the epic rules-free if the audit shows array
   size is bounded. Decide in the PR; default to the array unless history depth needs a subcollection.
4. Tests: reward CRUD; request→approve point deduction; allowance credit; idempotent re-approve;
   deny path leaves points untouched.

### PR 080e — Family challenges (simplify the existing Challenge) + optional billing tie-in
1. Reshape `Challenge` (`schema.ts:203`) into a **shared family challenge** with a creation path
   (today there is no `addChallenge`): "everyone logs habit X this month." **Drop the half-built
   `YearlyGoal` coupling** (audit finding). Per-kid contribution shows on the kid dashboard.
2. **Optional monetization hook** (only if/when billing activates — Plan 050): add `maxKidProfiles`
   to `FREE_LIMITS`/`PREMIUM_LIMITS` in `utils/entitlements.ts` (e.g. free 2, premium unlimited),
   enforced in `addKidProfile`. This is a Principle-6-compliant *scale* gate, giving billing a
   mission-appropriate premium lever without ever touching the core loop. Ship **dormant** with the
   rest; no gate fires while `billingEnabled` is false.

---

## Human checklist (the irreducible `[H]` steps — minimal here)
1. **Product walkthroughs** (Test Mode): after 080a (switcher), 080b (kid view), 080d (reward
   approval) — confirm the kid view hides everything it should and the PIN exit works, before each flip.
2. **Flip `app_config/global.kidModeEnabled = true`** (Firestore console) when ready to reveal it.
3. **(Only if billing is on)** decide the free-tier `maxKidProfiles` value (080e).
No new secrets, no new accounts, no Stripe, no auth-provider changes.

## Out of scope / STOP conditions
- **No real-money disbursement to children** (no payouts/ACH/card/Stripe-to-kid). Allowance is a
  tracked IOU only (Principle 3). Revisit only with a licensed banking partner — out of this epic.
- **No kid login / no child auth** in this epic. Managed profiles only (locked decision). A future
  "teen gets their own login" is a separate plan and would reopen rules/COPPA scope.
- **Never add a kid's synthetic uid to `memberUids`** (Principle 1) and never write the kid's points
  from an unauthenticated path.
- Do **not** auto-merge 080d's rules change (if the subcollection route is chosen) without Plan 010
  tests + a human watching the atomic deploy (PRD §2).

## Test plan
- `entitlements`/limit-table test for `maxKidProfiles` (absent plan → free cap) — 080e.
- Context: `addKidProfile` writes `members[]` but **not** `memberUids` (assert the access array is
  untouched); `actAs`/`exitToParent` PIN gate.
- Chore assignment filtering; todo-completion point credit with kid-uid attribution (080c).
- Reward CRUD; redemption request→approve (point deduction + allowance credit, atomic, idempotent);
  deny path (080d).
- Rules test (only if subcollection chosen): non-parent / kid principal cannot write a redemption;
  parent can (extend `tests/rules/firestore.rules.test.ts`, Plan 010 harness).
- Test-Mode E2E happy path (Plan 030 skeleton): add kid → assign chore → kid completes → requests
  reward → parent approves → points/allowance update.

## Maintenance notes
- **Synthetic-uid invariant**: managed members must always have `isManaged:true` and never appear in
  `memberUids`. Any new member-write path must preserve this — add a guard/test when touched.
- Keep redemption approval **idempotent** (Stripe-style): Stripe isn't involved, but parents will
  double-tap. The `status` transition `pending→approved` must be a no-op if already `approved`.
- Every new kid-facing surface checks `getKidModeEnabled()` and the active-member role — never assume
  a parent context.
