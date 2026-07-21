# Nightly Bank-Email Sync Runbook

> **Status:** the endpoint ships on PR **#1045** (`feat/bank-email-sync-endpoint`,
> branch `bankEmailSync.ts` + `bankSyncMatch.ts`), stacked on the already-merged
> schema/scope PRs #1042/#1043/#1044. Unlike Plaid/Stripe this function is **not**
> deliberately dormant — it's already exported from
> [`functions/src/index.ts`](../functions/src/index.ts) (`export { … bankEmailSync }
> from "./quickAdd"`) and takes no new secret, so once #1045 merges to `main` it
> deploys on the very next CI run like any other Cloud Function. This doc is the
> **operator setup checklist** for turning the feature on for a household — not a
> dormant-activation runbook like Plaid's.

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
   │  1. validate API key + bankSync scope + rate limit
   │  2. parseBankEmail() — deterministic, no Gemini (bankEmailParser.ts)
   │  3. resolve account by parsed bank-account last-4 (bankSyncMatch.ts)
   │  4. messageId ledger fast-skip (idempotent re-runs)
   │  5. per withdrawal, decide a→e (bankSyncMatch.ts: decideWithdrawal)
   │       a. SKIP    — bankRef already recorded
   │       b. FILL    — an Apple Pay $0 needsAmount stub
   │       c. CONFIRM — an existing pending_review transaction
   │       d. PAY     — a matching unpaid calendar bill
   │       e. CREATE  — new verified, needsCategory transaction
   │  6. OVERWRITE the account balance with the email's ending balance
   │  7. commit everything in ONE atomic batch
   ▼
Firestore (households/{id}/transactions, /accounts, /calendarItems,
           /bankEmailSyncLedger)
   │
   ▼
Push notification to every household member with bankEmailSync enabled
   (success summary, PARSE_FAILED warning, or UNKNOWN_ACCOUNT warning)
```

Key properties (all read directly from the shipped code, not assumed):

- **No Gemini call** — `parseBankEmail()` is pure regex/text parsing
  ([functions/src/quickAdd/bankEmailParser.ts](../functions/src/quickAdd/bankEmailParser.ts)),
  so a WF format change fails loudly (a `PARSE_FAILED` push) instead of silently
  hallucinating numbers.
- **No per-line balance delta.** The email's ending balance is the single source of
  truth; every withdrawal is filed/matched, but the account balance is only ever
  **overwritten** once per email (`buildEndingBalanceUpdate`), never incremented.
- **Idempotent two ways**: a `households/{id}/bankEmailSyncLedger/{sha256(messageId)}`
  doc short-circuits a re-POST of the same email, and every filed/created transaction
  carries the parsed `bankRef` so even a ledger-miss re-run recognizes and skips
  already-recorded withdrawals line-by-line.
- **Everything in one `db.batch()`** per email — transactions, calendar bill updates,
  the account balance overwrite, and the ledger doc all commit atomically or not at
  all.

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
const WF_SEARCH_QUERY = 'from:alerts@notify.wellsfargo.com subject:(account update) -label:' + LB_LABEL_NAME;

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
      // PARSE_FAILED / UNKNOWN_ACCOUNT / rate-limit / auth error, etc. — leave
      // the label OFF so the next morning's run retries this same email.
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
4. **Week-1 expectation: let bill matching learn.** The first time a nightly
   withdrawal is matched to an unpaid calendar bill by title token-overlap (step d,
   `pay_bill`), the server **learns** the withdrawal's exact descriptor text as a
   `bankDescriptorAliases` entry on that bill/template — so the *next* month's
   withdrawal for the same bill matches on the learned alias (exact-text) rather
   than needing to re-derive the token overlap. You can also seed this manually: any
   time you manually reconcile/categorize a transaction against a bill in the app,
   that doesn't itself write an alias (aliases are only written by the `pay_bill`
   branch of `bankEmailSync` itself) — so the real way to "seed" bill matching in
   week 1 is simply to let the first night's sync run and check that recurring bills
   (rent, subscriptions, insurance) land as `pay_bill` (bill marked paid, no new
   `needsCategory` row) rather than `create` (a new Uncategorized transaction). If a
   bill lands as `create` instead, see the token-overlap requirements in §4 below —
   it may need a closer-matching bill title, or you can wait for the alias to be
   learned starting from whichever descriptor form the bank happens to use.
   - **How to verify:** open the bill/template's calendar item and check for a
     `bankDescriptorAliases` array field (Firestore console, or wait for the next
     month's cycle to see it auto-match). A `needsCategory: true` transaction in
     Money → Overview's review queue is the visible sign a withdrawal fell through
     to CREATE instead of matching a bill.

## §4 — Troubleshooting

**"Bank sync failed" push (`PARSE_FAILED`).** `parseBankEmail()` couldn't find the
expected shape — missing "for account …NNNN", missing the Ending/Available balance
summary, missing a "Withdrawals" section header, or a line inside that section that
doesn't match either the card-purchase or ACH/biller line shape. This almost always
means **Wells Fargo changed the email's format**. No Firestore writes happen on a
parse failure (the function returns before step 6/7 above) — nothing is corrupted,
but nothing was synced either. Check the raw email in Gmail against the expected
layout documented in `bankEmailParser.ts`'s header comment, and if the format truly
changed, the parser (regexes: `ACCOUNT_LAST4_RE`, `ENDING_BALANCE_RE`,
`AVAILABLE_BALANCE_RE`, `CARD_LINE_RE`, `ACH_LINE_RE`) needs updating.

**"Bank sync skipped" push (`UNKNOWN_ACCOUNT`).** The email's account last-4 didn't
uniquely match any household account's `accountLast4` field. Nothing is written
(again, no partial state). Fix: go tag (or correct) the account's **Account number
last 4** in Money → Accounts as described in §3 step 2, then re-run the email (see
below) — you don't have to wait for tomorrow night.

**Duplicate safety.** Two independent layers prevent double-processing:
1. The **messageId ledger** (`households/{id}/bankEmailSyncLedger/{sha256(messageId)}`)
   short-circuits a re-POST of the *exact same email* — the response comes back
   `{ success: true, skipped: true, alreadyProcessed: true }` with no new writes.
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
succeeded before) or pick up exactly where a partial failure left off (any
withdrawal lines already recorded are skipped via `bankRef`, only the
unresolved/new ones are (re-)processed). There is no need to manually delete the
ledger doc or any transactions before re-running.
