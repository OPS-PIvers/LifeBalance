# Wall Display (Kiosk Mode)

> **Status:** Phase 0 lab built, device run pending (see
> [`wall-display-phase0-results.md`](wall-display-phase0-results.md)).
> Phases 1 and 2 (identity + shell) shipped together in one PR; the setup
> steps are in [`../WALL_DISPLAY_RUNBOOK.md`](../WALL_DISPLAY_RUNBOOK.md).
> Where the build differs from this plan, the section says so inline
> ("**As built:**"). Every product and UI decision below was made
> with the owner in a structured interview (Oct 2026). The clickable UI spec is
> [`wall-display-prototype.html`](wall-display-prototype.html) in this folder:
> open it in a browser. Where this document and the prototype disagree, this
> document wins. A fresh agent should be able to execute any phase from this
> document alone.

## 1. Goal

Turn a 1st-generation iPad Pro 12.9" into an always-on, wall-mounted family
display for LifeBalance, in the spirit of Skylight. It's the same
Firebase-hosted web app, reached at a new `#/wall` route. There's no separate
project and no native app. The wall:

- shows the family calendar (synced from Google, iCloud and school/team ICS
  feeds), shopping list, to-dos and the week's meals, readable from across a
  room;
- accepts touch actions (check off, add, delete) through the **existing**
  LifeBalance mutation code and Firestore rules;
- accepts tap-to-talk voice commands;
- runs unattended: no login prompts, recovers from network drops and sleep,
  dims itself overnight, updates itself.

Out of scope: a native iOS app, and any change to the existing phone UI other
than a new **Settings → Wall display** section and a "Set up a wall display"
link on the login screen.

## 2. Hardware and device constraints

| Item | Decision / fact |
|---|---|
| Device | iPad Pro 12.9" 1st gen (2015), A9X, 4 GB RAM, 2732×2048 LCD, CSS viewport **1366×1024** landscape |
| OS ceiling | **iPadOS 16.7.x** (Safari 16.6). The device must be updated to the latest 16.7.x before anything else. The current production build targets Safari **16.4** (Vite 8 default; Tailwind v4 needs 16.4; `utils/cardOwnership.ts:34` has a regex lookbehind that won't even parse below 16.4). |
| Mounting | Wall mount, **landscape only**, permanently on the charger |
| Run mode | Home Screen web app (standalone) under **Guided Access**, Auto-Lock **Never** (both the system setting and Guided Access's own Display Auto-Lock) |
| Brightness | A web page can't control the backlight. Two Shortcuts **Personal Automations** (Time of Day, *Ask Before Running* off) set brightness to 0% at night start and 70% at night end. Whether these fire under Guided Access gets verified in Phase 0. |
| Wake | No NoSleep or wake-lock code is needed: Auto-Lock Never handles it. (Screen Wake Lock isn't available to Home Screen apps on iPadOS 16.) |
| Battery | A 2015 battery on 24/7 power can swell. The setup runbook says to inspect the case edge monthly. A smart plug that cuts power for 2 h overnight is optional. |

**Safari 16.4–16.6 feature budget** (anything above this needs a fallback or
must not be used on `/wall`): CSS nesting is fine via Tailwind's build;
`:has()`, `dvh`, container queries, `color-mix()`, `@property`,
`overscroll-behavior`, `<dialog>`, `inert`, `structuredClone`, `Array.at`,
`AbortSignal.timeout` and `MediaRecorder` (audio/mp4) are all OK. **Not
available:** `text-wrap: balance` (harmless if ignored), View Transitions,
`navigator.wakeLock` in standalone, Set methods, `Promise.withResolvers`,
`Object.groupBy`, `Array.prototype.toSorted/with`. Grep for these before
merging each wall PR.

## 3. Decisions (from the interview)

### Scope (v1)
- **Views:** Calendar (Week default, Day, Month), Shopping, To-dos, Meals.
- **Deferred to v2:** Habits/chores on the wall, the "who did it?" avatar picker, Scores.
- **Money on the wall:** only **unpaid bill names**, no amounts. The display identity must never be able to read finance collections.

### Identity and settings
- **Auth:** a pairing code becomes a restricted **display identity** (Firebase custom token). It's not a household member, it's revocable, and multiple named displays are allowed.
- **Settings home:** phone **Settings → Wall display**. On the wall, only a PIN-protected gear menu: sync now, reload, start rotating, unpair. The PIN is the existing **Kid Mode PIN** (`household.kidModePinHash`, verified with `verifyKidPin`).
- **Calendar feeds:** private **ICS links only** (Google "secret address in iCal format", iCloud public share link, school/team webcal). Each feed has an **owner** (a member or *Family*) that decides its color. Only **admins** add feeds. Built-in US holidays feed with a toggle. Synced every **15 min**, plus "sync now".
- **Stale feed** (no successful sync for 24 h) is reported **on the phone only**: a push to admins plus a red note on the feed row. It is never shown on the wall.

### Look and feel
- **Theme:** Light by default, **Dark included in v1** as a setting. Both palettes are in the prototype.
- **Text size:** Normal / Large (×1.15), set on the phone.
- **Rail** (left, 104px): Calendar, Shopping, To-dos (badge = open overdue + due-today count), Meals; filled mic button; gear.
- **Top bar** (every screen, ~128px):
  - **Time** "3:15" (72px Besley, no am/pm) with "Saturday" / "October 3" on two rows beside it.
  - **Weather:** a small icon plus the current temperature at the **same 72px**, with "H 61°" / "L 43°" on two rows beside it.
  - **Three time-of-day blocks** (Afternoon / Evening / Overnight, or the next three depending on the hour), plus a blue rain note only when rain is likely.
  - **View controls** on the right: **Day · Week · Month** (in that order) on calendar screens; **+ Add** and **Clear (n)** on lists.
  - Tapping the weather opens a 5-day forecast sheet.
  - The time and weather blocks must use **one shared "hero + two sub-rows" component** so their spacing can't drift apart.
- **Times** read "3:30". Add "am"/"pm" only before 7 am and from 9 pm on.
- **Person identity:** colored dot + name in muted text. Month view uses the dot only. Day view uses a filled initial avatar on each block.
- **Empty states:** plain and minimal ("No events today", "List is empty").
- **Status:**
  - Offline under 15 min: a small amber "Offline" mark in the rail above the mic; tapping it explains.
  - Offline 15 min or more: a thin strip under the top bar.
  - No status pills.

### Calendar
- **Week (the resting screen):**
  - **Today panel** on the left:
    - Events with past ones faded, and an amber "now" line.
    - A **"Due today"** checklist of overdue and due-today to-dos.
    - Tonight's **dinner**.
  - **Right panel:** up to **two stacked modules** chosen from *Coming up*, *Shopping*, *To-dos*, *Meals this week*.
    - Each module header has **Switch** (menu) and **×**.
    - With one module showing, **+ Add module** sits at its bottom. Removing all modules gives **Today-only** mode, with Today's type ×1.25.
    - Two modules **fit to content**: the top is capped at 60% of the height, and there's no setting for this.
    - If To-dos or Meals is in the panel, Today hides its own "Due today" or dinner line.
    - The wall remembers its layout (per display). Its starting layout comes from phone Settings. Hiding sticks and doesn't reset on idle.
  - **Coming up:**
    - Next **14 days**, one event per line, never truncated.
    - Sticky day headers, scrolling, a "See the month →" link at the end.
    - Scroll snaps back to the top after 3 min idle.
  - Bills and days off show as **muted lines with a receipt or flag icon**.
- **Day:** **one mixed timeline**, 7 am–10 pm, beside a **panel for that day** (not the Week modules).
  - Each block is a card tinted in its owner's color, with a colored left edge and a filled initial avatar. Title comes first; under 1.5 h, title and time share one line.
  - Overlaps sit side by side and widen into columns that are free while they run. Past three columns, the rest fold into a "+N more" chip.
  - Tapping any block or chip lists everything in that overlap, in full (time, title, person).
  - The all-day strip holds only all-day events, bills, days off and events outside 7 am–10 pm, and hides when empty.
  - The panel: the forecast for a later day (today's is in the top bar), that day's to-dos as checkboxes with **+ Add** for that date (not on past days), and its dinner (tap opens it in Meals).
  - There is no lanes toggle and no module menu.
- **Month:** up to 3 lines a day, then "+N more". Tapping a day opens Day view.

### Lists and meals
- **Shopping:**
  - One list flowing in two columns, grouped by store.
  - Checking an item moves it to **"In the cart"** under its store.
  - **Clear (n)** removes checked items.
- **To-dos:**
  - Grouped Overdue / Today / This week, with person filter chips.
  - Saved-for-later items are hidden.
  - Kid points are credited exactly as on the phone.
- **Add:**
  - **+ Add** opens a top-anchored entry sheet above the iPad keyboard (which covers about 40% of the screen in landscape).
  - Grocery catalog suggestions and store chips; for to-dos, For/Due chips.
  - A mic button inside the field.
  - The sheet stays open for the next item until **Done**.
- **Delete:** swipe left, then Undo.
- **Undo** for every write: a dark toast at bottom center for 10 s. A newer toast replaces the older one.
- **Meals:**
  - Dinner rows; breakfast and lunch appear as a small line only when planned.
  - Tapping a dinner opens a read-only **recipe panel** with "Add N missing to Shopping".
  - No planning on the wall.

### Behavior
- **Auto-rotate:**
  - Off by default.
  - When on, it rotates **panel modules only**. Today never moves. With two modules stacked, the top stays and the bottom rotates.
  - Interval 30 s / **60 s** / 2 min / 5 min.
  - Any touch or voice pauses it. It resumes after idle.
- **Idle return:** after **3 min** untouched, the wall returns to Week, closes overlays and resets scroll.
- **Night:**
  - **10 pm–6 am**, configurable.
  - Dim clock on black, plus the first event tomorrow.
  - A tap wakes it for 60 s.
- **Maintenance:**
  - App updates install silently during the night window, with no `confirm()`.
  - One full reload at **3 am** (skipped while writes are pending).

### Voice (must ship in v1, tap-to-talk)
- **Commands:**
  - Add shopping items: "add milk, eggs and two avocados to the grocery list".
  - Add to-dos, with person and date parsed. The defaults are Family and today.
  - Navigation: "show calendar / lists / shopping / to-dos / meals".
  - "Start / stop rotating".
- **Banner states** at bottom center: Listening → Heard (working) → Result with **Undo** + "Show list" → "Didn't catch that" + Try again. The banner auto-dismisses after 10 s.
- **Engine:** decided by the Phase 0 device test (§6).

## 4. Architecture

### 4.1 Identity: the display user

```
Phone (admin)                    Cloud Functions                      iPad (Home Screen app)
Settings → Wall display
  "Add a wall display" ──► createwallpairing (callable, admin)
                           • creates displays/{did} {status:'pending', name}
                           • stores sha256(code) in wallPairings/{codeHash}, TTL 10 min
  shows "482 913" ◄────────┘
                                                                      #/wall/pair  enters 482913
                           redeemwallpairing (callable, no auth) ◄── {code, userAgent}
                           • looks up hash, checks TTL + attempts (max 5)
                           • uid = `display_${did}`
                           • setCustomUserClaims(uid, {display:true, hid, did})
                           • createCustomToken(uid, {display:true, hid, did})
                           • displays/{did}.status = 'active', pairedAt
                           • deletes the pairing doc
                           returns token ───────────────────────► signInWithCustomToken(auth, token)
                                                                    refresh token persists in IndexedDB
```

- **Claims live on both the token and the user record** (`setCustomUserClaims`), so they survive every ID-token refresh.
- **Revoke** (`revokewalldisplay`, admin): `displays/{did}.status='revoked'`, `revokeRefreshTokens(uid)`, `deleteUser(uid)`. Rules also require `displays/{did}.status == 'active'`, so revocation takes effect on the next request, not after token expiry.
- **IAM (one-time manual step):** Gen2 functions run as the default compute service account. It needs **Service Account Token Creator** on itself for `createCustomToken`, and the **IAM Service Account Credentials API** must be enabled. Add this to a new `docs/WALL_DISPLAY_RUNBOOK.md`.
- **Pairing must happen inside the installed Home Screen app.** On iPadOS 16, standalone apps keep storage separate from Safari.
- The display uid must **never** get an `admin` claim (`isSuperAdmin()` in rules honors `token.admin`) and must **never** get a `members/{uid}` doc. A members doc would hand it every member write path, including Case 4 points writes.

### 4.2 Client: routing and providers

- **`contexts/AuthContext.tsx`**
  - Right after `setUser(firebaseUser)` (around L43), read `firebaseUser.getIdTokenResult()`.
  - If `claims.display === true` and `claims.hid` is a string, set `householdId = claims.hid` and a new `isDisplay = true` (plus `displayId`).
  - Then return **before** `getUserHousehold` and the beta-tester guard. A custom-token user has no email, so that guard would sign it out.
  - Add `isDisplay` and `displayId` to the context type and to `MockAuthContext`.
- **`App.tsx`** provider tree is `HashRouter > ThemeProvider > Auth > Household`. Replace the household layer with a small `HouseholdOrWallProvider`:
  - `isDisplay` → render **`WallFirestoreProvider`** only, and redirect every route to `/wall`. `FirebaseHouseholdProvider` must not mount: it attaches finance, recap and notificationLog listeners the display can't read.
  - Otherwise → the existing provider, unchanged.
- **Routes**, next to `/onboarding`, with no `MainLayout`:
  - `/wall` → `WallApp`.
  - `/wall/pair` → `WallPairing`. Public; it's the only screen a signed-out wall shows.
- **Members can open `#/wall` too** (preview, dev, and a member's own spare iPad). It then runs on **`WallSlicesProvider`**, an adapter over the existing `useShopping` / `useTodos` / `useMealPlan` / `useHouseholdCore` hooks. The same adapter is what makes the wall work in **Test Mode** (Mock providers mirror the slices), so e2e needs no Firebase.
- **Signed-out launch:** iOS launches the Home Screen app at manifest `start_url` (`/`), which shows `/login`.
  - Add a **"Set up a wall display"** link on the login page that goes to `/wall/pair`.
  - It also sets `localStorage['LB_WALL_DEVICE']='1'`.
  - When that flag is set and there's no user, `ProtectedRoute` redirects to `/wall/pair` instead of `/login`.
  - Unpairing clears the flag.

### 4.3 Client: the wall data contract

`components/wall/data/WallDataContext.tsx` defines one narrow interface. Both
providers implement it, and wall components consume **only** this:

```ts
interface WallData {
  householdId: string; displayId: string | null; isDisplay: boolean;
  household: Pick<Household, 'kidModePinHash' | 'stores' /* …display-safe fields only */>;
  members: HouseholdMember[];              // for names, colors, kid-points credit
  memberColors: MemberColorMap;            // buildMemberColorMap(members), plus dark variants
  wallEvents: WallEvent[];                 // §4.5
  todos: ToDo[]; shoppingList: ShoppingItem[]; groceryCatalog: GroceryCatalogItem[];
  mealPlan: MealPlanItem[]; meals: Meal[];
  settings: WallSettings; layout: WallLayout;  // §4.4
  ready: boolean;                          // first snapshot of every listener (like ListenerReadiness)
  actions: {
    addShoppingItem, toggleShoppingItemPurchased, deleteShoppingItem, clearPurchasedShoppingItems,
    addToDo, completeToDo, uncompleteToDo, deleteToDo,
    setLayout(layout: WallLayout): Promise<void>,
    syncCalendarsNow(): Promise<void>,
  };
}
```

**`WallFirestoreProvider`** attaches only these listeners:
- the household doc, as its own `onSnapshot`, **not** `attachCoreListeners`;
- members, via `householdMemberConverter`;
- `attachShoppingListeners`;
- `attachTodoListeners`;
- `attachMealListeners`, for this week's range;
- `wallEvents`, for the visible window;
- `wallSettings/config`;
- `displays/{did}`.

It builds actions by calling the **existing factories** with the deps they expect:

| Action | Factory (file) | Deps the wall provider passes |
|---|---|---|
| add / delete shopping | `makeShoppingListMutations` (shoppingMutations.ts:36) | `{db, householdId}` |
| toggle purchased | `makeToggleShoppingItemPurchased` (:305) | `{db, householdId, shoppingList, groceryCatalog}` |
| clear checked | `makeClearPurchasedShoppingItems` (:414) | `{db, householdId, shoppingList}` |
| add to-do | `makeAddToDo` (todoMutations.ts:223) | `{db, householdId, user: {uid: displayUid, displayName: display.name}}` |
| delete to-do | `makeTodoCrudMutations` (:290) | `{db, householdId}` |
| complete / uncomplete | `makeCompleteToDo` (:432) / `makeUncompleteToDo` (:644) | `{db, householdId, membersRef, user: displayStub}` |

The `user` stub is a structural `{uid, displayName}`. If the factory types
demand a full `firebase/auth` `User`, narrow the factory parameter type to
`Pick<User, 'uid' | 'displayName'>`. That's a type-only change, with no
behavior change, and better than casting. Activity-log entries from the wall
then read as "Kitchen iPad completed …".

### 4.4 New Firestore data (`types/schema.ts`, with converters in `utils/firestoreConverters.ts`)

All of these live under `households/{hid}/…`:

**`displays/{did}`**
- `name`: e.g. "Kitchen iPad"
- `status`: `'pending' | 'active' | 'revoked'`
- `createdBy`, `createdAt`, `pairedAt?`, `lastSeenAt?`, `appVersion?`
- `layout`:
  ```ts
  layout: {
    modules: WallModuleKey[]   // 0-2 of 'coming' | 'shopping' | 'todos' | 'meals'
  }
  ```
- Only the server writes it, except for one narrow display self-update: `lastSeenAt`, `appVersion`, `layout`.

**`wallSettings/config`** (a single doc, writable by any member)
- `defaultModules: WallModuleKey[]` (default `['coming']`)
- `rotation: { enabled: false, intervalSec: 60 }`
- `idleReturnSec: 180`
- `night: { start: '22:00', end: '06:00' }`
- `theme: 'light' | 'dark'`
- `textSize: 'normal' | 'large'`
- `showBills: true`
- `holidaysEnabled: true`
- `weather: { lat, lon, label }`, geocoded on the phone with Open-Meteo's geocoding API
- `timeZone`: IANA. Captured from `Intl` on the phone that saves settings; the default is the first admin's `notificationPreferences.timezone`.

**`calendarFeeds/{fid}`** (clients read it; only the server writes it)
- `label`, `ownerKey: memberUid | 'family'`, `kind: 'ics' | 'holidays'`
- `createdBy`, `createdAt`
- `lastSyncAt`, `lastSuccessAt`, `lastError?`, `eventCount`, `stale: boolean`
- The **URL is not here**; it lives in `calendarFeedSecrets/{fid}`.

**`calendarFeedSecrets/{fid}`**
- `url`: normalized; `webcal://` becomes `https://`
- `etag?`, `lastModified?`
- No client access at all (`allow read, write: if false`). The URL is a credential.

**`wallEvents/{eventId}`** (server-written, read by members and displays)
- Event fields:
  ```ts
  { source: 'feed' | 'bill' | 'holiday',
    feedId?, ownerKey,
    title, allDay: boolean,
    date: 'yyyy-MM-dd',     // local date; all-day events get one doc per day they span
    start?, end?,           // ISO strings with offset, timed only
    location? }
  ```
- `eventId = sha1(feedId + UID + recurrenceStart)`, so re-syncs upsert instead of duplicating.
- **Window:** first day of the previous month through +3 months.
- **Bills** (`source:'bill'`): title + date only. **Never amount, accountId or bucket.**

**`wallPairings/{codeHash}`** (top-level, server only)
- `hid`, `did`, `expiresAt`, `attempts`

### 4.5 Cloud Functions (`functions/src/wall/`, v2 API, us-central1)

| Function | Trigger | Notes |
|---|---|---|
| `createwallpairing` | onCall, admin only (mirror `deletehousehold`'s role check) | Body `{name}`. Creates a pending display and a 6-digit code (crypto random, never starting with 0). Max 3 pending per household. Returns `{code, expiresAt, did}`. |
| `redeemwallpairing` | onCall, unauthenticated | Body `{code}`. Hash lookup, TTL, claims + token as in §4.1. **As built:** a per-code attempt count can't work (a wrong guess hashes to a different doc, so it never touches the real code), so guessing is bounded by failure windows instead: 10 per caller (hashed IP) and 200 across all callers per hour (`wallPairingThrottle`). The identity is minted before the code is consumed, so an IAM misconfiguration leaves the code usable once fixed. |
| `revokewalldisplay` | onCall, admin | Body `{did}`. |
| `syncwallcalendars` | onSchedule `every 15 minutes`, timeoutSeconds 300 | For each household that has feeds, sync each feed, then project bills (below). |
| `syncwallcalendarsnow` | onCall, member **or** display of that household | Same per-household sync. Throttled to once per 2 min via `wallSettings/config.lastManualSyncAt`. |
| `projectwallbills` | onDocumentWritten `households/{hid}/calendarItems/{id}` | Recomputes `source:'bill'` events for that household, so a paid bill disappears from the wall within seconds. Skips when `showBills` is false (and deletes the existing bill events). |
| `addwallcalendarfeed` / `updatewallcalendarfeed` / `removewallcalendarfeed` | onCall, admin | Validates the URL with `assertFetchableUrl` (fetchRecipePage.ts:49, the SSRF guard) after normalizing `webcal://`. Test-fetches the URL and parses it before saving, so a bad link fails right away on the phone. Writes the feed doc and the secret doc. |

**ICS sync details:**
- **Fetch:**
  - Undici `fetch` with `AbortSignal.timeout(10_000)` and a 5 MB body cap.
  - Sends `If-None-Match` / `If-Modified-Since`, so a 304 skips the parse.
  - Re-checks `assertFetchableUrl` on the final URL after redirects.
- **Parse:** new dependency **`ical.js`** (Mozilla; handles RRULE, EXDATE, RECURRENCE-ID overrides and VTIMEZONE). Expand recurring events into the window with `ICAL.RecurExpansion`, convert to `settings.timeZone` with `date-fns-tz` (already a dependency), and cap at 2,000 occurrences per feed.
- **Write:** diff against the existing `wallEvents` where `feedId == fid`. Upsert changed docs and delete vanished ones, in batches of 450.
- **Bookkeeping:** update the feed doc's `lastSyncAt`, `lastSuccessAt`, `eventCount` and `lastError`.
- **Stale:**
  - When `lastSuccessAt` is more than 24 h old and `stale` was false: set `stale = true` and push to every admin. There's no admin-only push helper today, so filter `members` by `role == 'admin'` and call `sendNotificationToUser` (shared/notifications.ts:209). Add `'calendar_feed_stale'` to the notificationLog type union.
  - It clears when a sync succeeds again.
- **Holidays:** a built-in feed doc with `kind:'holidays'`, pointing at Google's public US holidays ICS. It's created when the first wall is paired and toggled by `holidaysEnabled`.
- **Bills projection:** expand unpaid, non-deleted expense `calendarItems` across the window. Use the same template/instance rules as `functions/src/shared/bills.ts` `findBillsDueOnDate` and `calendarFeed.ts`: skip paid instances and templates whose instance on that date is paid.

**As built (Phase 3)** (`functions/src/wall/calendar/`):
- `icsParse.ts` resolves each TZID with `date-fns-tz` rather than ical.js's process-global `TimezoneService`, so one feed's VTIMEZONE can't redefine another household's zone in a shared instance. Non-IANA TZIDs (Outlook's "Eastern Standard Time") map through a small table, then fall back to the file's own VTIMEZONE. CLASS:PRIVATE/CONFIDENTIAL events show as "Busy" with no location.
- Every redirect hop is checked with `assertFetchableUrl`, not only the final URL.
- **Cost:** each feed's server-only secret doc keeps an `id → hash` index of the rows it last wrote, plus the body hash and a sync key (window, zone, owner). An unchanged feed costs one secret read and **no `wallEvents` reads**, even when the server sends no ETag. Bills keep their index on `calendarFeedSecrets/_bills`. The scheduled run re-projects bills only when the window or zone moved; `projectwallbills` handles every bill edit.
- The schedule syncs only households with an **active** display (collection-group query on `displays.status`; field override in `firestore.indexes.json`). Adding a feed syncs it at once either way.
- The holidays feed is created and removed by the sync itself to match `holidaysEnabled`, not at pairing time. `onwallsettingswritten` re-syncs when `showBills`, `holidaysEnabled` or `timeZone` change.
- Window: first day of the previous month through the **end** of the month three months out, so Month view always has whole months.
- Timed events get one row on their start date, even when they run past midnight.

**`geminiproxy` changes** (geminiProxy.ts):
- In `enforceAiQuota`, accept `request.auth.token.display === true && token.hid === householdId`, provided `displays/{token.did}.status == 'active'` (read inside the same transaction). Skip the `memberUids` check only in that case.
- Add a `contents` size guard: reject if the base64 inline audio is over 2 MB (about 60 s of AAC).
- Voice calls share the household's daily AI quota. That's intended, and Settings → Wall display shows "Voice uses your daily AI allowance".

### 4.6 `firestore.rules`

New helper:

```
function isDisplayOf(hid) {
  return request.auth != null
    && request.auth.token.get('display', false) == true
    && request.auth.token.get('hid', '') == hid
    && get(/databases/$(database)/documents/households/$(hid)/displays/$(request.auth.token.did)).data.status == 'active';
}
```

**Grant the display only these paths** (all other access stays member-only):

| Path | Display access |
|---|---|
| `households/{hid}` | `get` only |
| `members/{id}` | `read`; plus **update** limited to the Case 4 points body (`affectedKeys().hasOnly(['points','lastDailyPointsReset','lastWeeklyPointsReset'])` + `isValidPointsMap`) as its **own branch outside** the `isMemberOf &&` wrapper |
| `shoppingList/{id}` | read, create, update, delete (same validators as members) |
| `groceryCatalog/{id}` | read, create, update (same validators) |
| `todos/{id}` | read, create, update, delete (same `hasOnly` list) |
| `habits/{id}` | read; update limited to `affectedKeys().hasOnly(['count','totalCount','completedDates','completedBy','lastUpdated','streakDays'])`. Needed only because `completeToDo` fires a to-do's `linkedHabitId`. |
| household doc points | update limited to `affectedKeys().hasOnly(['points'])` (linked-habit credit with no assignee) |
| `activityLog/{id}` | create only, and only with `actorUid == request.auth.uid` |
| `meals`, `mealPlan` | read (give `mealPlan` an explicit block; it currently falls to the catch-all) |
| `wallEvents`, `wallSettings`, `calendarFeeds` | read |
| `displays/{did}` | read own doc; update own doc limited to `['lastSeenAt','appVersion','layout']` |

**Load-bearing rules hygiene:**
- Add `displays`, `wallEvents`, `wallSettings`, `calendarFeeds`, `calendarFeedSecrets`, `mealPlan` (and `stores` if it ever becomes a collection) to the **catch-all exclusion list** (L1253–1282). Firestore grants if *any* rule allows, so the exclusion is what keeps members from forging `displays` or reading `calendarFeedSecrets`.
- **Do not** add `isDisplayOf` to the catch-all read; that would expose `notificationLog` and anything added later.
- Members get read on `displays`, `wallEvents`, `wallSettings`, `calendarFeeds`, and write on `wallSettings`. `displays` and feed writes are server-only.
- Add `wallPairings` as a top-level `allow read, write: if false`.

**Rules tests** go in `tests/rules/firestore.rules.test.ts`. Add a context like `testEnv.authenticatedContext('display_d1', {display:true, hid:'H1', did:'d1'})` and seed `displays/d1`. The allow/deny matrix must cover:
- Every path in the table above: allowed.
- **Denied:**
  - transactions, accounts, buckets, calendarItems, notificationLog, apiKeys, recaps, `calendarFeedSecrets`;
  - another household's data;
  - member profile fields (anything outside the points allowlist);
  - creating a members doc;
  - writing `displays/{other}`;
  - a revoked display;
  - a token whose `hid` doesn't match.

### 4.7 Hosting and PWA

- **`firebase.json`:**
  - ~~Change `Permissions-Policy` from `microphone=()` to `microphone=(self)`.~~ Done in Phase 0 (the lab needs the mic).
  - Add `https://api.open-meteo.com` and `https://geocoding-api.open-meteo.com` to the (report-only) CSP `connect-src`.
  - Add `https://*.cloudfunctions.net` and `https://*.run.app` if they're missing, since callables use them.
- **Service-worker update prompt** (`index.html:105–146`): the `confirm()` at L129 must not run on a wall.
  - **As built:** `public/sw.js` calls `skipWaiting()` on install, so a new version activates and the existing `controllerchange` listener reloads every device within seconds of a deploy. A wall therefore just skips the `confirm()` (it would freeze an unattended screen) and reloads like any other device. The 3 am reload below remains the backstop.
  - The registration script checks `localStorage.LB_WALL_DEVICE === '1'`. On a wall it stores the waiting worker on `window.__lbSwUpdate` instead of prompting.
  - `WallApp`'s maintenance timer posts `'skipWaiting'` (the plain string `public/sw.js:446` listens for) during the night window. The existing `controllerchange` listener then reloads.
- **Manifest:** `orientation` stays `portrait` for phones. iPadOS 16 standalone apps don't enforce it, and the wall is physically mounted. No manifest change is needed.

### 4.8 Wall runtime (`utils/wall/`)

Each piece below is a pure module with unit tests (in `utils/wall/`, so they
run in the node test project), wired in through one `useWallRuntime()` hook.
`wallIdle.ts` and `wallNight.ts` already exist from Phase 0:

- **Idle and rotation** (`wallIdle.ts`):
  - Any `pointerdown`, `keydown` or voice start resets the 3-min timer and pauses rotation.
  - On timeout: navigate to `/wall` (Week), close menus and sheets, scroll every module back to the top, resume rotation.
  - Rotation advances the bottom module (or the only module) through `settings.defaultModules` ∪ the modules not currently shown.
- **Night** (`wallNight.ts`): `isNight(now, night, timeZone)` handles windows that cross midnight. In the night window:
  - show `WallNight`;
  - a tap wakes the wall for 60 s;
  - rotation is paused.
- **Maintenance** (`wallMaintenance.ts`), once per night at 03:00:
  1. If an SW update is waiting, apply it.
  2. Otherwise, `waitForPendingWrites(db)` with a 30 s cap, then `location.reload()`.
  3. If writes are still pending, skip and retry at 03:30.
- **Connectivity** (`wallConnectivity.ts`):
  - A heartbeat updates `displays/{did}.lastSeenAt` every 5 min, which is also what the phone's "last seen" reads.
  - The wall counts as offline when `navigator.onLine === false` **or** the heartbeat write has been pending for more than 60 s (`snapshot.metadata.hasPendingWrites`).
  - Under 15 min offline: the rail mark. 15 min or more: the strip.
  - Firestore listeners reconnect on their own. On `visibilitychange` back to visible after more than 5 min hidden, and on `pageshow` with `persisted`, force a re-render, refetch the weather and call `auth.currentUser?.getIdToken(true)`.
- **Weather** (`wallWeather.ts`):
  - Open-Meteo `forecast?latitude&longitude&current=temperature_2m,weather_code&hourly=temperature_2m,precipitation_probability,weather_code&daily=…&timezone=auto`, fetched every 30 min.
  - The three time-of-day blocks are the next three of Morning (6–12), Afternoon (12–17), Evening (17–21) and Overnight (21–6). Each shows the median temperature and the dominant weather code.
  - The rain note shows when a precipitation probability of 50% or more falls within the next 12 h, as "Rain likely 6–8 pm".
  - On a failed fetch, keep showing the last good data. Hide the weather after 6 h stale.
- **Theme:** ~~apply through the `ThemeContext` setters~~ **As built:** the wall root takes `dark` / `large` classes from `wallSettings`, and `components/wall/wall.css` defines both palettes. That keeps a member previewing `#/wall` on their own phone from having their app theme changed, and the wall doesn't depend on the app's `html.dark`.

### 4.9 Components (`components/wall/`)

Everything here is lazy-loaded from the `/wall` route only, so none of it
enters the phone boot bundle:

- **Shell:** `WallApp`, `WallRail`, `WallTopBar` (built on `WallHero`, the shared hero + two-sub-rows unit), `WallStatus`, `WallToast`, `WallGearMenu`, `WallPinPad`, `WallNight`, `WallPairing`.
- **Calendar:**
  - `WallWeek`: `WallToday` plus `WallPanel` (`WallModule`, `WallModuleMenu`).
  - `modules/ComingUpModule`, `ShoppingModule`, `TodosModule`, `MealsModule`.
  - `WallMonth`, `WallDay`.
- **Lists:** `WallShopping`, `WallTodos`, `WallMeals` with `WallRecipePanel`; `WallAddSheet`; `WallSwipeRow`, a pointer-events swipe that reveals Delete with `touch-action: pan-y`.
- **Voice:** `WallVoiceBanner`, `useWallVoice`.
- **Weather:** `WallForecastSheet`.

**As built (Phase 4):** the calendar screens live in `components/wall/calendar/` (`WallWeek`, `WallToday`, `WallModuleMenu`, `WallDay`, `WallMonth`, and `modules/{ComingUp,Shopping,Todos,Meals}Module`). The selectors are in `utils/wall/wallCalendar.ts` (`todayTimeline`, `dueTodayChecklist`, `groupComingUp`, `layoutDayBlocks`, `monthCells`), `utils/wall/wallModules.ts` (`switchModule`/`addModule`/`removeModule`, `suppressDuplicates`, `nextRotation`), `utils/wall/wallLists.ts` and `utils/wall/wallPeople.ts`. Notes:
- Rotation never writes: a rotation step is local state keyed to the saved layout, so a phone change or a manual Switch replaces it. The gear's "Start/Stop rotating" overrides `settings.rotation.enabled` for this wall until reload.
- The two-module split is a flex column: the top module takes its content height up to 60%, the bottom takes the rest.
- Toasts go through one slot (`components/wall/wallToast.ts`): `run(write, text, undo)` shows the toast immediately (a queued offline write resolves late) and swaps in an error if the write fails.
- Month shows the current month only (no paging); Day pages with arrows.

**As built (Phase 5):** the list screens live in `components/wall/lists/` (`WallShopping`, `WallTodos`, `WallMeals` + `WallRecipePanel`, `WallAddSheet`, `WallSwipeRow`). Every list write goes through `useWallListActions`, which calls `WallData.actions` (the app's mutation factories) and attaches an Undo. Notes:
- **Undo:** check-off and complete are undone by the inverse action. A delete, or "Clear (n)", is undone by re-adding the same fields (as a new doc). An add is undone by deleting the items that appeared since, with the added names. A new doc's id isn't known until the server acknowledges it, but the local listener shows the pending write at once, offline included.
- **Attribution:** the to-do factories take a `MutationActor` (`Pick<User, 'uid' | 'displayName'>`, a type-only narrowing). A display passes `{ uid, displayName: display.name }`, so its writes read "Kitchen iPad completed …".
- **Phone chrome:** `App.tsx` no longer mounts the phone `Toaster`/`OfflineBanner` on `#/wall`. The shared factories toast on the phone's behalf, and the wall has its own toast slot and offline mark. Because of that, the factories that swallow their own errors (shopping add/delete) can't show the wall's error toast.
- **Data:** `WallData` gained `stores`, which comes from the household doc and sets the store order. Test Mode seeds a meal week through `wallFixtures`, and the mock household's shopping check-off/clear now work in memory.
- **Add sheet:** the mic button inside the field arrives with voice (Phase 6).

**As built (Phase 6):** voice lives in `components/wall/voice/` (`voiceEngines.ts`, `useWallVoice.ts`, `WallVoiceBanner.tsx`), with the pure parts in `utils/wall/wallVoice.ts`. Notes:
- **Engine:** Phase 0 hasn't been run on the device yet, so both engines ship. `wallSettings.voice` picks one: `auto` (the default) uses on-device speech recognition and switches to recorded audio for the rest of the launch the first time speech is refused; `speech` and `audio` force one; `off` hides the mic. Settings → Wall display → Voice offers On/Off and "How it listens" (Auto / iPad / Recording). Apply the Phase 0 verdict there, with no code change.
- **Grammar first:** `parseLocalCommand` handles show/open (week, day, month, shopping, lists, to-dos, meals), start/stop rotating, undo and cancel with no AI call. On the audio engine the transcript only comes back from Gemini, and the grammar still runs on it, so "show meals" is never treated as an add.
- **Writes:** a parsed add goes through `useWallListActions` with a toaster that feeds the voice banner instead of the toast, so voice adds use the same factories and Undo as taps. Items are tagged `source: 'voice'`. A spoken name matches a member's full name, or a first name only when it's unique; otherwise the to-do goes to Family. "Undo" by voice reverses the last voice add.
- **Banner:** it shares the toast's slot, and either one replaces the other. Results and errors clear after 10 s. Idle return cancels listening. Errors have their own wording for no speech, a blocked mic, offline, a used-up AI allowance and an unknown command.
- **geminiproxy:** it now accepts a display token for its own household while `displays/{did}.status` is `active` (read inside the quota transaction), and spends the household's normal daily quota.
- **The Phase 0 lab stays** until the device results are recorded, because it's the tool that produces them. It now imports the speech types from `voiceEngines.ts`. Delete `#/wall-lab` when `wall-display-phase0-results.md` is filled in.

**Pure selectors** go in `utils/wall/` and are unit-tested in the node project:
- `groupComingUp(events, today, days=14)`
- `todayTimeline(events, now)`: the past flag and where the now-line goes
- `dueTodayTodos(todos, today)`
- `layoutDayBlocks(events)`: overlap columns
- `monthCells(month, events)`
- `formatWallTime(date)`: the am/pm rule
- `suppressDuplicates(modules)`
- `nextRotation(layout, modules)`

**Design tokens:**
- Add a "Wall display" section to `DESIGN.md`, an explicit exception to "mobile-only", with the type scale: 72 hero, 40 section, 29 Today title, 25 list item, 22 body, 17 meta, 15 micro.
- Minimum touch target is 56px (rows), and 76px for the mic.
- Add the **dark-mode member colors** (`#86b89c`, `#d6a55e`, `#8eaed6`, `#d29aa5`, family `#a8a399`) as `memberColorFor(..., {scheme:'dark'})` in `utils/memberColors.ts`. Don't hard-code them in components.
- Wall-only CSS lives in `components/wall/wall.css`, imported by `WallApp`, using `@theme` tokens. No raw hex in components.

### 4.10 Voice pipeline

```
tap mic ─► WallVoiceBanner(listening)
  Engine A (if Phase 0 passes): webkitSpeechRecognition, interimResults → live text, ends on silence
  Engine B (default fallback):   getUserMedia({audio}) ─► MediaRecorder(audio/mp4) ─► decode + 16 kHz WAV (utils/wall/wavEncode.ts)
                                 VAD: AudioContext analyser, stop after 1.5 s below threshold or 8 s max
─► transcript / audio
─► parseWallCommand():
     1. local keyword grammar (no AI): show|open {calendar|week|day|month|shopping|list|lists|to-dos|meals};
        start|stop rotating; undo; cancel
     2. otherwise geminiproxy with responseSchema (JSON):
        { intent: 'add_shopping'|'add_todo'|'unknown',
          items?: [{name, quantity?}], todo?: {text, assigneeName?, due?: 'today'|'tomorrow'|'yyyy-MM-dd'} }
        prompt includes member names, grocery-catalog names (top 200), today's date and timezone.
        Engine B sends the audio as inlineData and asks for {transcript, …intent} in one call.
─► resolve: assignee name → uid (case-insensitive, nicknames off); item → catalog match for category/store
─► execute through WallData.actions; record inverse ops for Undo
─► WallVoiceBanner(result | error)
```

The mic stream from the first grant is kept open (track disabled between
uses), so iPadOS doesn't prompt again during the same app launch. Phase 0
verifies that this works and that it doesn't keep the orange mic indicator lit.
If the indicator stays lit, the stream is released after each command and one
prompt per launch is accepted.

## 5. Phone Settings: Settings → Wall display

New `components/settings/WallDisplaySettings.tsx`, matching the prototype's "Phone settings" screen. **As built (Phases 1–3):** Displays; Calendars (Phase 3, `WallCalendarSettings.tsx`: feeds with owner chip and health line, add/edit/remove for admins, the holidays and bills toggles, and Sync now for everyone); Night & look (night hours, theme, text size, weather location) and "Back to calendar after". Week layout (starting modules, rotation and its interval, back to calendar after) shipped with Phase 4. Voice shipped with Phase 6 (On/Off, "How it listens", and the allowance line):

1. **Displays** (admin):
   - A list with name, status, last seen (red after 30 min) and **Revoke**.
   - **Add a wall display**: name field, then a 6-digit code with a 10-min countdown.
   - A link to the setup runbook.
2. **Calendars** (admin to edit; everyone can view):
   - Each feed shows its label, owner chip (in the member's color), last sync, and a red "Hasn't updated since … · re-paste the link" when `stale`.
   - **Add a calendar link**: paste URL, label, owner. Validation errors show inline.
   - Toggles: US holidays, Bills on calendar (names only).
3. **Week layout:** starting modules (top, bottom); rotate the bottom module (toggle and interval); back to calendar after (1 / 3 / 5 / 10 min).
4. **Night & look:** night hours, theme (Light / Dark), text size (Normal / Large), weather location (search box with Open-Meteo geocoding).
5. **Voice:** one line, "Voice uses your daily AI allowance (n left today)".

## 6. Phase 0: device spike (do this first)

**Purpose:** settle the voice engine and prove the device assumptions before
building the rest. It runs on a **Firebase Hosting preview channel**:

```
firebase hosting:channel:deploy wall-lab --expires 14d
```

Then add that preview URL to the Firebase Auth **authorized domains** list.
Callables run in production, since preview channels share the project.

**Build** a throwaway `#/wall-lab` route, behind `import.meta.env.VITE_WALL_LAB`. It's signed in as a normal member, so no pairing is needed yet. It has:
1. **Mic A:** `webkitSpeechRecognition`, showing the transcript and timings.
2. **Mic B:** MediaRecorder, then `geminiproxy` with inline audio, showing the transcript, intent JSON and timings. This needs the geminiproxy audio-size change from §4.5, deployed first.
3. A 1366×1024 static render of the Week screen from the prototype, to check fonts, colors, `color-mix` and sticky headers on Safari 16.
4. An idle/night timer demo.

**Test protocol** (on the real iPad, iPadOS 16.7.x):

| # | Check | Pass criteria |
|---|---|---|
| 1 | App loads in Safari and in standalone | No blank screen, no console errors (via Mac Safari → Develop → iPad) |
| 2 | Mic A in **standalone**, 3 cold launches + 1 after overnight | 9/10 commands correct from 3 m, median ≤ 3 s, works on every launch |
| 3 | Mic B in standalone, same | 9/10 correct, median ≤ 5 s end-to-end |
| 4 | Mic permission behavior | ≤ 1 prompt per app launch; Guided Access doesn't block the prompt |
| 5 | Shortcuts brightness automations **under Guided Access** | Brightness changes at the scheduled times without unlocking |
| 6 | 72-hour soak on the lab page with Auto-Lock Never | Still responsive, memory stable (Web Inspector), no reload loops |

**Decision rule:**
- **Engine A** if checks 2 and 4 pass. B is then the automatic fallback when A throws `not-allowed` or `service-not-allowed`.
- **Engine B** if only 3 and 4 pass.
- **If neither passes**, ship v1 with tap-to-talk disabled and document iPadOS **Voice Control** for hands-free navigation. That reopens the "voice is must-have" decision with the owner.
- If 5 fails, the night screen still ships and the runbook says to set a low fixed brightness.

Record the results in `docs/plans/wall-display-phase0-results.md`. Delete the lab route when Phase 6 lands.

## 7. Phases (each phase = one PR, CI green, owner review)

| Phase | Contents | Done when |
|---|---|---|
| **0 Spike** | §6 | Results doc committed, engine chosen |
| **1 Identity** (shipped with 2) | Pairing/revoke functions, `isDisplayOf` rules + full allow/deny tests, AuthContext `isDisplay`, `/wall/pair` screen, login link, `LB_WALL_DEVICE` flag, Settings → Displays section, IAM runbook | Pair a real iPad from a phone; revoke kicks it to `/wall/pair` within one request; `pnpm test:rules` covers the matrix |
| **2 Shell + data** | `HouseholdOrWallProvider`, `WallFirestoreProvider` + `WallSlicesProvider`, rail, top bar (time + weather), status/offline, toast/undo, idle, night, maintenance, SW update handling, Permissions-Policy/CSP, theme/text size from settings, `wallSettings` doc + Settings sections 3–4 | Wall boots signed in as display; no permission-denied errors in console; survives airplane-mode on/off and an overnight cycle; e2e smoke in Test Mode |
| **3 Calendar backend** | Feed callables, `syncwallcalendars`, `syncwallcalendarsnow`, `projectwallbills`, holidays, stale push, `ical.js`, Settings → Calendars | Google secret iCal, iCloud public link and a school ICS all sync with correct times across a DST change (unit fixtures); paid bill disappears from `wallEvents` within 10 s |
| **4 Calendar UI** | Week (Today + panel + Coming up), Month, Day, modules framework (switch/add/remove/fit split/duplicate suppression), rotation | Matches prototype at Normal and Large, Light and Dark; 14-day scroll performant on device (no jank on 300 events) |
| **5 Lists + meals UI** | Shopping, To-dos, Meals + recipe panel, add sheet, swipe delete, list modules | Every action writes via existing factories; undo restores exactly; kid points credited and reversed |
| **6 Voice** | Chosen engine, grammar + Gemini intents, banner, undo, geminiproxy display auth | 20 scripted commands pass on device; quota decrement visible |
| **7 Hardening** | Device QA checklist (§9) on the real iPad, 72 h soak, docs: DESIGN.md wall section, CLAUDE.md entry, DECISIONS.md (why display ≠ member, why ICS only), `WALL_DISPLAY_RUNBOOK.md` | Checklist all green |

**As built (Phase 7):** the code-side hardening is done: the docs are written (DESIGN.md §12, the CLAUDE.md Wall section, DECISIONS.md "Wall display", and the runbook's voice section). Phase 7 is complete only when the §9 checklist and the 72-hour soak have passed on the real iPad. Only the owner can run those.

## 8. Testing

- **Unit (node project):**
  - `utils/wall/*` selectors and runtime modules: night windows across midnight, idle and rotation sequences, the am/pm rule, overlap layout, duplicate suppression.
  - Functions: ICS parsing with fixtures (RRULE + EXDATE + RECURRENCE-ID, a VTIMEZONE feed, an all-day multi-day event, a DST weekend), the bills projection (template/instance/paid), pairing (expiry, attempts, lockout), and the geminiproxy display-auth branch.
  - `parseWallCommand` grammar table.
- **Rules:** the §4.6 matrix.
- **Component (jsdom):** each `components/wall/*` with a `WallSlicesProvider` test harness. Cover the module menu, duplicate suppression, swipe-to-delete, the undo toast and the PIN pad.
- **e2e (Playwright, Test Mode):** a new `e2e/wall.spec.ts` at a 1366×1024 viewport. It runs: boot, check a shopping item, undo, add via sheet, switch module, open Day from Month, idle return (use the clock API to fast-forward).
- **Seed data:** add wall fixtures to `MockHouseholdContext` (meal plan, wall events, wall settings). Today it has no meals or calendar events.
- **Real device:** Playwright's WebKit is newer than Safari 16, so only the iPad counts for compatibility. Use §9 every phase from 2 on.

## 9. Device QA checklist (Safari 16.7, standalone, Guided Access on)

**Setup**
- [ ] iPadOS shows 16.7.x in Settings → General → About.
- [ ] Opened from the Home Screen icon; paired; shows the Week view.
- [ ] Auto-Lock Never; Guided Access on with Display Auto-Lock Never; Auto-Brightness off (Accessibility → Display & Text Size).

**Screens**
- [ ] Every screen matches the prototype at Normal and Large, Light and Dark. No text wraps in the top bar.

**Writes**
- [ ] Check off, add, delete and undo work for shopping and to-dos.
- [ ] Each of those shows on a phone within 2 s.
- [ ] A kid's to-do credits points.

**Connectivity and timers**
- [ ] Airplane mode: the rail mark shows. At 15 min, the strip shows. Writes queue and then sync.
- [ ] Idle 3 min returns to Week and resets scroll.
- [ ] Rotation pauses on touch.
- [ ] Night screen at 10 pm; a tap wakes it for 60 s; brightness automation fires.
- [ ] 3 am reload happens; a deployed update is applied overnight with no prompt.

**Voice and access control**
- [ ] Voice: 20 scripted commands; the undo of a voice add works.
- [ ] Revoke on the phone returns the wall to the pairing screen.
- [ ] Gear: a wrong PIN is rejected; Unpair works.

**Soak**
- [ ] 72 h soak: no crash, no memory growth over 30%.

## 10. Risks and open items

| Risk | Mitigation |
|---|---|
| Speech recognition broken in standalone on iPadOS 16 | Phase 0 decides; Engine B fallback; Voice Control as last resort |
| Shortcuts automations blocked by Guided Access | Verified in Phase 0; fallback fixed low brightness |
| `createCustomToken` IAM missing → pairing fails in prod | Runbook step + function returns a clear `failed-precondition` message |
| ICS feeds lag (Google secret address can be minutes stale) | Server fetches directly every 15 min + "sync now" |
| Old battery under constant charge | Monthly inspection; optional smart-plug cycle |
| AI quota consumed by voice | Shared household cap; local grammar handles navigation with zero AI calls |
| Display tokens are long-lived | Revocation is immediate via `displays.status` in rules; tokens are uid-scoped and never admin |
| A member forges `activityLog` actors today (no actor check) | Out of scope to fix for members; display path requires `actorUid == auth.uid` |

## 11. Files touched (summary)

- **Changed:**
  - `contexts/AuthContext.tsx`, `contexts/MockAuthContext.tsx`
  - `App.tsx`, `components/auth/ProtectedRoute.tsx`, `pages/LoginPage` (link)
  - `contexts/household/mutations/todoMutations.ts` (type narrowing only)
  - `contexts/MockHouseholdContext.tsx` (fixtures)
  - `types/schema.ts`, `utils/firestoreConverters.ts`, `utils/memberColors.ts`
  - `firestore.rules`, `tests/rules/firestore.rules.test.ts`
  - `firebase.json`, `index.html`
  - `functions/src/index.ts`, `functions/src/geminiProxy.ts`, `functions/src/shared/notifications.ts`, `functions/package.json` (`ical.js`)
  - `pages/SettingsPage` (new section)
  - `DESIGN.md`, `CLAUDE.md`, `docs/DECISIONS.md`
- **New:**
  - `components/wall/**`, `utils/wall/**`
  - `components/settings/WallDisplaySettings.tsx`
  - `functions/src/wall/**`
  - `docs/WALL_DISPLAY_RUNBOOK.md`, `docs/plans/wall-display-phase0-results.md`
  - `e2e/wall.spec.ts`
