# Decisions & standing traps

**Not a task archive.** An entry earns a place here only if someone could plausibly undo it by
accident — a deliberate behavior that reads like a bug, a question already argued to a conclusion, or
a trap that outlived the work that found it. Finished tasks are deleted from `TODO.md` with no record
here; their PR is the record.

This file is **not** auto-loaded into agent context. Link to it from a code comment or a test name
when the trap is code-adjacent, so it is read at the moment it would be broken.

---

## Member-doc writes: `affectedKeys()`, never `changedKeys()` — and test as a non-admin

**Decided 2026-07-26 (#1106).**

`firestore.rules`' member self-update gate is an allowlist. **Every new `HouseholdMember` field must
be added to it**, or writes fail — and two properties conspire to hide that:

- **`changedKeys()` excludes newly-*added* keys** (they land in `addedKeys()`). A member's *first*
  write to a new field passes vacuously; every write after it is denied. This shipped to production
  twice — once as broken dashboard widgets, once as a live **privilege-escalation path** where any
  member could add `points` / `allowanceCents` / `isManaged` to their own doc. Case 1 and the
  managed-kid Case 3 now use `affectedKeys()` (added ∪ changed ∪ removed).
- **`isAdminOf()` is a blanket bypass**, so the whole class is invisible from an admin account.

**When adding a member field:** add it to the allowlist, and test as a **non-admin** with an
**add-then-change** pair — a change-only test passes against the broken rule.

The same applies to allowlisted *subcollection* docs: `/todos`' `hasOnly` sees the **merged** doc,
which is how `needsReview` silently denied every approve.

---

## Bill ↔ transaction matching: the amount tolerance guards GUESSES only

**Decided 2026-07-27 (2H); revised 2026-10-05 by the owner.** Tests in both matcher copies pin this.

The ±10% / ±$25 amount guard applies only to the **token** tier (a bill title sharing a word with the
bank text), which is a guess. The **rule** tier (a merchant rule's `billId`) and the **alias** tier (a
bank descriptor previously linked to that exact bill) are explicit links, so they bypass it: a
variable bill (`Cpenergy Mngco` at $37.91 against a $142.00 scheduled Centerpoint bill) settles at
what it actually cost.

The original 2H decision gated the alias tier too, preferring a visible duplicate over a wrong bill
marked paid. The owner reversed that: the risk is bounded because an alias is an exact, full-text
match that a person created (and can retract with `forgetBillDescriptorAlias`), and an alias naming
two unpaid bills still matches neither. What the guard used to protect against — a price the user
didn't expect — is now surfaced instead of blocking: the sync stamps `Transaction.billPriceChange`
and the Dashboard's `BillPriceChangeCard` asks the household to acknowledge it (and offers the
buckets when it cost more). Don't re-gate the alias tier to "fix" a surprising settle; retract the
alias.

---

## Nightly sync: a CONFIRMED row also settles the bill it pays

**Decided 2026-10-05.** `decideWithdrawal` still checks CONFIRM (an existing captured row) before PAY,
because "is this the same purchase?" must be answered first. But a confirm no longer ends the line:
the confirmed row is run through the same `pickBillToPay` (bank descriptor first, then the row's stored
merchant, which is what the Action Queue matched on). A unique match marks the bill paid, stamps
`paidCalendarItemId`, and files an unfiled row as `Budgeted in Calendar`; a row the household already
filed into a bucket keeps its category. No match or an ambiguous one leaves the bill due — the same
"doubt stays in the queue" rule as everywhere else, and the amount tolerance above is unchanged.

Before this, a bill whose charge had already been captured (screenshot import, bank alert) was
confirmed overnight and the bill sat in the queue forever: the next night's email skips the line by
`bankRef`, so nothing ever revisited it.

---

## Apple Pay / Shortcut captures auto-approve only when already learned

**Decided 2026-10-05 by the owner.** `quickAddExpense` approves a capture on arrival — `verified`,
filed, account balance moved in the same batch, exactly like a swipe-approve — only when BOTH are
known (`functions/src/quickAdd/autoApprove.ts`): the category comes from a merchant rule or from the
last 5 categorised verified rows for the exact merchant text all agreeing (and it must be a current
bucket); the account is the one the capture resolved (card last-4) or the one those rows agree on.
Anything else — a new merchant, disagreeing history, a $0 stub, a possible duplicate — stays
`pending_review` for the Action Queue.

Auto-approved rows carry `autoApproved: true` and stay in the reconcile pool, so the bank notification
that follows an Apple Pay capture still folds into it instead of becoming a second row. Those merges
never change amount or account (an auto-approved row always has one), so they need no balance
bookkeeping. Don't narrow the reconcile pool back to `pending_review` only.

---

## Settled bills: undo is one-directional by design

**Decided 2026-07-27 (2H).**

Once a transaction settles a bill, `utils/settledBillGuard.ts` makes `deleteTransaction`,
`mergeTransactions`, `splitTransaction`, `updateTransaction` (money fields) and
`reverseTransactionApproval` all **refuse**, pointing the user at the calendar. Deleting the paid
calendar doc releases the guard (the guard keys on the bill still being paid), so a row can never be
trapped.

The guard refuses by **toasting and returning normally**, deliberately — throwing would bury the
specific refusal under a generic "Failed to update" toast. The cost is a real open bug: batch
operations `Promise.allSettled` over the selection and see a *fulfilled* promise for a refused row.
That is tracked in `TODO.md` §2C, not a reason to make the guard throw.

Two more deliberate omissions on that path: **no habit firing**, **no price-change nudge**, and **no
`MerchantRule` upsert** (the alias write is kept instead).

---

## `points.total` drift: do NOT repair

**Decided 2026-07-31. PR #1168 closed with the full reasoning.**

A pre-#1163 bug paid the pool both awards but wrote only the triggering member's, for weekly threshold
habits completed by two members on different days. `points.total` is a lifetime counter that
`computeMemberPointsReset` omits and `computeHouseholdPointsSync` only ever **raises**, so banked
drift is permanent and will not self-heal.

Not repairing, because **nothing reads an adult's `points.total`** — every adult surface (standings,
podium, crown, scoreboard, recap) reads `points.weekly` / `points.daily`, and the only gating reads
are kid-only with Kid Mode dormant. Magnitude is tens of points over a ~1.5-day window; the bug is
frozen.

A hardened repair tool is **archived, not on a branch** — recover with
`git bundle unbundle ../LifeBalance-branches-2026-08-01.bundle` (`fix/points-drift-repair` = hardened
tool at `510d68c7`; `wip/points-drift-repair` = unverified draft). It writes **upward only**; its Scan
path is read-only, so a number can be obtained at zero risk if ever wanted.

There is **no live successor.** `PointsBreakdownModal`'s threshold past-date edit carried the same
inflation but was unreachable since PR #819 and has since been deleted as dead code (#1172).

---

## Household-undo trade-offs accepted in review (#1166 / #1169)

**Decided 2026-07-30.** Recorded so they are not re-filed as bugs.

- **The tie-break on a date carrying BOTH an automation doc and a manual `creditsHousehold` doc was
  DECLINED.** Newest-`createdAt` sort may delete the automation doc, destroying its
  `sourceTransactionId` audit record — after which `firedHabitIds` (`arrayUnion`, cleared only by
  un-verifying) prevents that habit ever re-firing from the transaction. Preferring `creditsHousehold`
  docs was rejected because it is **not points-neutral**: the two doc classes reverse the pool by
  different arithmetic (`periodPointsMove` decomposition vs. stored `pointsEarned` via `legacyDelta`),
  so it changes the pool delta in an unprobed case.
- **A narrow accepted orphan:** a grandfathered doc on a date that has *since* gained attribution is no
  longer swept and falls back to the attribution-only primitive. Deliberate — sweeping it would destroy
  real attribution. Resolves once the `deleteHabitSubmission` creditee bug (`TODO.md` §3B) is fixed.
- **Stale-deselect of a below-target incremental prior period reverses nothing** by design
  (`processStaleDownToggle` contract). Pool and member stay mutually consistent; only orphan
  attribution residue remains. Revisit only if "undo the previous period" should mean more than
  completion-date reversal for incremental habits.

---

## Recap chart stays positive-only; every fix is on the labelling side

**Decided 2026-07-30.** `buildRecapChart` filters segments to `> 0`, so a week whose household share
is net negative draws no Household bar. That is the product decision — the chart does not represent
negative days.

The labelling carries the honesty instead, and each branch's stated reason is scoped to what it can
actually prove: the household card's line gates on whether the chart **draws** a Household bar (segment
existence and column height are independent figures), the wording keys off the figure's **sign** so a
loss is never phrased as something "earned", the loss branch names the omitted **segment**, and the
positive/no-bar branch names only the days the share was **gained** on — a day carrying a negative
contribution is clamped out however tall its column is.

`householdSharePoints` is rounded to 2dp defensively: every writer-emitted value is integer-floored, so
the rounding only insures against `weeklyRecapConverter`'s untyped cast letting a float-epsilon sum
render as `5.55e-17` and slip past the card's `!== 0` gate.

---

## `ShoppingItem.quantity` is normalized at the converter — and `functions/` is not covered

**Decided 2026-07-26 (#1107).**

Both `string` and legacy `number` shapes exist in Firestore. A numeric value crashed four separate
consumers (`parseQuantity`, `printWeekHtml`'s `escapeHtml`, `geminiService`'s `sanitizeForPrompt`, the
voice-capture path). Root-caused at the boundary rather than patched per call site:
`shoppingItemConverter.fromFirestore` normalizes to a string on read.

**`functions/` intentionally keeps its own `string | number` handling** — the Admin SDK bypasses client
Firestore converters entirely, so the normalization does not apply there. Do not "simplify" it away.

---

## Re-verified as non-issues — do not re-file

- **SEC-04 quickAdd rate-limiter "fails open"** — stale finding. `checkRateLimit()` already fails
  **closed** on error, with a test covering it.
- **`safeToSpendCalculator.ts` `getTime()`-equality branch is dead code** — stale. It is reachable and
  load-bearing (includes a bill dated exactly on the next paycheck; covered by the "bills on boundary
  dates" test).
- **`ShoppingListTab` mirrored-state-in-effect should be a derived `useMemo`** — won't-fix. The
  mirrored state is load-bearing for `Reorder.Group` drag gestures (local mutation gated by
  `isDraggingRef` before committing via `reorderShoppingItems`); deriving it breaks mid-drag reordering.
- **Sticky save footers** — `TransactionMasterList`'s mobile filter sheet (filters apply live, no commit
  action) and `HabitSubmissionLogModal`'s inline add form (already at the top of its tab) are
  deliberately excluded from the drawer-footer convention.
- **`components/meals/MealPlanTab.test.tsx`'s "extends the day strip window…" test** is a pre-existing,
  load-sensitive flake. Not a regression from any recent work; don't chase it as one.

---

## A streak period must be COMPLETED, not merely touched — and the badge shows YOUR multiplier

**Decided 2026-08-09 (owner call, from a live report).** Three tests pin the first half, four the
second; a fifth pins the harness fix below.

Symptom: "Exercise for 30 minutes" (weekly, `targetCount: 3`, `basePoints: 3`) showed **3 pts** on
the row and credited **+6** on the scoreboard, with no streak indicator anywhere to explain the gap.
Nothing was corrupted — the stored household/member points matched the scorers exactly. Three
independent defects stacked:

1. **Per-member streaks counted partial periods.** `memberCompletionDates` returns every date the
   member holds a unit on — the right scope for *scoring* an incremental habit, the wrong one for a
   *streak*. Logging 1 of 3 weekly exercises for two weeks built a 2-week streak paying 2×, while the
   habit's own `streakDays` correctly read 0 (the habit-level walk reads `completedDates`, which only
   gains a date when the target is crossed). The two layers were answering different questions.
   `memberStreakDates` now asks the habit-level question, through the very same `periodCompleted`
   gate `memberPointsForHabitOnDate` uses to decide whether to pay the member at all.
   **Owner's rule, verbatim: "if it's a streak of 3x a week, I only exercised once this week"** — a
   week you didn't finish is not a streak week. Do not relax this back to "any activity counts".

   **The gate is the PERIOD, not the member's own units against the target.** A first attempt
   required each member to fill the target single-handedly; `transactionMutations.test.ts` caught it
   (a `targetCount: 2` habit two members finish together dropped a 7-day 3× chain to 1×). Scoring a
   period that PAID a member as one that doesn't count toward their streak is incoherent — and
   "did I personally fill the whole target" is a third question nothing else in the system asks.
   Contribute to a period that got finished and the period counts for you. Both framings give the
   reported case the same answer, because that habit's periods were never completed by anyone.

2. **The points badge read `habit.streakDays`.** Under the competition model a completion is credited
   at the acting *member's* prospective streak, so the habit's flame belongs to nobody. The badge was
   wrong in **both** directions — it promised a member riding someone else's 6-day chain 2 pts and
   paid 1, and promised 3 on a habit whose flame had lapsed while paying 6. Badge and nudge now
   derive from one figure (`prospectiveStreakForMember`), so they cannot contradict each other
   ("1 day from 2x!" beside a badge already charging 2× was reachable while they differed).

3. **Streak chip tiers used the DAILY thresholds for weekly habits.** A 2-week streak already earns
   2× but scored below `ember` and rendered no chip — which is why nothing on the row explained the
   doubled award. Same defect class as the Stats tile's inlined ladder (#1237); the ladder had been
   fixed at one site and not carried to the other.

**At `targetCount <= 1` the filter in (1) is a provable no-op**, and the fallback in (2) preserves the
habit-level path exactly — so every other habit's stored totals are untouched. This household's
weekly figure moves 93 → 90 on the next recompute, entirely from the one multi-target habit.

**Unrelated but load-bearing: `HabitCard.test.tsx` mocked `subDays` to ignore its arguments**, making
it a *constant function*. Every backward date walk in the app relies on it strictly decreasing, so
`calculateStreak` span forever the moment a fixture's frozen date equalled the mocked value — the
suite hung ~8 minutes and killed its worker instead of failing. It now fakes only the live-clock
reading the card actually makes. If you add a caller that walks dates in that suite, this is why it
works.

**Separately: the "way higher than ever" weekly total was mostly intended.** Same week, same data:
62 under the pre-#1237 ladder + legacy scorer, 76 with the competition model, 93 after #1237 made the
ladder integer-valued. Only 3 of that came from defect (1). Don't go looking for a leak.

**The recap's copies were fixed in the same breath (#1240).** `utils/recapAssembly.ts` and
`functions/src/recap/memberFacts.ts` document themselves as mirroring `habitAttribution.ts`, but
both walked raw touched dates at their two streak sites — so the ceremony would have priced Paul's
once-a-week exercise at 2x while the Habits page priced it at 1x. **`parity.test.ts` could not have
caught this**: it pins the two RECAP copies against *each other*, so a rule wrong in both stays green
forever. The guard that does catch it lives in `utils/recapAssembly.test.ts` and asserts
`memberStreakDatesFor` against the live `memberStreakDates` directly. When you change a scoring rule,
pin it against the LIVE scorer, not only across the twins.

Comparing the two needs a vantage point where every fixture period is CLOSED (the test uses a week
later): the live scorer additionally consults `Habit.count` for whichever period contains its
`today`, and the recap never does. That is a real, intended difference, not drift.

---

## Wall display: a display is not a member, and calendars are ICS only

**A paired wall signs in as `display_{did}`, never as a household member** (`functions/src/wall/pairing.ts`; plan `docs/plans/wall-display-kiosk.md` §4.1). Don't "simplify" it into a member account or a member's long-lived session.
- **Least privilege.** A member can read finance, which an unattended iPad in the kitchen must not. `firestore.rules` grants a display only the paths that call `isDisplayOf`, so adding it to the catch-all subcollection rule undoes this.
- **Immediate revoke.** Every display rule also reads `displays/{did}.status`, so Revoke takes effect on the wall's next request. A member's refresh token can't be killed per device like that.
- **Accounting.** A display isn't in `memberUids`, so it never counts toward the member cap or appears in standings. Writes are attributed to the display's name.
- **Every server path that checks membership needs an explicit display branch.** `geminiproxy` (voice) and `syncwallcalendarsnow` have one, and both re-check `status == 'active'`. A new callable the wall uses needs the same: copy `requireMemberOrDisplay` (`functions/src/wall/auth.ts`). Don't treat a display claim as membership.
- `FirebaseHouseholdProvider` must never mount for a display: it attaches finance listeners that fail for it. That's why `HouseholdOrWallProvider` exists.

**Calendars come in only as ICS/iCal links fetched by the server**, never through Google or Apple OAuth on the wall.
- One mechanism covers Google (the secret iCal address), iCloud (a public link), and school and team feeds.
- No OAuth tokens to store, refresh or scope. The wall is read-only, so write scopes would be pure risk.
- A feed URL is a credential. It lives in server-only `calendarFeedSecrets`, is never returned or logged, and is changed only through the `*wallcalendarfeed` callables.
- The cost is that a Google secret feed can lag by minutes. That's accepted; "Sync now" exists for it.
- Revisit only if two-way editing from the wall becomes a requirement.

---

## Wall voice: on-device (openWakeWord + Vosk) or Safari's recognizer with the on-device wake word; not Gemini, not Picovoice

**Safari's `webkitSpeechRecognition` does not work in a Home Screen app on iPadOS.** It exists, `start()` succeeds, and then it fires nothing: no `start`, no `result`, no `error`, no `end` (WebKit bug 225298). The wall runs as a Home Screen app, so the `speech` engine sat on "Listening" forever with Done doing nothing. It now has a start watchdog (`SPEECH_START_MS` → `unsupported`) and settles on its own after `stop()`/`abort()`. Don't remove either because "the recognizer always ends".

**Not Picovoice.** #1257 shipped Picovoice (Porcupine + Cheetah) on the strength of an out-of-date "forever free" plan. Picovoice is enterprise-only (since early 2026; its FAQ: no plans for personal or non-commercial use, only a one-time trial), so a household can't keep a key. Don't bring it back.

**The engine is open source and runs on the iPad** (`components/wall/voice/deviceEngine.ts`): openWakeWord for the wake word, Vosk for the command, fed by one `@picovoice/web-voice-processor` mic stream (Apache-2.0, no key; it's only Picovoice's mic/resampler helper).
- **No AI cost, no account.** The `device` engine never calls Gemini: `parseLocalCommand` + `parseLocalAdd` read everything, and what they can't read is "Didn't catch that". Don't add a Gemini fallback to that path without the owner. The Safari/Recording engines still fall back to Gemini, after the same local grammar.
- **`wakeWordModel.ts` is a line-for-line port of openWakeWord's Python streaming pipeline** (melspectrogram on each 1280-sample chunk plus the 480 samples before it, `x/10 + 2`, 76-frame embedding windows, 16 features, first 5 predictions zeroed, the 4 s noise prime). It was checked against Python's own scores on real audio: identical to < 1e-4. Change it only with that comparison.
- **ONNX Runtime Web is pinned to 1.17.3.** From 1.19 it ships only a threaded WebAssembly build whose memory is shared, which needs cross-origin isolation (COOP/COEP) — headers that would break Google sign-in popups here. 1.17.3 still has single-threaded builds, with and without SIMD. `numThreads = 1` is set explicitly.
- **The wake word runs in a worker** (`wakeWorker.ts`): it scores every 80 ms all day, about 7% of one desktop core, so ~13% of the 2015 iPad's — kept off the UI thread.
- **Two Vosk recognizers per command**: a free one, and one limited to `COMMAND_PHRASES`. The small model hears "show the calendar" as "though the calendar"; the limited one doesn't. `pickTranscript` only lets the limited one win when the free transcript reads as nothing and the limited one heard no "[unk]", so an add can never turn into a command.
- **The audio from just before the wake word is replayed** (0.1 s before the detection point, which the worker reports in samples, through to the hand-over), so "Hey Jarvis add milk" with no pause keeps "add". The end of the wake word sometimes comes out as "this"/"the"; `trimLeadIn` drops one or two such words only when that makes an unreadable command readable.
- **One mic, handed over, never dropped.** The processor stops the mic whenever its subscriber list empties, and a fresh `getUserMedia` can re-prompt on iPadOS. The recognizers subscribe (together, one call) BEFORE the wake word unsubscribes; afterwards the wake word is reset (so it can't re-fire on the "Hey …" it already heard) and resubscribed before the recognizers let go. `deviceEngine.test.ts` asserts the list never empties.
- **`vosk.createModel` is not used**: it never settles when loading fails (it waits only for a `load` event; failures arrive as `error`). The loader builds `new Model()` and listens for both, with a timeout.
- **Model files are not in git** (the openWakeWord models are CC BY-NC-SA 4.0 — fine for a household, but not ours to commit — and Vosk's is 41 MB). `scripts/fetch-voice-assets.mjs` downloads pinned versions, checks SHA-256, and writes `public/voice/` at deploy time. Hosting answers a missing path with `index.html` (200) — **under the same year-long immutable `voice/**` header** — so the loader rejects a body that **is** HTML (judged by its bytes, never the `Content-Type`: Hosting labels a compressed file of a type it doesn't know, `.onnx`, `text/html; charset=UTF-8`, so `firebase.json` also pins `voice/**/*.onnx` to `application/octet-stream`) rather than parsing a web page as a model, and refetches once with `cache: 'reload'` before giving up: a device that ever got that page (a load during a deploy) would otherwise keep it for a year. Its error names the status and content type, since a wall has no console. Paths carry versions and are cached immutable — **a changed file needs a new path**. They aren't content-hashed like `/assets/`, so swapping the bytes behind an unchanged path (a corrected pin, a different model under the same name) leaves every wall on the old file for up to a year. A shorter `max-age` wouldn't rescue that anyway: vosk-browser also keeps the unpacked model in IndexedDB keyed by its URL, and the browser holds the old file under that header. So bump the directory/file name in both `voiceAssets.ts` and the fetch script whenever a file's SHA-256 changes.
- **Safari's recognizer + the on-device wake word** (`voice: 'speech'` with `support.device`). In use, Vosk's small model was too slow and too inaccurate to be usable, while Safari's recognizer was far better — but it has no wake word and works only in a Safari tab, not a Home Screen app. So the wall can run in a Safari tab (`useWallFullscreen` hides the address bar on the first touch), and the device engine runs **wake-only** (`createDeviceEngine({ wakeOnly })`: openWakeWord without downloading Vosk). The two **don't share the mic**: on a wake, `listenAfterWakePause` unsubscribes the wake word (the processor then releases the mic), starts Safari's recognizer, and resubscribes afterwards only if the wall still wants it. Resubscribing **resets** the wake word first, or it re-fires on the "Hey …" still in its window. The words straight after the wake word are lost (Safari starts fresh), so users pause for the chime. A forced re-`getUserMedia` per command is acceptable here because a Safari tab with Microphone → Allow doesn't re-prompt (the Home Screen app can, which is why the device engine never drops the mic).
- **Built-in wake words** are openWakeWord's "Hey Jarvis" (default), "Hey Mycroft", "Hey Rhasspy". A bare "Jarvis" can trigger the default; a custom phrase avoids that. "Hey Home" is a custom .onnx the owner trains in a Colab notebook (~0.9 MB: too big for one Firestore doc, and base64 would make it bigger still). Its raw bytes go in `wallSettings/wake-0…wake-3` (≤ 700 KB each, Firestore `Bytes`), stamped with an upload id, and `config.wakeModel.file` points at them; Settings writes the chunks and the pointer in ONE batch, and `joinWakeFile` refuses chunks from another upload, so the wall never loads half a file. No Firebase Storage: the project doesn't use it, and this keeps the display's existing read rule.
- **The wake word listens only on a paired display, outside the night window, after a touch has unlocked audio.** Never on a member's phone preview.

---

## Wall layout: portrait and landscape, sized for across the room

- **Orientation is read from the screen, not a setting.** `@media (orientation: portrait)` in `components/wall/wall.css` restacks every screen (top bar on two rows, Today above the modules with the modules side by side, Day's side panel along the bottom); `useWallPortrait()` covers the few places JS needs it (module-menu wording, whether Today is stacked). Rotating the iPad or its stand is the switch.
- **Today fills its panel.** `useWallFit` grows Today's type (`--fit`, multiplied into `--k`) to the largest size that still fits, and shrinks it on a busy day rather than clipping. It only runs where Today has a height of its own (solo, or the landscape column); stacked above the modules in portrait it is sized by its content, so fitting would just grow it to its cap.
- **The night clock is sized in viewport units** (`min(30vw, 38vh)`), so it is as big as fits whichever way the iPad stands.
- **The bottom strip is an iPadOS viewport bug, not missing paint.** In a Home Screen app with the translucent status bar, the viewport (100vh, 100dvh, `innerHeight`) comes up a status bar short while the page is drawn under the bar, so a light strip of the web view shows below the page — painting `html` can't reach it. `useWallViewport` sets the wall's height to the screen's when the shortfall is a status bar or less (`utils/wall/wallViewport.ts`), and leaves browser tabs, Split View and a correct viewport alone.
- **Tabular figures only on numbers.** Schibsted Grotesk's tabular set widens the comma and period too, so `tabular-nums` on the whole wall printed "Monday , October 5". It is applied to the clock, times, temperatures and day numbers only.

## Wall updates: ask in the day, apply at night

A wall shows **An update is available** (Update / Later) when a new build is deployed, matching the phone's prompt, but it never reloads on its own in the day. Two things look like they could be simplified and can't:

- **`index.html` skips the `controllerchange` reload on a wall.** `public/sw.js` calls `skipWaiting()` on install, and the deploy's `sed` rewrites a comment in `sw.js` every build, so every deploy swapped the worker and reloaded the wall within seconds, mid-day, which re-locks iPadOS audio and the mic until someone touches it. The wall now gets an `lb-wall-update` event instead, which only triggers the version check. Running the old bundle under the new worker is the same state the night-only design already accepted.
- **The prompt is a persistent toast, not `confirm()`.** A `confirm()` freezes the page (clock, alerts, voice) until someone answers, and nobody may be standing there. The toast waits in the toast slot under any write toast or voice banner, and Later hides it for that build only. Update waits for queued writes first (`waitForPendingWrites`, 30 s cap) and says so when it's offline, rather than dropping a change by reloading.

## Wall voice: spoken answers, and the voice miss log that teaches the grammar

**Questions are answered by the local grammar too, never Gemini.** "Weather", "what's for dinner", "what's on the shopping list", "what time is it", "what's next" are `{ kind: 'ask' }` commands (`utils/wall/wallAnswers.ts`: `parseQuestion` + `composeAnswer`). They are read-only — they answer from what the wall already loads (`useWallData()` + `runtime.weather`) and never write. Every phrase given to the command-only recognizer must parse (`QUESTION_PHRASES`, checked by `wallAnswers.test.ts`).
- **One card frame for the brief and every answer.** An answer is a `WallBrief` (title, kicker, icon, lines) played by `useWallBrief`: chime, then each line with non-empty `speech` read in turn. List rows carry `speech: ''` — they're on the card only, so a 30-item shopping list is never read out. Spoken lists stop at `SPOKEN_ITEMS` (5) and say "and N more"; empty cases say so plainly ("Nothing's planned for dinner tonight"), never a confident zero.
- **"My" means the household.** The wall can't tell who is speaking. "What's on Sam's list" filters to Sam (`memberForName`, also trying the name without its possessive "s"); an unknown name is said back ("I don't know anyone called …"), never guessed.
- **Weather reaches 6 days** (the Open-Meteo window the wall already fetches); further out says so.

**The voice miss log** (`households/{id}/voiceMisses`, `WallVoiceMiss`) records commands the wall got wrong so the nightly voice-learning routine (`.claude/skills/voice-learning/SKILL.md`) can teach the grammar from them. It logs five things: a command neither grammar read, an "undo" within 10 s of a command (with what it did), "cancel" as the command, the wake word firing with nothing heard, and (`ai`) a typed-out command the grammar couldn't read but Gemini could, with what Gemini did. That last one is what lets the Safari engine (which falls back to Gemini) need it less over time: without it, every command Gemini rescued looked like a success and the routine never saw it. Recorded-audio commands aren't logged as `ai`, since every one of them goes through Gemini by design.
- **Text only, never audio.** Voice is on-device so nothing the household says leaves the iPad except this: what the recognizers transcribed for a command that went wrong. Don't add audio clips to it.
- **Create-only, by the display, as itself.** Members can't read, write or delete it (excluded from the catch-all rule both ways); only the `voicemisses` endpoint reads and deletes, via the Admin SDK, with a household API key carrying the separate `voiceLearning` scope — so no capture or export key can read household speech.
- **It can't pile up.** A Firestore TTL policy on `expireAt` (in `firestore.indexes.json`) purges misses at 30 days whether or not the routine runs, the endpoint also deletes expired ones on read, and a wall logs at most 100 a day (`takeMissSlot`, so a TV that keeps saying the wake word can't flood it).
- **The routine deletes exactly what it read**, by id, after its PR is pushed. Misses spoken during the run survive to the next night. It may add phrasings, new read-only answers, and new phrasings for the existing add actions (which keep their Undo); it never touches `firestore.rules`, Cloud Functions or new data. Those it writes up as proposals in the PR.
- **Why an API key and not a Cloud secret:** a new `defineSecret` makes every CI deploy fail until a human creates the secret (see Stripe). The household API key system already exists, is revocable from Settings, and scopes the key to one household.
