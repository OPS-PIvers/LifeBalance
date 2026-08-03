# Nightly Bank-Email Sync Runbook

> **Status:** shipped and live. The endpoint merged to `main` in PR **#1045**
> (`functions/src/quickAdd/bankEmailSync.ts` + `bankSyncMatch.ts`), stacked on the
> earlier schema/scope PRs #1042/#1043/#1044. Unlike Plaid/Stripe this function is
> **not** deliberately dormant — it's exported from
> [`functions/src/index.ts`](../functions/src/index.ts) (`export { … bankEmailSync }
> from "./quickAdd"`) and takes no new secret, so it deploys with every normal `main`
> merge like any other Cloud Function. This doc is the **operator setup checklist**
> for turning the feature on for a household — not a dormant-activation runbook like
> Plaid's.

## §1 — Overview & architecture

Wells Fargo sends a nightly "account update" email (balance summary + a list of the
day's withdrawals) after evening posting cutoff. Instead of an iOS Shortcut (no
overnight-trigger primitive), a **Google Apps Script** — living entirely inside the
user's own Gmail — wakes on a time-driven trigger each morning, finds that email in
Gmail, and POSTs it to a dedicated Cloud Function:

```
Gmail (alerts@notify.wellsfargo.com)
   │  time-driven trigger, ~6am CT
   ▼
Google Apps Script (search → label → POST)
   │  POST { subject, rawBody, messageId, today }
   │  Authorization: Bearer <API key, bankSync scope>
   ▼
bankEmailSync (Cloud Function, functions/src/quickAdd/bankEmailSync.ts)
   │  1. validate API key + bankSync scope + rate limit (50/hour)
   │  2. parseBankEmail() — deterministic, no Gemini (bankEmailParser.ts)
   │  3. reject if > MAX_WITHDRAWALS (100) lines parsed — abuse guard
   │  4. resolve account by parsed bank-account last-4 (bankSyncMatch.ts)
   │  5. atomically CLAIM the messageId ledger doc (idempotent re-runs)
   │  6. per withdrawal, decide a→e (bankSyncMatch.ts: decideWithdrawal)
   │       a. SKIP    — bankRef already recorded
   │       b. FILL    — an Apple Pay $0 needsAmount stub → marked verified
   │       c. CONFIRM — an existing pending_review transaction (same-account
   │                    or untagged only) → marked verified
   │       d. PAY     — a matching unpaid calendar bill, retro-filed to the
   │                    bill's OWN due-date pay period
   │       e. CREATE  — new verified, needsCategory transaction
   │  7. judge every still-unjudged day in the catch-up window for unplanned
   │     spending and fire any habit wired to the no-spend trigger
   │     (noSpendFire.ts — see §5)
   │  8. OVERWRITE the account balance with the email's AVAILABLE balance
   │  9. commit everything (including the ledger's final record) in ONE
   │     atomic batch
   ▼
Firestore (households/{id}/transactions, /accounts, /calendarItems,
           /bankEmailSyncLedger, /noSpendDays, /habits + submissions)
   │
   ▼
Push notification to every household member with bankEmailSync enabled
   (success summary, "No spend day"/"No spend weekend", PARSE_FAILED /
    TOO_MANY_WITHDRAWALS failure, or UNKNOWN_ACCOUNT warning)
```

Key properties (all read directly from the merged `main` code, not assumed):

- **No Gemini call** — `parseBankEmail()` is pure regex/text parsing
  ([functions/src/quickAdd/bankEmailParser.ts](../functions/src/quickAdd/bankEmailParser.ts)),
  so a WF format change fails loudly (a `PARSE_FAILED` push) instead of silently
  hallucinating numbers.
- **No per-line balance delta.** The email's **available** balance is the single
  source of truth (not the ending balance — that posted-only figure runs high by
  the sum of authorized-but-unposted card holds, i.e. money already spent); every
  withdrawal is filed/matched, but the account balance is only ever
  **overwritten** once per email (`buildBalanceUpdate`), never incremented.
  **Ordering guard:** each overwrite also stamps `Account.balanceAsOf` (the email's
  own "As of" date, falling back to its newest withdrawal date, then the request's
  `today`). An email whose as-of date is *older* than the stored `balanceAsOf` still
  files its transactions and ledger entry but **skips the balance overwrite**
  (`balanceSkipped: true` in the response; push says "Balance: unchanged") — so
  out-of-order processing (e.g. a backfill) can never regress the balance to a stale
  value. A "balance didn't update" report after such a run is this guard working,
  not a bug. Note: a *manual* balance edit in the app does not touch `balanceAsOf`,
  so the next night's email overwrites it as before — manual corrections are
  stopgaps, not authoritative. `balanceAsOf` is server-written only (Firestore
  rules reject client writes to it).
  **No-new-information guard:** the ordering guard above is defeated by the email's
  own format — its "As of" date is a SEND TIMESTAMP that advances every morning
  whether or not the bank posted anything, so a genuinely stale, information-free
  email (no withdrawal lines, byte-identical balances) can still carry a footer date
  that *beats* the last applied email and slip past the ordering guard. A second,
  independent guard catches this: the overwrite is also skipped when the email
  parses to **zero withdrawals** AND both its ending and available balances are
  cent-exact matches of `Account.lastSyncedAvailableBalance`/`lastSyncedEndingBalance`
  — the figures the last email that actually wrote `balance` recorded (`emailAddsNothingNew`
  in `bankSyncMatch.ts`). Both conditions are required: zero withdrawals alone isn't
  enough, because a quiet day can still see the available balance move (a deposit
  lands, a hold drops off), and that movement must still apply. This comparison
  deliberately does NOT use `Account.balance` — it drifts from the email's own
  figure as the user reviews transactions client-side, which is exactly the
  in-review state this guard protects from being clobbered. `lastSyncedAvailableBalance`/
  `lastSyncedEndingBalance` are written in the same batch.update as `balanceAsOf`
  (whenever the overwrite actually happens) and are likewise server-written only.
  The push distinguishes the two skip reasons ("older email, out of order" vs.
  "nothing new in this email") so the notification never claims an ordering problem
  when the real story is a no-op weekend email.
  This is also why a **filled Apple Pay stub** and a **confirmed pending transaction**
  are both marked `status: 'verified'` in this same pass (not left `pending_review`)
  — leaving either pending would let a later client-side categorize apply its own
  balance delta and double-count against the already-authoritative available balance.
- **A born-verified `needsCategory` row is not "done," it's "not yet categorized."**
  The `create` branch (step e) writes the new transaction as `status: 'verified'`
  (the balance already reflects it) but `needsCategory: true`. `needsReview()` in
  [hooks/useActionQueue.ts](../hooks/useActionQueue.ts) treats
  `status === 'verified' && needsCategory === true` exactly like a classic
  `pending_review` row for surfacing purposes, so these rows show up in the
  **Action Queue**, the on-open **review drawer**, and the **bottom-nav badge count**
  (via the same `needsReview` predicate) until someone assigns a category — they
  just don't move Safe-to-Spend when that happens.
- **Idempotent via an atomic claim, not a plain read.** The endpoint claims
  `households/{id}/bankEmailSyncLedger/{sha256(messageId)}` inside a
  `runTransaction` (create-if-absent) *before* loading any candidate rows — the
  same check-and-claim shape as the Gemini daily-quota guard. A concurrent retry
  of the exact same email while the first attempt is still mid-flight sees the
  claim already taken and returns `{ success: true, skipped: true,
  alreadyProcessed: true }` immediately, even though the first attempt hasn't
  finished. If that first attempt then fails (any error before the batch
  commits), the endpoint **releases its claim** (deletes the ledger doc) in the
  `catch` block, so a later fresh run of the same `messageId` reprocesses it
  from scratch — the "skip" response some earlier retry received does **not**
  mean the email is permanently dropped. Once the batch **commits**, the claim
  is immediately treated as durable (a structural `claimedByUs = false` right
  after `batch.commit()`) so nothing after that point can accidentally delete a
  successfully-processed ledger record.
- **A 100-withdrawal-line cap (`MAX_WITHDRAWALS`)** rejects an outsized/malformed
  email with a distinct `TOO_MANY_WITHDRAWALS` failure push rather than staging a
  batch anywhere near Firestore's 500-write hard limit. Lowered from 150 to 100
  when the no-spend catch-up window (§5) landed, to buy headroom for judging up
  to four days in one batch — a real nightly WF email carries roughly a dozen
  lines (the largest ever observed in production is 16), so 100 is still an
  enormous margin over anything legitimate.
- **Every filed/created transaction carries the parsed `bankRef`**, so even
  independently of the ledger claim, a withdrawal whose `bankRef` is already on a
  transaction is skipped (decision `a`) rather than re-filed on any re-run.
- **Everything in one `db.batch()`** per email — transactions, calendar bill
  updates, the account balance overwrite, and the ledger's final "processed"
  record all commit atomically or not at all.

## §2 — The Google Apps Script

Paste this into **script.google.com → New project** (or **Extensions → Apps Script**
from the Gmail account that receives the Wells Fargo emails). It requires no
libraries — only the built-in `GmailApp`, `UrlFetchApp`, `Utilities`, and
`ScriptApp`/trigger services.

```javascript
/**
 * LifeBalance nightly bank-email sync.
 *
 * Finds this morning's unprocessed Wells Fargo "account update" email(s),
 * POSTs each to the bankEmailSync Cloud Function, and labels the thread
 * "lb-synced" only after a successful (non-error) response — belt-and-braces
 * with the server's own messageId ledger, so a network blip or a server-side
 * failure leaves the label off and the email gets retried the next morning.
 */

// --- Fill these in ---
const LB_FUNCTION_URL = 'https://us-central1-lifebalance-26080.cloudfunctions.net/bankEmailSync';
const LB_API_KEY = 'PASTE_YOUR_BANKSYNC_API_KEY_HERE'; // Settings → API keys → bankSync-only key
const LB_LABEL_NAME = 'lb-synced';
const WF_SEARCH_QUERY = 'from:alerts@notify.wellsfargo.com subject:(account update) newer_than:2d -label:' + LB_LABEL_NAME;

function lbSyncBankEmails() {
  const label = getOrCreateLabel_(LB_LABEL_NAME);
  const threads = GmailApp.search(WF_SEARCH_QUERY, 0, 20);

  threads.forEach(function (thread) {
    const messages = thread.getMessages();
    // Only the newest message in the thread is the one we haven't processed.
    const message = messages[messages.length - 1];

    const payload = {
      subject: message.getSubject(),
      rawBody: message.getBody(), // full HTML body
      messageId: message.getId(),
      today: getLocalToday_(),
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + LB_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true, // inspect the status ourselves instead of throwing
    };

    let response;
    try {
      response = UrlFetchApp.fetch(LB_FUNCTION_URL, options);
    } catch (err) {
      Logger.log('lbSyncBankEmails: network error, will retry tomorrow: ' + err);
      return; // leave the thread unlabeled → retried next run
    }

    const status = response.getResponseCode();
    let body = {};
    try {
      body = JSON.parse(response.getContentText());
    } catch (err) {
      Logger.log('lbSyncBankEmails: non-JSON response (status ' + status + '), will retry tomorrow.');
      return;
    }

    if (status >= 200 && status < 300 && body.error === undefined) {
      thread.addLabel(label);
      Logger.log('lbSyncBankEmails: synced ' + message.getId() + ' — ' + JSON.stringify(body.data || body));
    } else {
      // PARSE_FAILED / TOO_MANY_WITHDRAWALS / UNKNOWN_ACCOUNT / rate-limit /
      // auth error, etc. — leave the label OFF so the next morning's run
      // retries this same email. A body of { skipped: true, alreadyProcessed:
      // true } with a 200 status is the ONE case that's actually a success
      // (the "if" branch above already caught it, since it has no `error`
      // field) — this else branch is genuine failures only.
      Logger.log('lbSyncBankEmails: server reported an error (status ' + status + '): ' + JSON.stringify(body));
    }
  });
}

/** yyyy-MM-dd in the script's own local timezone (Project Settings → Time zone). */
function getLocalToday_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

/** Run once manually to install the ~6am trigger. */
function lbInstallDailyTrigger() {
  // Remove any existing lbSyncBankEmails triggers first so re-running this
  // doesn't stack up duplicate triggers.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'lbSyncBankEmails') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('lbSyncBankEmails')
    .timeBased()
    .everyDays(1)
    .atHour(6) // fires sometime in the 6–7am window in the script's timezone
    .create();
}
```

### Installation steps

1. **Set the project's timezone** to the household's local timezone: in the Apps
   Script editor, **Project Settings (gear icon) → Time zone**. `today` is computed
   from this timezone via `Session.getScriptTimeZone()`, so an incorrect timezone here
   is the #1 way to get an off-by-one-day withdrawal date. (Central Time, since the
   sample WF email footer reads "Central Time" — set this to wherever *your*
   household actually is.)
2. Paste the script above into a new script file.
3. Fill in `LB_FUNCTION_URL` (already correct for the `lifebalance-26080` project;
   only change it if you're pointed at a different Firebase project) and
   `LB_API_KEY` (generate this in §3 below — a **new key scoped to `bankSync` only**).
4. Run `lbInstallDailyTrigger` once manually from the editor (▶ button, function
   dropdown set to `lbInstallDailyTrigger`). Approve the Gmail/Apps Script
   authorization prompts. This installs a daily time-driven trigger firing in the
   6–7am window in the timezone you set in step 1 — Wells Fargo's overnight posting
   cutoff and email send should be well before then, but adjust `.atHour(6)` if your
   bank's email arrives later.
5. Confirm the trigger exists: **Triggers (clock icon in the left sidebar)** should
   show `lbSyncBankEmails` — Time-driven — Day timer.
6. Optionally run `lbSyncBankEmails` manually once (▶ button) against last night's
   real email to verify end-to-end before waiting for tomorrow's automatic run.

**Function URL format**: `https://us-central1-<PROJECT_ID>.cloudfunctions.net/bankEmailSync`
(`<PROJECT_ID>` is `lifebalance-26080` for production — same
`us-central1-<project>.cloudfunctions.net` shape every other quickAdd endpoint uses,
per `getQuickAddBaseUrl()` in [services/apiKeyService.ts](../services/apiKeyService.ts)).

## §3 — Setup checklist

1. **Generate a dedicated API key.** Settings → **API keys** → create a new key and
   enable **only** the `bankSync` permission (leave habits/expenses/shoppingList/
   bills/todos/read off) — the same principle as `read` being its own scope so a
   capture-only key can't also ingest bank emails, `bankSync` is deliberately
   separate too. Copy the raw key immediately (write-once reveal) and paste it into
   the Apps Script's `LB_API_KEY` constant.
2. **Tag the checking account.** Money → **Accounts** → tap the account → **Account
   Number & Cards** drawer:
   - **Account number last 4** — the 4 digits from the email's own "for account
     …5581" line (e.g. `5581`). This is how `bankEmailSync` resolves which account a
     given night's email belongs to (`matchAccountByAccountLast4` — a unique last-4
     match only; an unmatched or ambiguous last-4 no-ops with an `UNKNOWN_ACCOUNT`
     warning push rather than guessing).
   - **Cards on this account** — the card last-4 chips used by the existing Apple
     Pay/bank-notification Shortcuts; not required for the nightly sync itself, but
     tag them here too if not already done so card-purchase lines from the nightly
     email can still cross-reference the right stubs.
3. **Confirm the notification toggle.** Settings → **Notifications** → **Nightly
   Bank Sync** (defaults ON — fail-open, so it's already enabled unless someone
   turned it off). This is what delivers the nightly success/PARSE_FAILED/
   UNKNOWN_ACCOUNT push to every household member with an FCM token who hasn't
   explicitly disabled it.
4. **Week-1 expectation: let bill matching learn (there is no manual-alias UI
   yet).** The first time a nightly withdrawal is matched to an unpaid calendar
   bill by title token-overlap (decision `d`, `pay_bill`, `matchedByAlias: false`),
   the server **learns** the withdrawal's exact descriptor text as a
   `bankDescriptorAliases` entry on that bill (the recurring template, when
   applicable) — so next month's withdrawal for the same bill matches on the
   learned alias (exact-text equality via `matchesAlias`) rather than needing to
   re-derive the token overlap.
   - There **is** a mutation-layer helper for manually seeding an alias —
     `makeLinkBankTransactionToBill` /
     `linkBankTransactionToBill(transactionId, calendarItemId)` in
     [contexts/household/mutations/calendarMutations.ts](../contexts/household/mutations/calendarMutations.ts)
     — which marks the bill paid, files the transaction as its payment, and
     appends the transaction's merchant text to `bankDescriptorAliases` in one
     batch, for exactly this "teach it early" use case. **It is not yet wired to
     any UI affordance** (the code comment says so explicitly: "Not yet wired to
     a review-UI affordance — that is a tracked follow-up"), so there is currently
     no Settings/Money screen where you can trigger it, and manually
     editing/reconciling a transaction elsewhere in the app does **not** write an
     alias (only `bankEmailSync`'s own `pay_bill` branch, or that helper, do).
   - **Practical week-1 seeding, until that UI ships:** simply let the first
     night's sync run and check that recurring bills (rent, subscriptions,
     insurance) land as `pay_bill` (bill marked paid, no new `needsCategory` row)
     rather than `create` (a new Uncategorized transaction). If a bill lands as
     `create` instead, see the token-overlap requirements in §4 below — it may
     need a closer-matching bill title, or you can wait for the alias to be
     learned starting from whichever descriptor form the bank happens to use
     once a token-overlap match does succeed.
   - **How to verify:** open the bill/template's calendar item and check for a
     `bankDescriptorAliases` array field (Firestore console — there's no UI
     display of this field yet either). A `needsCategory: true` transaction
     surfacing in the Action Queue / review drawer is the visible sign a
     withdrawal fell through to CREATE instead of matching a bill.

## §4 — Troubleshooting

**"No spend day" / "No spend weekend" push.** The day that had just ended when
this email was cut carried no *unplanned* spending, so any habit wired to the
no-spend trigger was logged for it. See §5 for what counts. Note this is a
verdict about a DAY, not about the email: an email with no `Withdrawals` section
at all (what Wells Fargo sends when nothing was withdrawn) is likewise a
successful sync with zero withdrawals rather than a failure, and the balance is
still overwritten as normal — but a day whose only withdrawals were bills also
earns this push.

The zero-withdrawal parse requires the email's `As of` footer to be present
(proof the body wasn't truncated above the withdrawals) and every dollar amount
in the body to be accounted for by the Balance summary (proof the section wasn't
merely renamed — this catches an ACH-only night under a renamed header, which a
withdrawal-line-shape probe would miss, since ACH lines carry no
`PURCHASE AUTHORIZED ON` lead verb). Failing either keeps the loud
`PARSE_FAILED` below. Note the second guard errs toward a loud failure: if Wells
Fargo ever adds an unrelated trailing dollar figure to the layout, a genuine
no-spend night starts reporting a parse failure — that is the recoverable
direction (the alternative would credit a habit that was never earned), and the
fix is to teach `hasUnexplainedAmountLine` about the new line. See
`parseBankEmail`'s zero-withdrawal acceptance rules.

**"Bank sync failed" push (`PARSE_FAILED`).** `parseBankEmail()` couldn't find the
expected shape — missing "for account …NNNN", missing the Ending/Available balance
summary, a missing `Withdrawals` section that failed one of the two zero-withdrawal
guards just above, or a line inside that section that doesn't match either the
card-purchase or ACH/biller line shape. This almost always means **Wells Fargo
changed the email's format**. No Firestore writes happen on a
parse failure (the function returns before the account/ledger/batch steps) —
nothing is corrupted, but nothing was synced either. The push body itself is
sanitized (control characters/newlines stripped) and hard-truncated to 120
characters (`sanitizeForPush`/`PUSH_ERROR_MAX_LEN` in `bankEmailSync.ts`) so a
weird parser message can't smuggle multi-line content into the notification — the
full untruncated message is still in the JSON response (`message` field) and in
Cloud Functions logs if you need the complete text. Check the raw email in Gmail
against the expected layout documented in `bankEmailParser.ts`'s header comment,
and if the format truly changed, the parser (regexes: `ACCOUNT_LAST4_RE`,
`ENDING_BALANCE_RE`, `AVAILABLE_BALANCE_RE`, `CARD_LINE_RE`, `ACH_LINE_RE`) needs
updating.

**"Bank sync failed" push (`TOO_MANY_WITHDRAWALS`).** The email parsed to more than
`MAX_WITHDRAWALS` (100) withdrawal lines — an abuse/runaway-parse guard, since a
real nightly statement carries roughly a dozen (the largest ever observed in
production is 16). As with `PARSE_FAILED`, nothing is written. If a legitimate
email genuinely has this many lines, that cap needs raising in code (with a
recheck of the Firestore 500-write batch-size proof documented next to the
constant — it now has to account for the no-spend catch-up window too, see §5).

**"Balance: unchanged (nothing new in this email)" in the push, or my balance
didn't update after a sync that DID find withdrawals.** If withdrawals were found,
this guard didn't fire — check whether the ordering guard did instead (see the
"older email, out of order" entry right above). If the push genuinely says
"nothing new in this email", the email parsed to zero withdrawal lines and its
balances were a cent-exact repeat of the last email that actually wrote the
balance — this is `emailAddsNothingNew` working as intended, not a bug. It exists
specifically so a stale, information-free email (typically a quiet-weekend send
whose footer date still advances) can't clobber a balance the user has since
edited or that a same-day Plaid sync moved. If you believe the email genuinely
carried new information the guard is misreading, check the Cloud Functions log
line it emits ("no new information, messageId …") and compare the email's
Ending/Available figures against `Account.lastSyncedAvailableBalance`/
`lastSyncedEndingBalance` in the Firestore console.

**"Bank sync skipped" push (`UNKNOWN_ACCOUNT`).** The email's account last-4 didn't
uniquely match any household account's `accountLast4` field. Nothing is written
(again, no partial state). Fix: go tag (or correct) the account's **Account number
last 4** in Money → Accounts as described in §3 step 2, then re-run the email (see
below) — you don't have to wait for tomorrow night.

**A withdrawal I expected to CONFIRM against a pending row instead created a new
transaction.** As of the merged code, `confirm_pending` (decision `c`) only
considers a pending row that is **untagged** or already tagged to the **same
resolved account** as this email — a pending row explicitly tagged to a different
account (most importantly a credit card) is deliberately excluded, so a checking
email can never verify a credit-card charge. If the amount+date match but the
transaction is tagged elsewhere, that's this gate working as intended, not a bug.

**A withdrawal that paid an overdue bill filed under the wrong pay period.** This
is expected: `pay_bill` (decision `d`) retro-files the resulting transaction's
`payPeriodId` using **the bill's own due date**, not the date the withdrawal
cleared (`getBillPayPeriodId` in `bankSyncMatch.ts`) — mirroring the client's
`payCalendarItem` convention. An overdue June bill that a July nightly email pays
correctly lands in the June pay period, not July.

**Duplicate safety.** Two independent layers prevent double-processing:
1. The **messageId ledger**, claimed atomically. The endpoint claims
   `households/{id}/bankEmailSyncLedger/{sha256(messageId)}` inside a Firestore
   `runTransaction` (create-if-absent) *before* doing any other work. A re-POST of
   the *exact same email* while an earlier attempt for that same `messageId` is
   still mid-flight sees the claim already taken and gets back
   `{ success: true, skipped: true, alreadyProcessed: true }` with no new writes
   — **but** if that earlier attempt then fails before its batch commits, it
   deletes its own claim in its `catch` block, so a subsequent fresh POST for the
   same `messageId` is NOT permanently blocked — it reprocesses normally. Only a
   claim whose owning attempt went on to successfully `batch.commit()` is durable.
2. Every individual withdrawal line carries its parsed **`bankRef`** (the Wells
   Fargo reference token for card lines, or a deterministic `synth:<hash>` for
   ACH/biller lines) stamped onto whatever transaction it produced/matched. Even if
   the ledger doc were somehow missing (e.g. manually deleted), a withdrawal whose
   `bankRef` is already present on a transaction is **skipped** (decision `a`,
   `skip_bankref`) rather than re-filed.
   Belt-and-braces on the Apps Script side, the `lb-synced` Gmail label is applied
   only after a success response, so the script itself won't re-POST an
   already-labeled thread on its next daily run either — but the two server-side
   layers above are what actually make a re-POST safe even if the label were removed
   or the script re-run manually.

**Re-running one email safely.** Because of the guards above, re-running is safe by
design — remove the `lb-synced` label from the specific Gmail thread (or just run
`lbSyncBankEmails()` manually from the Apps Script editor, which re-scans anything
not already labeled) and it will either no-op (`alreadyProcessed: true`, if it fully
succeeded before) or reprocess cleanly if the prior attempt failed before
completing (any withdrawal lines from a prior *partial* run are additionally
skipped via `bankRef`, so nothing is double-filed even in that edge case). There is
no need to manually delete the ledger doc or any transactions before re-running.

## §5 — No-spend days & the habits they fire (F-HABITS-14)

Every successful sync judges every still-unjudged day in a rolling catch-up
window and, for each one that was clean, logs any habit wired to the no-spend
trigger. This runs on **every** email, not only the ones with no withdrawals.

**Why a window, not a single day.** Wells Fargo does not send a Saturday or
Sunday email. A day-by-day judgement (the original design) meant the Saturday
half of every weekend was *never* judged by anyone — the Saturday-dated email
arrives Sunday and judges Friday, and no email ever covers Saturday or Sunday
itself. Since the weekend rule (below) requires a `noSpendDays` verdict for
Saturday to exist, "Clean weekend" could never fire, for any household, ever.

**Which days.** Every day from `asOf - MAX_NO_SPEND_CATCHUP_DAYS` through
`asOf - 1`, ascending, where `asOf` is the email's own `As of MM/DD/YYYY`
footer date (falling back to the request's local `today` when the footer is
absent) — **except** any day that already has a `noSpendDays/{date}` verdict
doc, which is skipped (see below). `MAX_NO_SPEND_CATCHUP_DAYS` is 4, not 3: a
holiday Monday (no email that day at all) leaves Saturday, Sunday, Monday AND
Tuesday all unjudged by the time the next email arrives on Wednesday, and a
3-day window would silently drop Saturday again — the exact bug this feature
exists to remove. See `noSpendDay.ts`'s `datesToJudge`/`noSpendCatchupWindow`
for the pure logic (unit-tested in `noSpendDay.test.ts`), and
`bankEmailSync.ts`'s `MAX_WITHDRAWALS` doc comment for how this window factors
into the Firestore batch-size proof (§4's `TOO_MANY_WITHDRAWALS` entry). A
first-time backfill still only sends at most two days of email (the Apps
Script's `newer_than:2d` fence), so activation cannot retro-fire a month of
habits even though any one of those emails could in principle catch up four.

**Skip-if-already-judged.** A day is skipped when it already has a
`noSpendDays/{date}` doc — i.e. some earlier email already settled it CLEAN.
Re-judging it would fight the "a later charge does not revoke the credit" rule
below for a verdict that's already final, and cost an extra transactions query
for no benefit. A **dirty** day never gets a verdict doc at all (the function
returns before staging one), so it is *not* "already judged" in this sense — it
is correctly re-evaluated by every subsequent email until a night finally comes
back clean. That re-evaluation is harmless: the per-habit `sourceNoSpendDate`
submission check (below), not the skip, is what actually prevents a double
credit once a day does qualify.

**What counts as spending.** The question is asked of every transaction *dated to
that day*, across every account — not of whether the email was empty. Wells Fargo
reports card **authorization** dates, so a Thursday charge can appear in
Saturday's email; the parser already resolves each withdrawal to its real date and
this reads those dates. A transaction is exempt when it is:

| Exempt | Recognized by |
| --- | --- |
| Income | `category === 'Income'` |
| A scheduled bill | `category === 'Budgeted in Calendar'` (what the `pay_bill` branch files) |
| A credit-card payment | `creditPayment === true`, or `category === 'Credit Card'` |
| A transfer between your own accounts | the word "transfer" in the merchant/descriptor |
| A genuine `$0` row | no positive amount **and** not a `needsAmount` Apple Pay stub |

Everything else — including a **credit-card charge** — breaks the day. That is
deliberate: exempting card spend would make the habit satisfiable by reaching for
a different card.

A withdrawal this email is about to CREATE as a new row (never a fill/confirm/
pay_bill, whose target row already exists and is authoritative — see
`shouldDeclareToNoSpend` in `noSpendDay.ts`) is declared to **the day it's
dated on**, not to whichever day the email happens to be judging last — a
Saturday charge caught up by Tuesday's email must count against Saturday, not
get folded into Tuesday's own judgement. Getting this wrong would mean card
authorizations from an earlier day in the window never count against that
day, and every day in the catch-up window would read clean by default — worse
than the single-day bug this feature replaces.

**Known limits, by design.** Spending on an account LifeBalance can't see (a card
that is neither Plaid-linked nor captured by the iOS Shortcut) is invisible and
will produce a false no-spend day. A recurring charge that is *not* linked to a
calendar bill reads as unplanned and breaks the day until you link it. A charge
that arrives after the day was credited does not revoke the credit.

**The weekend rule.** A `weekend`-scoped habit fires only when **both Saturday and
Sunday** were clean, credited to the Sunday — which is also what puts the
completion in the correct Mon–Sun ISO week for a weekly habit's streak. Saturday's
verdict is normally read from its own `noSpendDays/{date}` doc, so "we never
synced that day" stays distinguishable from "that day was clean": with no record
for Saturday, the weekend does not fire. **Exception:** when the SAME email judges
both Saturday and Sunday (the catch-up window makes this the common case for a
weekend), Saturday's verdict doc is only *staged* on the batch when Sunday's check
runs — not yet committed — so a plain Firestore read would miss it. The function
instead threads a same-batch `stagedCleanDates` set through each day it judges
(ascending order), so Sunday's check can see Saturday's in-flight verdict. Missing
this case would silently reintroduce the exact bug the catch-up window exists to
fix, just one layer deeper.

**Where the verdict lives.** `households/{id}/noSpendDays/{yyyy-MM-dd}`, written
only by this function (client writes are denied in `firestore.rules`, because the
presence of a doc is what lets the weekend rule credit a habit, and what lets a
later email skip re-judging a settled day). Each run also records a `noSpend`
object on the `bankEmailSyncLedger` entry describing the MOST RECENT day it
judged (`date`, `isNoSpendDay`, `firedHabitIds`, `weekendCompleted` — kept in
this exact shape for backward compatibility with entries written before the
catch-up window), plus a sibling `noSpendDays` array with one entry of the same
shape **per day the email actually judged**, ascending — so "why did/didn't my
habit fire on THAT day" stays answerable even when it isn't the most recent one
a given email settled. The push notification's title/body are driven by the most
recent judged day (so "No spend weekend" still shows up when the Sunday rule
fires), but the body's habit-fire sentence pools fires from **every** day the
email judged, so an earlier day's fire in the same run is never silently dropped.

**Idempotency.** Each fire writes a `HabitSubmission` carrying
`sourceNoSpendDate`, and the function refuses to fire a habit for a date that
already has one. The per-`messageId` ledger claim stops the same email being
processed twice; this stops a *second* email the same morning (another account, a
backfill) re-crediting the same day.

That second guard is sequential, not atomic. Two emails for the same household
and the same target day, processed *concurrently*, could both pass the
`sourceNoSpendDate` check before either batch commits, and both credit the day —
one day of doubled points. Not reachable in the current setup: the Apps Script
POSTs each email in turn and awaits the response, so two runs never overlap. It
is deliberately not fixed with a transactional claim on the verdict doc, because
that claim would have to commit separately from the money batch — and if that
batch then failed, the retry would find the claim present and skip firing,
losing the credit permanently. A doubled day is recoverable by hand (delete the
extra submission and decrement `points`); a silently lost one is not.

**Configuring it.** On the habit itself: Habits → edit a habit → Automations →
**No-spend days**, then pick "Every clean day" or "Clean weekend". Nothing fires
until at least one habit is wired up; the push still reports the clean day.

**Troubleshooting.** "My habit didn't fire on a day I know was clean" — check the
Cloud Functions log for a `noSpend:` line, or the `noSpendDays` array on that
morning's `bankEmailSyncLedger` entry (Firestore console) for that specific
date's verdict. The log names either the transactions that disqualified the day,
the missing Saturday record for a weekend, or the habit that was already
credited. "A day I know was clean never got judged at all" — check whether it
already has a `noSpendDays/{date}` doc from an earlier email (expected: it was
already settled and correctly skipped) or whether it falls outside the
`MAX_NO_SPEND_CATCHUP_DAYS`-day window of the first email sent after it (a gap
longer than that — several consecutive missed emails — needs a manual replay of
the missing days' emails through the Apps Script, or raising the constant).
