/**
 * POST /bankEmailSync
 *
 * Nightly Wells Fargo "account update" email ingestion. A Google Apps Script
 * posts ONE such email per call each morning; this endpoint parses it
 * deterministically (bankEmailParser.ts — no Gemini), resolves the account by
 * the parsed bank-account last-4, then processes each WITHDRAWAL line through
 * the a→e precedence in bankSyncMatch.ts (skip-by-bankRef → fill Apple Pay stub
 * → confirm a pending transaction → pay a calendar bill → create a new verified
 * needs-category row) and finally OVERWRITES the account balance with the
 * email's ending balance.
 *
 * Authenticated by the same `lb_..._...` Bearer API key the other quickAdd
 * endpoints use, gated on the dedicated `bankSync` scope (not `read`/write
 * scopes) via `hasScope`. Idempotent per Message-ID via a small ledger doc.
 *
 * Money model: NO per-line balance delta anywhere — the email's ending balance
 * already reflects every withdrawal, so the single overwrite is the source of
 * truth. Every write for the whole email commits in ONE atomic batch.
 *
 * Ordering guard: the overwrite is only-if-newer. Each account stores
 * `balanceAsOf` (yyyy-MM-dd, the latest withdrawal date in the email that last
 * won, or `today` when that email had none) alongside the balance. An
 * incoming email whose own as-of date is OLDER than the stored one is applied
 * for transactions/bills as normal but SKIPS the balance overwrite — this
 * makes the server structurally immune to out-of-order delivery (e.g. a
 * first-install backfill processing several historical emails newest-first),
 * independent of the client-side Gmail `newer_than` fence.
 *
 * Lives in its own file (re-exported from the quickAdd barrel + functions
 * index) to keep the churny expense-endpoint code and this apart.
 */

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createHash } from "crypto";
import { format, parseISO, subDays, addDays } from "date-fns";
import {
  validateApiKey,
  extractApiKey,
  checkRateLimit,
  logApiCall,
  hasScope,
} from "./apiKeyValidation";
import { parseBankEmail } from "./bankEmailParser";
import { formatCurrency } from "../utils/formatCurrency";
import { getPayPeriodForTransaction } from "../plaid/payPeriod";
import {
  expandCalendarItems,
  isRecurringId,
  parseRecurringId,
  type BillCalendarItem,
} from "./billMatch";
import { type ReconcileCandidate, buildFillUpdates } from "./reconcile";
import {
  decideWithdrawal,
  buildBalanceUpdate,
  matchAccountByAccountLast4,
  getBillPayPeriodId,
  computeBalanceAsOf,
  shouldSkipBalanceOverwrite,
  type PendingConfirmCandidate,
  type BillPayCandidate,
  type PaidIncomeLike,
} from "./bankSyncMatch";
import {
  sendNotificationToUser,
  type NotificationPreferences,
} from "../shared/notifications";

const db = admin.firestore();

/** The category new paid bills are filed under (mirrors quickAdd/index.ts). */
const BUDGETED_IN_CALENDAR = "Budgeted in Calendar";
/** The category a needs-category created row lands under until reviewed. */
const UNCATEGORIZED = "Uncategorized";

/**
 * Hard cap on withdrawal lines processed per request (abuse / runaway-parse
 * guard). A real nightly WF "account update" email carries ~a dozen; anything
 * beyond this is malformed or hostile input.
 *
 * Firestore batch-size proof: each withdrawal stages AT MOST 3 document writes
 * (the pay_bill branch: a paid-instance/calendar write + the transaction row +
 * the alias arrayUnion, three distinct docs). Every other branch stages 1 or 0.
 * The email also stages a fixed overhead of 2 writes (the account ending-balance
 * overwrite + the ledger record). Worst-case batch:
 *   MAX_WITHDRAWALS * 3 + 2 = 150 * 3 + 2 = 452 < 500 (Firestore's hard limit).
 * Keep this product under 500 if either factor changes. */
const MAX_WITHDRAWALS = 150;

/** Max length for bank-derived error text echoed into a push body (item 7). */
const PUSH_ERROR_MAX_LEN = 120;

/**
 * Make bank-email-derived error text safe to embed in a push body: collapse
 * control characters and newlines (so it can't smuggle multi-line content into
 * the notification) and hard-truncate. The email body itself is redacted before
 * logging; this bounds what the parser's message can leak into a push.
 */
function sanitizeForPush(text: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately strip C0/C1 controls + newlines
  const cleaned = text.replace(/[\x00-\x1F\x7F-\x9F]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > PUSH_ERROR_MAX_LEN
    ? cleaned.slice(0, PUSH_ERROR_MAX_LEN - 3) + "..."
    : cleaned;
}

/** Minimal subset of the Express/Firebase response object used below. */
interface HttpResponse {
  status(code: number): { json(body: unknown): void; send(body: string): void };
  set(header: string, value: string): void;
}

function jsonResponse(res: HttpResponse, status: number, data: Record<string, unknown>): void {
  res.status(status).json(data);
}

function errorResponse(res: HttpResponse, status: number, message: string, code: string): void {
  res.status(status).json({ success: false, message, error: { code } });
}

// Production hosting origins (see quickAdd/index.ts for the rationale). This
// endpoint is called by an Apps Script (no Origin header), so CORS is a no-op
// for it; the allowlist just bounds the blast radius if a browser ever calls it.
const ALLOWED_ORIGINS = new Set<string>([
  "https://lifebalance-26080.web.app",
  "https://lifebalance-26080.firebaseapp.com",
]);

function applyCorsHeaders(req: { headers: { origin?: string } }, res: HttpResponse): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}

/** Stable, path-safe ledger doc id for a raw Message-ID (which contains <>@). */
function ledgerDocId(messageId: string): string {
  return createHash("sha256").update(messageId).digest("hex");
}

/**
 * Fan a push out to every household member who has the `bankEmailSync`
 * preference enabled (fail-open — absent means ON) and at least one FCM token.
 * Never throws (delegates to sendNotificationToUser's own try/catch).
 */
async function pushToBankSyncMembers(
  householdId: string,
  title: string,
  body: string
): Promise<void> {
  try {
    const membersSnap = await db.collection(`households/${householdId}/members`).get();
    await Promise.all(
      membersSnap.docs.map((memberDoc) => {
        const data = memberDoc.data() as {
          fcmTokens?: string[];
          notificationPreferences?: NotificationPreferences;
        };
        const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens : [];
        if (tokens.length === 0) return Promise.resolve();
        // Fail-open opt-out: only an explicit `enabled: false` suppresses.
        if (data.notificationPreferences?.bankEmailSync?.enabled === false) {
          return Promise.resolve();
        }
        return sendNotificationToUser(tokens, title, body, { type: "bank_email_sync" }, memberDoc.ref);
      })
    );
  } catch (err) {
    logger.error("bankEmailSync: failed to send push:", err);
  }
}

export const bankEmailSync = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res) => {
    applyCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      errorResponse(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 1. Validate API key.
    const apiKey = extractApiKey(req.headers.authorization);
    if (!apiKey) {
      errorResponse(res, 401, "Missing or invalid Authorization header", "UNAUTHORIZED");
      return;
    }
    const validation = await validateApiKey(apiKey);
    if (!validation.valid || !validation.householdId) {
      errorResponse(res, 401, validation.error || "Invalid API key", "UNAUTHORIZED");
      return;
    }
    const { householdId, permissions } = validation;

    // 2. Scope check (dedicated bankSync scope).
    if (!hasScope(permissions, "bankSync")) {
      errorResponse(res, 403, "API key does not have bankSync permission", "FORBIDDEN");
      return;
    }

    // 3. Rate limit.
    const rateLimit = await checkRateLimit(householdId, "bankSync");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Body validation. `rawBody` is redacted in-place BEFORE any logApiCall
    //    (a bank email carries balances/account details that must never sit in
    //    audit logs — mirrors quickAddExpense's emailText redaction).
    const body = (req.body || {}) as Record<string, unknown>;
    const rawBody = body.rawBody;
    const subject = typeof body.subject === "string" ? body.subject : "";
    const messageId = body.messageId;
    const rawToday = body.today;

    if (req.body && typeof rawBody === "string") {
      req.body.rawBody = `[redacted email body: ${rawBody.length} chars]`;
    }

    if (typeof rawBody !== "string" || rawBody.trim() === "") {
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 400);
      errorResponse(res, 400, "rawBody is required", "BAD_REQUEST");
      return;
    }
    if (rawBody.length > 200000) {
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 400);
      errorResponse(res, 400, "rawBody too long (max 200000 chars)", "BAD_REQUEST");
      return;
    }
    if (typeof messageId !== "string" || messageId.trim() === "" || messageId.length > 500) {
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 400);
      errorResponse(res, 400, "messageId is required (max 500 chars)", "BAD_REQUEST");
      return;
    }
    const today =
      typeof rawToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
        ? rawToday
        : format(new Date(), "yyyy-MM-dd");

    // 5. Parse (deterministic; no Gemini). A parse failure sends a distinct
    //    FAILURE push and returns 200 so the Apps Script does not retry forever.
    const parsed = parseBankEmail({ subject, rawBody, today });
    if ("error" in parsed) {
      await pushToBankSyncMembers(
        householdId,
        "Bank sync failed",
        `Couldn't read last night's bank email. ${sanitizeForPush(parsed.error)}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
      jsonResponse(res, 200, {
        success: false,
        error: { code: "PARSE_FAILED" },
        message: parsed.error,
      });
      return;
    }

    // 5b. Withdrawal cap (abuse / runaway-parse guard). Anything past the cap is
    //     malformed/hostile — refuse rather than stage a giant batch. Distinct
    //     FAILURE push + structured 200 (no Apps Script retry storm).
    if (parsed.withdrawals.length > MAX_WITHDRAWALS) {
      await pushToBankSyncMembers(
        householdId,
        "Bank sync failed",
        `Bank email had ${parsed.withdrawals.length} transactions (max ${MAX_WITHDRAWALS}); skipped.`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
      jsonResponse(res, 200, {
        success: false,
        error: { code: "TOO_MANY_WITHDRAWALS" },
        message: `Withdrawal count ${parsed.withdrawals.length} exceeds max ${MAX_WITHDRAWALS}`,
      });
      return;
    }

    // Ledger doc + claim ownership are hoisted so the catch can release the
    // claim on a downstream failure (item 6).
    const ledgerRef = db.doc(
      `households/${householdId}/bankEmailSyncLedger/${ledgerDocId(messageId)}`
    );
    let claimedByUs = false;

    try {
      const householdRef = db.doc(`households/${householdId}`);
      const householdDoc = await householdRef.get();
      const householdData = householdDoc.data();
      const currency = householdData?.currency || "USD";

      // 6. Resolve the account by parsed bank-account last-4.
      const accountsSnap = await db.collection(`households/${householdId}/accounts`).get();
      const accountsForMatch = accountsSnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          accountLast4: typeof data.accountLast4 === "string" ? data.accountLast4 : undefined,
        };
      });
      const resolvedAccountId = matchAccountByAccountLast4(parsed.accountLast4, accountsForMatch);
      // Stored balanceAsOf for the resolved account (only-if-newer guard, below).
      // Reused from the already-loaded accountsSnap — no extra read.
      const resolvedAccountBalanceAsOf = (() => {
        const doc = accountsSnap.docs.find((d) => d.id === resolvedAccountId);
        const data = doc?.data() as Record<string, unknown> | undefined;
        return typeof data?.balanceAsOf === "string" ? data.balanceAsOf : undefined;
      })();
      if (!resolvedAccountId) {
        // Unknown account → WARNING push + no-op (no writes).
        await pushToBankSyncMembers(
          householdId,
          "Bank sync skipped",
          `Bank email is for account ...${parsed.accountLast4}, which isn't linked to any account in LifeBalance yet.`
        );
        await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
        jsonResponse(res, 200, {
          success: false,
          error: { code: "UNKNOWN_ACCOUNT" },
          message: `No account matches bank-account last-4 ...${parsed.accountLast4}`,
        });
        return;
      }

      // 7. Atomic idempotency claim (check-and-claim, not a plain read). A
      //    concurrent Apps Script retry racing this same Message-ID must not both
      //    pass a read and both process the email, so we claim the ledger doc in
      //    a runTransaction (create-if-absent) BEFORE loading candidates —
      //    mirroring the geminiProxy daily-quota check-and-increment pattern.
      //    On any downstream failure we DELETE our claim (see the catch) so a
      //    later retry can rerun; the successful path overwrites the claim with
      //    the full processed record in the same atomic batch (step 11).
      const claim = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ledgerRef);
        if (snap.exists) return { alreadyProcessed: true };
        tx.set(ledgerRef, {
          messageId,
          accountId: resolvedAccountId,
          status: "processing",
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return { alreadyProcessed: false };
      });
      if (claim.alreadyProcessed) {
        await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
        jsonResponse(res, 200, {
          success: true,
          skipped: true,
          alreadyProcessed: true,
          message: "This bank email was already processed.",
        });
        return;
      }
      // From here on WE own the claim; release it on any failure so a retry works.
      claimedByUs = true;

      // 8. Load candidate rows for the a→e decisions.
      // 8a. Existing bankRefs (4a dedup): one small single-field query per
      //     withdrawal ref (auto-indexed; no composite index needed).
      const refExistenceEntries = await Promise.all(
        parsed.withdrawals.map(async (w) => {
          const snap = await db
            .collection(`households/${householdId}/transactions`)
            .where("bankRef", "==", w.bankRef)
            .limit(1)
            .get();
          return [w.bankRef, !snap.empty] as const;
        })
      );
      const existingBankRefs = new Set<string>(
        refExistenceEntries.filter(([, exists]) => exists).map(([ref]) => ref)
      );

      // 8b. Pending_review transactions (single-field query) → confirm + stub
      //     candidates.
      const pendingSnap = await db
        .collection(`households/${householdId}/transactions`)
        .where("status", "==", "pending_review")
        .get();
      const pendingCandidates: PendingConfirmCandidate[] = [];
      const stubCandidates: (ReconcileCandidate & { date?: string })[] = [];
      for (const d of pendingSnap.docs) {
        const data = d.data() as Record<string, unknown>;
        const amount = typeof data.amount === "number" ? data.amount : NaN;
        if (!Number.isFinite(amount)) continue;
        const merchant = typeof data.merchant === "string" ? data.merchant : "";
        const date = typeof data.date === "string" ? data.date : today;
        const accountId = typeof data.accountId === "string" ? data.accountId : undefined;
        // accountId gates CONFIRM so a credit-card / other-account pending row is
        // never verified by this checking email (item 3).
        pendingCandidates.push({ id: d.id, amount, date, merchant, accountId });
        stubCandidates.push({
          id: d.id,
          amount,
          merchant,
          needsAmount: data.needsAmount === true,
          accountId: typeof data.accountId === "string" ? data.accountId : undefined,
          fromBankNotification: data.fromBankNotification === true,
          date,
        });
      }

      // 8c. Unpaid expense bill occurrences around the withdrawal dates.
      const dates = parsed.withdrawals.map((w) => w.date).sort();
      const minDate = dates[0] ?? today;
      const maxDate = dates[dates.length - 1] ?? today;
      const rangeStart = subDays(parseISO(minDate), 45);
      const rangeEnd = addDays(parseISO(maxDate), 5);
      const calendarSnap = await db
        .collection(`households/${householdId}/calendarItems`)
        .get();
      const calendarItems: BillCalendarItem[] = calendarSnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          title: typeof data.title === "string" ? data.title : "",
          amount: typeof data.amount === "number" ? data.amount : 0,
          date: typeof data.date === "string" ? data.date : "",
          type: data.type === "income" ? "income" : "expense",
          isPaid: data.isPaid === true,
          isRecurring: data.isRecurring === true,
          frequency:
            data.frequency === "weekly" ||
            data.frequency === "bi-weekly" ||
            data.frequency === "monthly"
              ? data.frequency
              : undefined,
          parentRecurringId:
            typeof data.parentRecurringId === "string" ? data.parentRecurringId : undefined,
          isDeleted: data.isDeleted === true,
        };
      });
      // Carry per-item bankDescriptorAliases (billMatch's shape omits it).
      const aliasByItemId = new Map<string, string[]>();
      for (const d of calendarSnap.docs) {
        const arr = (d.data() as Record<string, unknown>).bankDescriptorAliases;
        if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
          aliasByItemId.set(d.id, arr as string[]);
        }
      }
      const expandedBills = expandCalendarItems(calendarItems, rangeStart, rangeEnd).filter(
        (i) => i.type === "expense" && !i.isPaid
      );
      const billCandidates: BillPayCandidate[] = expandedBills.map((b) => {
        const recurring = isRecurringId(b.id);
        const templateId = recurring ? parseRecurringId(b.id)?.templateId : undefined;
        const aliasSourceId = templateId ?? b.id;
        return {
          id: b.id,
          templateId,
          title: b.title,
          amount: b.amount,
          date: b.date,
          isRecurringInstance: recurring,
          bankDescriptorAliases: aliasByItemId.get(aliasSourceId),
        };
      });

      // 9. Decide + stage all writes in ONE atomic batch.
      const batch = db.batch();
      const transactionsPath = `households/${householdId}/transactions`;
      const calendarPath = `households/${householdId}/calendarItems`;
      const counts = { created: 0, confirmed: 0, filled: 0, billsPaid: 0, skipped: 0 };

      // Mutable candidate pools: once a withdrawal CONSUMES a stub/pending/bill,
      // it is pruned so a second withdrawal in the SAME email can't be routed to
      // the same target (which would let the last batch write win and silently
      // drop a real transaction). The displaced withdrawal then falls through the
      // remaining a→e steps (ultimately CREATE) — item 2.
      let stubPool: (ReconcileCandidate & { date?: string })[] = stubCandidates;
      let pendingPool: PendingConfirmCandidate[] = pendingCandidates;
      let billPool: BillPayCandidate[] = billCandidates;

      for (const w of parsed.withdrawals) {
        const decision = decideWithdrawal({
          withdrawal: w,
          existingBankRefs,
          stubs: stubPool,
          pendingCandidates: pendingPool,
          billCandidates: billPool,
          resolvedAccountId,
        });

        // Guard against two withdrawal lines racing onto the same target/ref
        // within this email (parser guarantees unique refs, but be defensive).
        existingBankRefs.add(w.bankRef);

        const payPeriodId = getPayPeriodForTransaction(w.date, householdData?.lastPaycheckDate);

        switch (decision.kind) {
          case "skip_bankref": {
            counts.skipped++;
            break;
          }
          case "fill_stub": {
            // Fill the Apple Pay $0 stub AND mark it verified in this same email
            // (item 1): the ending-balance overwrite is authoritative, so a
            // filled stub must become verified here (no balance delta) — leaving
            // it pending_review would let a later client categorize double-debit
            // it (verified delta) and double-count it in Safe-to-Spend. accountId
            // is stamped by buildFillUpdates from the resolved account.
            batch.update(db.doc(`${transactionsPath}/${decision.stubId}`), {
              ...buildFillUpdates({
                amount: w.amount,
                merchant: w.descriptor,
                accountId: resolvedAccountId,
              }),
              status: "verified",
              bankRef: w.bankRef,
            });
            // Prune the consumed stub from BOTH pools (a stub is also a pending
            // doc) so no other withdrawal can target it.
            stubPool = stubPool.filter((s) => s.id !== decision.stubId);
            pendingPool = pendingPool.filter((p) => p.id !== decision.stubId);
            counts.filled++;
            break;
          }
          case "confirm_pending": {
            // Verify only — NO balance delta (ending-balance overwrite is
            // authoritative). Stamp bankRef for idempotency and stamp the
            // resolved account so the row is anchored to THIS account (item 3).
            batch.update(db.doc(`${transactionsPath}/${decision.transactionId}`), {
              status: "verified",
              bankRef: w.bankRef,
              accountId: resolvedAccountId,
            });
            // Prune the consumed pending row from BOTH pools (item 2).
            pendingPool = pendingPool.filter((p) => p.id !== decision.transactionId);
            stubPool = stubPool.filter((s) => s.id !== decision.transactionId);
            counts.confirmed++;
            break;
          }
          case "pay_bill": {
            const { bill, matchedByAlias } = decision.match;
            const paidAmount = Math.round(w.amount * 100) / 100;
            // Retro-file under the bill's DUE-date pay period (mirrors the client
            // payCalendarItem convention), NOT the withdrawal clearing date — an
            // overdue June bill paid by a July email files under June (item 4).
            const billPayPeriodId = getBillPayPeriodId(
              bill.date,
              householdData?.lastPaycheckDate,
              calendarItems as PaidIncomeLike[]
            );
            // Prune the consumed bill so a second withdrawal can't re-pay it (item 2).
            billPool = billPool.filter((b) => b.id !== bill.id);
            if (bill.isRecurringInstance && bill.templateId) {
              // Recurring occurrence → paid-instance record (suppresses the
              // synthetic occurrence on future expansions).
              batch.set(db.collection(calendarPath).doc(), {
                title: bill.title,
                amount: paidAmount,
                date: bill.date,
                type: "expense",
                isPaid: true,
                isRecurring: false,
                parentRecurringId: bill.templateId,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            } else {
              batch.update(db.doc(`${calendarPath}/${bill.id}`), {
                isPaid: true,
                amount: paidAmount,
              });
            }
            // Verified transaction dated to the bill's due date. NO balance
            // delta (ending-balance overwrite is authoritative).
            batch.set(db.collection(transactionsPath).doc(), {
              amount: paidAmount,
              merchant: bill.title,
              category: BUDGETED_IN_CALENDAR,
              date: bill.date,
              status: "verified",
              isRecurring: bill.isRecurringInstance,
              source: "bank-sync",
              autoCategorized: true,
              payPeriodId: billPayPeriodId,
              accountId: resolvedAccountId,
              bankRef: w.bankRef,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            // Learn the descriptor as an alias when matched by token-overlap
            // (not when it already matched an alias). Write onto the template
            // for a recurring occurrence, else the item itself.
            if (!matchedByAlias) {
              const aliasTargetId = bill.templateId ?? bill.id;
              batch.update(db.doc(`${calendarPath}/${aliasTargetId}`), {
                bankDescriptorAliases: admin.firestore.FieldValue.arrayUnion(w.descriptor),
              });
            }
            counts.billsPaid++;
            break;
          }
          case "create": {
            // Born verified (the account balance is authoritative from the
            // email), flagged needsCategory so it surfaces for bucket
            // assignment in review WITHOUT a balance delta on categorize.
            batch.set(db.collection(transactionsPath).doc(), {
              amount: Math.round(w.amount * 100) / 100,
              merchant: w.descriptor,
              category: UNCATEGORIZED,
              date: w.date,
              status: "verified",
              isRecurring: false,
              source: "bank-sync",
              autoCategorized: false,
              needsCategory: true,
              payPeriodId,
              accountId: resolvedAccountId,
              bankRef: w.bankRef,
              ...(w.cardLast4 ? { cardLast4Hint: w.cardLast4 } : {}),
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            counts.created++;
            break;
          }
        }
      }

      // 10. Overwrite the account balance with the email's AVAILABLE balance
      //     (posted ending balance minus authorized-but-unposted holds) —
      //     but ONLY if this email is not older than the last one we applied.
      //     A first-install backfill (or any retry storm) can deliver several
      //     historical emails out of order; without this guard the LAST batch
      //     write wins regardless of which email is actually newest. The
      //     email's "balance as-of" date prefers the email's OWN stated date
      //     (`parsed.asOf`, from its "As of MM/DD/YYYY" footer) — falling back
      //     to the latest withdrawal date, and only then to `today` — see
      //     `computeBalanceAsOf`'s doc comment for why `today` must be last.
      const incomingBalanceAsOf = computeBalanceAsOf(
        parsed.withdrawals.map((w) => w.date),
        today,
        parsed.asOf
      );
      const balanceSkipped = shouldSkipBalanceOverwrite(
        resolvedAccountBalanceAsOf,
        incomingBalanceAsOf
      );
      if (balanceSkipped) {
        logger.info(
          `bankEmailSync: skipping balance overwrite for account ${resolvedAccountId} — ` +
            `stored balanceAsOf ${resolvedAccountBalanceAsOf} is newer than incoming ${incomingBalanceAsOf} ` +
            `(out-of-order email, messageId ${messageId})`
        );
      } else {
        batch.update(db.doc(`households/${householdId}/accounts/${resolvedAccountId}`), {
          ...buildBalanceUpdate(parsed.availableBalance),
          balanceAsOf: incomingBalanceAsOf,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 11. Record the ledger entry so re-runs of this Message-ID short-circuit.
      batch.set(ledgerRef, {
        messageId,
        accountId: resolvedAccountId,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        endingBalance: parsed.endingBalance,
        availableBalance: parsed.availableBalance,
        counts,
      });

      await batch.commit();
      // The batch (which OVERWRITES the ledger claim with the durable processed
      // record) has committed. Disown the claim NOW so a failure in the
      // post-commit steps below (push / logApiCall / response) can never reach
      // the catch's delete and wipe the durably-written ledger entry — a
      // structural guarantee, not a reliance on those helpers swallowing errors.
      claimedByUs = false;

      // 12. Summary push + response.
      const balanceSummary = balanceSkipped
        ? "Balance: unchanged (older email, out of order)"
        : `Balance: ${formatCurrency(parsed.availableBalance, { currency })}`;
      await pushToBankSyncMembers(
        householdId,
        "Bank sync complete",
        `${counts.created} new, ${counts.confirmed} confirmed, ${counts.filled} filled, ` +
          `${counts.billsPaid} bills paid. ${balanceSummary}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
      jsonResponse(res, 200, {
        success: true,
        message: "Bank email processed.",
        data: {
          accountId: resolvedAccountId,
          endingBalance: parsed.endingBalance,
          availableBalance: parsed.availableBalance,
          withdrawals: parsed.withdrawals.length,
          balanceSkipped,
          ...counts,
        },
      });
    } catch (error) {
      logger.error("Error in bankEmailSync:", error);
      // Release our idempotency claim so a later Apps Script retry can reprocess
      // this Message-ID. `claimedByUs` is only still true when the failure struck
      // BEFORE batch.commit() (it is flipped false the instant the batch commits),
      // so this can never delete a durably-written ledger record — it only ever
      // clears a pre-commit "processing" claim, and never one already processed.
      if (claimedByUs) {
        await ledgerRef.delete().catch((delErr) => {
          logger.error("bankEmailSync: failed to release idempotency claim:", delErr);
        });
      }
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);
