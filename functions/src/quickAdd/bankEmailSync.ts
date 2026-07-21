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
  buildEndingBalanceUpdate,
  matchAccountByAccountLast4,
  type PendingConfirmCandidate,
  type BillPayCandidate,
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
        `Couldn't read last night's bank email. ${parsed.error}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
      jsonResponse(res, 200, {
        success: false,
        error: { code: "PARSE_FAILED" },
        message: parsed.error,
      });
      return;
    }

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

      // 7. messageId ledger fast-skip (idempotent re-runs).
      const ledgerRef = db.doc(
        `households/${householdId}/bankEmailSyncLedger/${ledgerDocId(messageId)}`
      );
      const ledgerDoc = await ledgerRef.get();
      if (ledgerDoc.exists) {
        await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
        jsonResponse(res, 200, {
          success: true,
          skipped: true,
          alreadyProcessed: true,
          message: "This bank email was already processed.",
        });
        return;
      }

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
        pendingCandidates.push({ id: d.id, amount, date, merchant });
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

      for (const w of parsed.withdrawals) {
        const decision = decideWithdrawal({
          withdrawal: w,
          existingBankRefs,
          stubs: stubCandidates,
          pendingCandidates,
          billCandidates,
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
            batch.update(db.doc(`${transactionsPath}/${decision.stubId}`), {
              ...buildFillUpdates({
                amount: w.amount,
                merchant: w.descriptor,
                accountId: resolvedAccountId,
              }),
              bankRef: w.bankRef,
            });
            counts.filled++;
            break;
          }
          case "confirm_pending": {
            // Verify only — NO balance delta (ending-balance overwrite is
            // authoritative). Stamp bankRef for idempotency.
            batch.update(db.doc(`${transactionsPath}/${decision.transactionId}`), {
              status: "verified",
              bankRef: w.bankRef,
            });
            counts.confirmed++;
            break;
          }
          case "pay_bill": {
            const { bill, matchedByAlias } = decision.match;
            const paidAmount = Math.round(w.amount * 100) / 100;
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
                source: "shortcut",
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
              source: "shortcut",
              autoCategorized: true,
              payPeriodId,
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
              source: "shortcut",
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

      // 10. Overwrite the account balance with the email's ending balance.
      batch.update(db.doc(`households/${householdId}/accounts/${resolvedAccountId}`), {
        ...buildEndingBalanceUpdate(parsed.endingBalance),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 11. Record the ledger entry so re-runs of this Message-ID short-circuit.
      batch.set(ledgerRef, {
        messageId,
        accountId: resolvedAccountId,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        endingBalance: parsed.endingBalance,
        counts,
      });

      await batch.commit();

      // 12. Summary push + response.
      await pushToBankSyncMembers(
        householdId,
        "Bank sync complete",
        `${counts.created} new, ${counts.confirmed} confirmed, ${counts.filled} filled, ` +
          `${counts.billsPaid} bills paid. Balance: ${formatCurrency(parsed.endingBalance, { currency })}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 200);
      jsonResponse(res, 200, {
        success: true,
        message: "Bank email processed.",
        data: {
          accountId: resolvedAccountId,
          endingBalance: parsed.endingBalance,
          withdrawals: parsed.withdrawals.length,
          ...counts,
        },
      });
    } catch (error) {
      logger.error("Error in bankEmailSync:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "bankSync", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);
