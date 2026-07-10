# Plan 051 — Server-side enforcement of freemium entitlement *limits*

- **Status:** TODO (not started)
- **Written against commit:** `8661dc0` (main)
- **Owner decision required before execution:** yes — see "Escape hatches / STOP conditions". This plan changes a security boundary and MUST NOT ship while it could lock out existing households.
- **Depends on:** Plan 050 (entitlements + `subscription` model, already landed). The `subscription` block is *already* server-truth (see `firestore.rules` ~line 73/118 and the "subscription writes (Plan 051)" test block). This plan adds the missing piece: the **count limits**.

---

## Problem / why this exists

`utils/entitlements.ts` defines per-plan limits — `maxMembers` (free 2 / premium 20), `maxKidProfiles` (free 2 / premium 10), `historyMonths` (free 13 / premium 120), `aiDailyCap`. Today:

- **`aiDailyCap` IS enforced server-side** — `functions/src/geminiProxy.ts` re-checks the cap authoritatively via `functions/src/entitlements.ts`. ✅ Nothing to do here.
- **`maxMembers`, `maxKidProfiles`, `historyMonths` are enforced client-side ONLY.** `contexts/household/mutations/kidMutations.ts:46-58` gates `addKidProfile` in the browser, and the file's own comment says it is "never a security boundary". `firestore.rules` has **no** member-count or kid-count cap. A user with devtools (or a scripted Firestore write) could exceed them.

`utils/entitlements.ts:8-10` states the contract explicitly:

```ts
 * IMPORTANT: this is read by the client for display and by free-tier logic, but a
 * paid feature must ALWAYS be gated on the server (Cloud Function / firestore.rules).
 * Never treat this client-readable value as the only gate (Plan 050 principle #1).
```

This is currently **dormant, not exploitable**: billing is off (`billingEnabled === false`), so the client caps are skipped entirely and everyone is free-tier-permissive. The risk only becomes real the moment an operator flips `billingEnabled` on. **This plan is a hard prerequisite for launching billing.**

## The grandfathering trap (read this first)

Existing free-tier households may ALREADY exceed the free caps — e.g. a family with 4 members, or 3 kid profiles, created while enforcement was dormant. A naive `memberUids.size() <= 2` rule would **block their every household update** (they can't drop below the cap without kicking out real people) and **soft-brick their app**. Every gate in this plan MUST grandfather: *never allow growth beyond the cap, but always allow an already-over-cap household to stay, shrink, or make unrelated writes.* The rule shape is "allow if the new count ≤ cap **OR** the new count ≤ the old count", not "allow if new count ≤ cap".

---

## Design decisions (per limit)

| Limit | Enforce where | Why |
|---|---|---|
| **`maxMembers`** | `firestore.rules`, on `households/{id}` update | `memberUids` is an array on the household doc, and `subscription` (→ plan) is on the same doc. Rules can read both with zero extra `get()`. Clean, authoritative. |
| **`maxKidProfiles`** | **New callable Cloud Function** `createkidprofile` (Admin SDK) | Kid profiles are `members/{id}` docs that are **NOT** in `memberUids`. Rules cannot count subcollection docs, and a denormalized client-writable `managedKidCount` field is **not a real boundary** (a malicious client under-reports it to bypass). Only server-side counting is authoritative. |
| **`historyMonths`** | **DEFERRED — out of scope** | This is a display/retention *trim*, not an abuse or money vector (older data already exists and is cheap to keep). Enforcing read-visibility in rules is expensive and low-value. Explicitly parked; note it in the index. |

Because `firestore.rules` cannot import TypeScript, the cap numbers must be **duplicated into the rules** with a `KEEP IN SYNC with utils/entitlements.ts` comment — the same pattern already used by `functions/src/entitlements.ts`.

---

## Scope

**In scope:**
- `firestore.rules` — add a member-count cap (plan-aware, grandfathered) to the `households/{householdId}` `allow update` rule.
- `tests/rules/firestore.rules.test.ts` — new cases under a "member cap (Plan 051)" describe block.
- `functions/src/kid/createKidProfile.ts` (new) — callable that authoritatively counts managed members and enforces the kid cap; creates the member doc via Admin SDK.
- `functions/src/index.ts` — export the new callable.
- `functions/src/entitlements.ts` — if not already present, add `getMaxKidProfiles(data, billingEnabled)` mirroring the client.
- `contexts/household/mutations/kidMutations.ts` — route `addKidProfile` through the new callable instead of a direct client write (keep the client-side pre-check as a fast UX guard, but the function is the boundary).
- New unit test for the function: `functions/src/kid/createKidProfile.test.ts`.

**Out of scope (do NOT touch):**
- `historyMonths` enforcement (deferred, above).
- `aiDailyCap` (already server-enforced).
- The `subscription`-is-server-truth rules (already done — don't duplicate).
- Any client display logic in `pages/Settings.tsx` / `PaywallModal` — the client caps stay as UX affordances.
- Do NOT enable `billingEnabled`. This plan makes enforcement *correct*; flipping the flag is a separate operator action.

---

## Current-state excerpts (verify these still match before editing)

`firestore.rules`, the household `allow update` (starts ~line 111) — member modification is already restricted to "add only yourself":

```
allow update: if isMemberOf(householdId) &&
                  ... &&
                  !request.resource.data.diff(resource.data).affectedKeys().hasAny(['subscription']) &&
                  isValidAiUsageUpdate() &&
                  ( /* adding: only yourself */ ) &&
                  ( /* removing: admin any, user self */ );
```

`contexts/household/mutations/kidMutations.ts:46-58` — the client-only kid cap to replace with a callable:

```ts
// Plan 080e — managed-kid-profile cap ... enforced ONLY while billing is live.
if (await getBillingEnabled()) {
  const managedKidCount = membersRef.current.filter((m) => m.isManaged === true).length;
  if (householdSettings && kidProfileLimitReached(householdSettings, managedKidCount)) {
    toast.error('Kid profile limit reached. Upgrade to add more.');
    throw new Error('Kid profile limit reached');
  }
}
```

`utils/entitlements.ts` — the numbers to mirror into rules/functions: `FREE_LIMITS.maxMembers = 2`, `PREMIUM_LIMITS.maxMembers = 20`, `FREE_LIMITS.maxKidProfiles = 2`, `PREMIUM_LIMITS.maxKidProfiles = 10`. Premium statuses: `['active','trialing','past_due']`.

`tests/rules/firestore.rules.test.ts:305` — existing `describe('subscription writes (Plan 051 ...))` block; add the member-cap block near it. `PREMIUM` fixture already exists in that file.

---

## Steps

### Step 1 — Member cap in `firestore.rules` (grandfathered, plan-aware)

Add a helper near the other household helpers and a clause to `allow update`:

```
// Plan 051: max members per plan. KEEP IN SYNC with utils/entitlements.ts
// (free=2, premium=20). subscription is on this same doc, so no extra get().
function planMaxMembers(data) {
  return (data.get('subscription', {'plan':'free','status':''}).plan == 'premium'
    && data.get('subscription', {'plan':'free','status':''}).status in ['active','trialing','past_due'])
    ? 20 : 2;
}
function withinMemberCap() {
  // Grandfathered: allow if new count <= cap OR the write does not grow the roster.
  return request.resource.data.memberUids.size() <= planMaxMembers(request.resource.data)
      || request.resource.data.memberUids.size() <= resource.data.memberUids.size();
}
```

Add `&& withinMemberCap()` to the household `allow update` predicate. Note: read the plan off `request.resource.data` (subscription is immutable via the existing rule, so request == resource for that field).

Also add the same cap to the household **join** path if members are added there (check the `memberUids` add clause and the members-subcollection `create` — a new member joining bumps `memberUids` via the household update, so the update rule covers it; confirm no other write path grows `memberUids`).

**Verify:** `pnpm test:rules` (CI-only — the Firestore emulator can't bind loopback on this Windows dev box; push and let CI run it, or run in an environment with the emulator). Expected: new member-cap cases pass, all existing cases still pass.

### Step 2 — `createkidprofile` callable (authoritative kid cap)

Create `functions/src/kid/createKidProfile.ts`: an `onCall` (v2, region us-central1 to match siblings) that:
1. Authenticates the caller and verifies they are an admin/member of `householdId` (mirror the auth checks in `functions/src/plaid/*` or `geminiProxy.ts`).
2. Reads `app_config/global.billingEnabled` (default false, same as `geminiProxy.ts:137-148`). If billing is off, **skip the cap** (parity with current client behavior — zero change while dormant).
3. If billing on: counts existing `members` where `isManaged == true`, resolves the household's plan via `functions/src/entitlements.ts`, and rejects with `HttpsError('resource-exhausted', ...)` if at/over `maxKidProfiles`. Grandfather: only block *new* creates, never existing profiles.
4. Creates the member doc via Admin SDK (bypasses rules) using the same shape as `utils/kidProfile.ts buildKidMemberDoc`.

Add `getMaxKidProfiles(data, billingEnabled)` to `functions/src/entitlements.ts` mirroring `utils/entitlements.ts` (KEEP IN SYNC comment). Export the callable from `functions/src/index.ts`.

**Verify:** `pnpm --filter functions lint && pnpm --filter functions test` — new `createKidProfile.test.ts` covers: billing-off (no cap), billing-on under cap (creates), billing-on at cap (rejects), non-member caller (rejects).

### Step 3 — Route `addKidProfile` through the callable

In `contexts/household/mutations/kidMutations.ts`, replace the direct `setDoc`/member write with an `httpsCallable(functions, 'createkidprofile')` call (lazy `getFunctionsInstance()`, matching `ConnectBankCard.tsx:34`). Keep the existing client-side `kidProfileLimitReached` pre-check as a fast UX guard that avoids a round-trip, but the function is now the real boundary. Map an `resource-exhausted` error back to the existing "Kid profile limit reached. Upgrade to add more." toast.

**Verify:** `pnpm lint && pnpm test` (root). Update/confirm any `MockHouseholdContext` `addKidProfile` still works in Test Mode (the mock does not call the function — it stays an in-memory write; ensure the real-vs-mock split keeps Test Mode green).

### Step 4 — Docs

Update `plans/README.md` status table (add row 051), and add one line to `utils/entitlements.ts` / `functions/src/entitlements.ts` noting member cap lives in `firestore.rules` and kid cap in `createkidprofile`.

---

## Test plan

- **Rules (CI):** member-cap describe block — free household at 2 can't add a 3rd; premium at 2 can; an already-4-member free household can still update (grandfather) and can shrink; adding still restricted to self.
- **Functions (local):** the four `createKidProfile` cases above.
- **Root (local):** existing suite stays green; Test Mode kid-add still works.
- Follow existing test styles: `tests/rules/firestore.rules.test.ts` for rules, `functions/src/**/*.test.ts` for the callable.

## Maintenance notes

- The cap numbers now live in **three** places: `utils/entitlements.ts` (client display), `functions/src/entitlements.ts` (kid cap + AI cap), and `firestore.rules` (member cap). All three carry a KEEP IN SYNC comment. A future limits change touches all three — grep for `maxMembers` / `maxKidProfiles` before editing.
- When billing eventually flips on, watch for support reports from grandfathered over-cap households; the grandfather clause lets them stay but not grow — that's intended.

## Escape hatches / STOP conditions

- **STOP and report** if any code path other than the household `allow update` can grow `memberUids` (e.g. a Cloud Function joining members) — the cap must cover every growth path or it's not a boundary.
- **STOP** if you find existing production households already over the free caps and the grandfather clause does not cleanly allow their normal updates in a rules test — get an owner decision before shipping (the alternative is a one-time backfill or a higher launch cap).
- **DO NOT** enforce `historyMonths` — it's deferred by design.
- **DO NOT** flip `billingEnabled`. Enforcement correctness and launch are separate decisions.
