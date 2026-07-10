# Plan 22: Household calendar ICS feed (spike-gated build)

> **Executor instructions**: Step 1 is a mandatory spike whose findings you append
> to this file; Steps 2+ only proceed if the spike confirms the design's
> assumptions. Run every verification; honor STOP conditions. Update the status
> row in `advisor-plans/README.md` when done.
>
> **Drift check (run first)**:
> `git diff --stat fce26e4..HEAD -- utils/calendarRecurrence.ts functions/src/index.ts firestore.rules`
> On mismatch with "Current state", STOP.

## Status

- **Priority**: P3 (Phase 6 — the strategic "family calendar" bet, cheapest slice first)
- **Effort**: M
- **Risk**: MED — a tokened public HTTP endpoint exposing household bill data; the token design below is mandatory
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `fce26e4`, 2026-07-09

## Why this matters

The app has a bills/income calendar (`CalendarItem`) but no way to see those dates where families actually live: their phone calendars. A read-only ICS subscription feed ("add LifeBalance to Google/Apple Calendar") is the cheapest slice of the family-calendar strategy — it ships visible daily value (bills on the shared calendar) without building any new UI surface, and it derisks the bigger "general family events" bet by proving demand first.

## Design (decided — the spike validates, not re-opens)

- A **callable** `generatecalendarfeedtoken` (member-auth, like `deletehousehold`'s membership check) generates a random 128-bit token and writes it to the household doc via the **Admin SDK** — deliberately server-side so `firestore.rules` need no change (client writes to a new household field might violate the rules' update constraints; Admin SDK bypasses rules).
- An **HTTP** `calendarfeed` function (onRequest, GET): `?hid=<householdId>&token=<token>`; constant-time-ish token compare against the stored field; on match, reads `calendarItems` and emits `text/calendar`.
- ICS emission uses **RRULE** for recurring templates (weekly=`FREQ=WEEKLY`, bi-weekly=`FREQ=WEEKLY;INTERVAL=2`, monthly=`FREQ=MONTHLY`) with `EXDATE` for occurrences covered by paid/deleted instance docs — the exact template/instance semantics are already documented and implemented server-side in `findBillsDueOnDate` (`functions/src/index.ts:328-405`); reuse its interpretation, not the client's expansion.
- Events are **all-day** (`DTSTART;VALUE=DATE`) since `CalendarItem.date` is a local `yyyy-MM-dd` — no timezone math.
- Settings UI: a row in Data Management with "Enable calendar feed" → shows the copyable `webcal://…/calendarfeed?hid=…&token=…` URL + a "Regenerate" (rotates the token, invalidating old links).

## Current state (verified 2026-07-09)

- `utils/calendarRecurrence.ts` — client recurrence engine; `functions/src/index.ts:320-405` — server-side `BillCalendarItem` shape + template/instance semantics (anchor `date` never advances; instance docs carry `parentRecurringId` + `isPaid`/`isDeleted`).
- Functions exemplars: HTTP endpoints live in `functions/src/quickAdd/index.ts` (onRequest style, auth patterns); callables like `deletehousehold` (`index.ts:666-719`) show the membership check to copy.
- No `firestore.rules` change is needed under this design (Admin SDK writes) — if the spike finds otherwise, STOP (rules PRs are human-watched in this repo).

## Spike notes (2026-07-09, executor)

**Drift check**: `git diff --stat fce26e4..HEAD -- utils/calendarRecurrence.ts functions/src/index.ts firestore.rules`
shows only `functions/src/index.ts` changed (115 lines, mostly deletions from an
unrelated dead-code cleanup, plan 15). `findBillsDueOnDate`/`BillCalendarItem`/
`recurrenceFallsOn` still exist, semantics unchanged, just shifted to
`functions/src/index.ts:324-409` (was 328-405). No functional divergence — proceeding.

1. **Rules check**: read `firestore.rules:111-147` (household `allow update`). There
   is **no `request.resource.data.keys().hasOnly([...])` allowlist** at the
   household-doc level — the rule only *blocks* specific fields (`createdBy`,
   `createdAt`, `inviteCode`, `subscription`, plus validated `aiUsage`/`memberUids`
   diffs). A brand-new field like `calendarFeedToken` would actually **pass**
   today's rules for a client-side write. This mildly undercuts the plan's stated
   rationale ("client write would violate rules"), but doesn't change the
   decision: the callable design is kept anyway because (a) it needs
   `crypto.randomBytes` server-side entropy, not a client-guessable/predictable
   token, (b) it still means **zero rules diff**, satisfying the hard
   "no `firestore.rules` edits" constraint regardless of whether one was
   technically required. STOP condition ("spike shows a rules change IS
   required") is **not** triggered — no rules file edits are needed under this
   design, full stop.
2. **Income vs expense**: `types/schema.ts:226` — `CalendarItem.type: 'income' |
   'expense'`. Confirmed v1 scope per the design: feed emits `type === 'expense'`
   items only ("bills on the calendar"); `income` items excluded.
3. **Hosting rewrites**: not configured for a friendly feed path; v1 uses the
   default `https://<region>-<project>.cloudfunctions.net/calendarfeed` URL
   (matches `deletehousehold`-style callables/HTTP fns in this codebase — no
   custom domain routing exists for any function today). Acceptable per design.
4. **ICS escaping/folding**: RFC 5545 TEXT escaping — backslash `\`, comma `,`,
   semicolon `;` are escaped with a leading backslash; literal newlines become
   `\n` (escaped, two chars). Line folding: any content line over 75 **octets**
   is split with a CRLF followed by a single leading space (soft line break),
   splitting only at UTF-8-safe boundaries (never inside a multi-byte
   char/escape pair). `buildIcs` implements both — folding is asserted with a
   generated long-SUMMARY test case.

Function-file conventions confirmed from neighboring code (`geminiProxy.ts`,
`fetchRecipePage.ts`, `quickAdd/index.ts`): callables use `onCall(opts, handler)`
+ `HttpsError`; HTTP endpoints use `onRequest(opts, (req, res) => ...)` with a
minimal `HttpResponse`-shaped `res` (`status().json/send()` + `set()`); `admin.firestore()`
is called lazily inside the handler (not module scope) in the newer modules
(`geminiProxy.ts:132`) — followed here. Tests mock `firebase-functions/v2/https`
(`onCall`/`onRequest` → return the raw handler) and `firebase-admin` (a single
shared reconfigurable mock `db`), matching `geminiProxy.test.ts` /
`quickAdd/index.test.ts` style.

**Decision: proceed to Step 2.** No STOP conditions triggered.

## Steps

### Step 1: Spike (append "## Spike notes" here before coding)

1. Confirm the household doc's update rules would indeed block a client-side token write (read `firestore.rules`' household update validation) — this justifies the callable design; record the lines.
2. Confirm the `calendarItems` doc fields match `BillCalendarItem` for income items too (the feed includes income? DECIDE: v1 = expenses only, matching "bills on the calendar"; income excluded — record it).
3. Check whether Firebase Hosting rewrites are needed for a friendly feed URL or if the default cloudfunctions.net URL is acceptable (v1: default URL is fine; record).
4. List the ICS escaping rules needed (SUMMARY text: commas, semicolons, newlines) and the line-folding requirement (75 octets) — the emitter must handle both.

**Verify**: Spike notes appended with evidence.

### Step 2: Token callable + feed function

`functions/src/calendarFeed.ts`: both functions + a pure, heavily-tested `buildIcs(items: BillCalendarItem[], householdName: string): string` (VCALENDAR/VEVENT, UID per item id, RRULE mapping, EXDATE from paid/deleted instances, escaping + folding per spike note 4). Token: `crypto.randomBytes(16).toString('hex')`; feed returns 404 on any mismatch (don't distinguish bad-hid from bad-token). Rate-limit consideration: set `maxInstances: 2` on the feed function (calendar clients poll; cap the cost).

**Verify**: functions tests for `buildIcs` (≥8 cases: one-off, weekly, bi-weekly, monthly, paid-instance EXDATE, deleted-instance EXDATE, escaping, folding) + token-mismatch 404 test → pass; `pnpm lint:all` → exit 0.

### Step 3: Settings row

Enable/regenerate/copy UI in the Data Management section (`pages/Settings.tsx`), calling the callable and rendering the URL (build it from the function's known URL shape; keep it in one constant). Warn inline: "Anyone with this link can see your bill calendar — regenerate to revoke."

**Verify**: `pnpm lint && pnpm test && pnpm run build` → exit 0.

### Step 4: Post-deploy verification note

End-to-end needs a deployed function: record in the PR that verification = subscribe from Google Calendar with a real token, see bills appear, regenerate, confirm the old URL 404s.

## Done criteria

- [x] Spike notes appended; `buildIcs` unit-tested; both functions exported
- [x] Settings row ships with the revocation warning
- [x] All gates green; post-deploy verification steps in the PR (see below); `advisor-plans/README.md` update SKIPPED per operator amendment (this executor run)

## Post-deploy verification (Step 4)

This feed cannot be fully verified locally — `calendarfeed`/`generatecalendarfeedtoken`
only work once deployed (real Cloud Functions URL, real Firestore). After deploy:

1. In Settings → Data → "Enable calendar feed", tap Enable; confirm a `webcal://…`
   URL appears with `hid=` and `token=` query params.
2. Copy the URL, swap `webcal://` for `https://` and open it in a browser — confirm
   a `text/calendar` response body starting `BEGIN:VCALENDAR`.
3. Subscribe from Google Calendar (Other calendars → From URL) using the `https://`
   form of the link; confirm unpaid expense bills appear, recurring ones repeat on
   schedule, and paid/deleted occurrences do NOT appear.
4. Tap Regenerate; confirm the OLD URL now 404s and the NEW URL serves the feed.
5. Confirm income calendar items never appear in the feed (v1 = expenses only).

## STOP conditions

- The spike shows a rules change IS required after all — stop; rules PRs are human-watched.
- Any temptation to make the feed unauthenticated-by-obscurity without the token compare — refuse.
- `calendarItems` docs deviate from `BillCalendarItem` in ways that break RRULE mapping — report.

## Maintenance notes

- This is deliberately the FIRST slice of the family-calendar strategy (audit G1). If subscription/usage proves out, the next slices are: general (non-money) events entity → in-app month/agenda view → inbound Google sync (OAuth, real ops burden — separate decision).
- Token is a capability URL: never log it in functions logs.
