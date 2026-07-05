> **SUPERSEDED by advisor-plans/06 (shipped).**

# Plan 064 — Stop the hourly full-collection notification scans (cost at scale)

> **Status:** TODO · **Tag:** `[C→H]` (Claude builds; a **human watches** the collection-group
> index build + the migration before the query switch) · **Risk:** MED (member-field migration +
> index ordering; reminders silently stop if sequenced wrong) · **Effort:** M · **Planned against
> commit:** `a123feb`
>
> Source: `plans/audit/04-architecture-perf.md` (PERF-01 #1, PERF-06 #7), `todo/04-notification-scan.md`.
> PERF-01 is the audit's **#1** cost item — the "$50 → $3k Firebase bill at scale" finding.

## Problem
The four hourly scheduled Cloud Functions each call `db.collection("households").get()` **every tick**
and then read every member subcollection — `O(households + households×members)` reads per hour, **even
when no member has a notification enabled or scheduled for that hour**. This grows linearly with the
user base forever.

Evidence — `functions/src/index.ts`, each begins with `const householdsSnapshot = await db.collection("households").get();`:
- `sendhabitreminders` (~:142)
- `sendactionqueuereminders` (~:195)
- `sendstreakwarnings` (~:264)
- `sendbillreminders` (~:337)

(The API-key N+1 and FCM stale-token cleanup from the same audit are already fixed.)

## ⚠️ Design correction to `todo/04` (read before implementing)
`todo/04` sketches a single denormalized `notificationTimeslot` (a UTC hour) per member. **That is
unsafe as written**, for two reasons this plan corrects:
1. **Each member has up to four independent reminder times** — `prefs.habitReminders.time`,
   `actionQueueReminders.time`, `streakWarnings.time`, `billReminders.time` — so one timeslot can't
   represent them.
2. **A stored UTC hour breaks under DST.** The functions deliberately compute "now" in each member's
   **stored timezone** at runtime (`formatInTimeZone`, see the CLAUDE.md note on the scheduled jobs);
   a precomputed UTC hour drifts twice a year and would mis-fire or skip reminders.

So do **not** index by a precomputed UTC timeslot.

## Recommended approach (primary): a single `notificationsEnabled` boolean + collection-group query
The dominant waste is reading **every** member every hour when most have **no** notifications on. Cut
that with one denormalized boolean — without touching the (correct) in-function timezone logic:

1. **Schema** (`types/schema.ts`, `HouseholdMember`): add `notificationsEnabled?: boolean` — `true`
   iff **any** of the member's notification types is enabled. Keep all existing per-type prefs/time
   fields untouched.
2. **Maintain it** wherever notification settings are saved — `components/settings/NotificationSettings.tsx`
   → the member-update path. Recompute `notificationsEnabled = habitReminders.enabled || actionQueue…
   || streakWarnings… || billReminders…` on every save. (Member **update** rules already whitelist
   `notificationPreferences`/`fcmTokens` etc. — confirm the whitelist at `firestore.rules:200` permits
   adding this field to the changed-keys set; if not, that one-line rules tweak ships behind Plan 010
   rules tests + a human watch.)
3. **Migration** (`utils/migrations/` — follow the existing migration-script pattern; a one-off run):
   backfill `notificationsEnabled` for every existing member from their current prefs. **Run the
   migration and let it complete before** the functions switch to the new query, or un-backfilled
   members (treated as `enabled != true`) silently stop getting reminders.
4. **Collection-group index** (`firestore.indexes.json`): add a `members` collectionGroup index
   supporting `where('notificationsEnabled','==',true)`. **Ship the index in its own PR first**, let a
   human confirm it reaches *Enabled* in the Firebase console (atomic deploy — PRD §2), then the query
   change.
5. **Functions:** replace each `db.collection("households").get()` + member loop with
   `db.collectionGroup('members').where('notificationsEnabled','==',true).get()`, deriving
   `householdId` from `memberDoc.ref.parent.parent?.id` (guard the `undefined`). Keep the **existing
   per-type `isTimeToSend` + `formatInTimeZone` checks unchanged** inside the loop — correctness is
   preserved; only the candidate set shrinks from "all members" to "members with any notification on".
   When a household-level read is still needed (e.g. bill reminders read the household's `calendarItems`),
   fetch per distinct household id from the filtered members (dedupe ids first).

This is a **big read reduction with minimal correctness risk** (the timezone/DST logic is unchanged),
a **one-boolean** migration, and **one** simple index.

### Secondary (optional, larger): per-member scheduled tasks
For a further reduction, move from hourly polling to **Cloud Tasks** scheduled per member at their
local reminder time (the `todo/04` "larger alternative"). More correct (zero idle scans) but
significantly more work and a new failure surface. Note it; don't build it in the first pass.

## Ride-along: PERF-06 — `sendbudgetalerts` independent reads
`sendbudgetalerts` (`functions/src/index.ts` ~:467) issues its `members`, `accounts`, and (since the
023 follow-up) household-doc reads **sequentially**. They're independent — `Promise.all` them. Tiny,
safe, no migration; fold it into the functions PR or ship separately. (Also consider reading the
household doc for `currency` **only** when an alert will actually fire, to skip it in the common case.)

## Sequencing (STOP conditions)
1. PR A — schema field + `NotificationSettings` maintenance + migration script (no function change).
   Run the migration; confirm members are backfilled.
2. PR B — the collection-group **index only**. Deploy; **human confirms it is *Enabled***.
3. PR C — switch the four functions to the filtered query + the PERF-06 parallelization.
- **STOP and report** if: the member-update rule rejects the new field (needs a rules PR behind Plan
  010); the migration can't be verified complete; or any function needs data not reachable from the
  filtered member set.

## Test plan
- Unit-test the `notificationsEnabled` derivation (all-off → false; any-on → true) where settings are saved.
- Functions tests (`functions/src/index.test.ts` harness): mock `collectionGroup('members')` and assert
  each function only processes returned members and still applies the per-type time check; assert
  `householdId` is derived from `ref.parent.parent.id`.
- Migration test: a member with mixed prefs → correct boolean.

## Acceptance criteria
- No scheduled function calls `collection("households").get()`.
- Reads/invocation scale with **members who have notifications enabled**, not total households.
- Existing members still get reminders at the right local time post-migration (timezone/DST unchanged).
- Collection-group index declared + built before the query switch; functions build + deploy clean.

## Maintenance notes
- `notificationsEnabled` must be recomputed on **every** notification-settings save — if a future
  settings path forgets, that member silently drops out of (or into) the scan. Centralize the
  derivation in one helper and call it from every member-update site.
- If per-type scheduled delivery is later desired, revisit the Cloud Tasks option.
