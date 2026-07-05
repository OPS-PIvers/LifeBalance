> **SUPERSEDED by advisor-plans/06 (shipped).**

# Handoff: Stop full-collection scans in scheduled notification functions

**Status:** Not started · **Priority:** Medium (Firestore read cost / scalability) · **Risk:** Medium (needs a member-field migration)

---

## Problem

The four scheduled notification Cloud Functions each do `db.collection("households").get()` on
**every hourly invocation**, then read every member subcollection — `O(households + households×members)`
reads per tick, even when no member has that notification enabled or scheduled for the current hour.
This scales linearly with app growth and wastes reads forever.

### Evidence / where to look

- `functions/src/index.ts`:
  - `sendhabitreminders` (~line 142)
  - `sendactionqueuereminders` (~line 195)
  - `sendstreakwarnings` (~line 264)
  - `sendbillreminders` (~line 337)
  - each starts with `const householdsSnapshot = await db.collection("households").get();`

> Note: the API-key auth N+1 and the FCM stale-token cleanup from the same audit were already fixed
> (single `collectionGroup('apiKeys')` query; `arrayRemove` of invalid tokens).

## Why this was deferred

The efficient query needs a **denormalized, indexed field on member documents** (e.g. a
`notificationTimeslot` = the member's local reminder hour expressed in UTC, plus a
`notificationsEnabled` boolean). Writing that field to existing members is a one-off **migration**,
and keeping it correct requires updating it whenever a member changes their reminder time or
timezone — a behavior/data-model change beyond a mechanical optimization.

## Proposed approach

1. Schema: add `notificationTimeslot?: string` (e.g. `"14"` for 14:00 UTC) and reuse the existing
   per-notification enabled flags on `HouseholdMember`. Maintain it wherever notification settings
   are saved (`components/settings/NotificationSettings.tsx` → the member-update path).
2. Migration: backfill `notificationTimeslot` for existing members from their stored reminder
   time + timezone.
3. Functions: replace each `households` scan with
   `db.collectionGroup('members').where('notificationsEnabled','==',true).where('notificationTimeslot','==',currentUtcHour).get()`.
   Derive `householdId` from `memberDoc.ref.parent.parent?.id`. Add the matching collection-group
   indexes to `firestore.indexes.json`.
4. Alternative (larger): move to Cloud Tasks / per-member scheduled tasks instead of polling.

## Risks

- Timezone/DST correctness for the timeslot field.
- Migration must run before the functions switch over, or reminders silently stop for un-backfilled
  members. Ship the field+migration first, then the query change.

## Acceptance criteria

- Scheduled functions no longer call `collection("households").get()`.
- Reads per invocation scale with *members scheduled this hour*, not total households.
- Existing members still receive reminders at the right local time (verified post-migration).
- Collection-group indexes added; functions build + deploy clean.
