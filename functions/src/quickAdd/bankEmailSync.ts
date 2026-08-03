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
 * Merchant rules (F-MONEY-14) modulate three of those outcomes and nothing else:
 * a rule's `billId` can name the bill a charge pays (step d, bypassing the amount
 * tolerance — an explicit link is not a guess), a rule's `category` files a new
 * row instead of leaving it for review (step e), and a rule's `exempt` flag stops
 * a charge breaking the no-spend day. They never touch steps a-c, which ask an
 * IDENTITY question, and — the invariant this whole feature rests on — a rule's
 * friendly NAME is never written into a stored `merchant`. The raw bank
 * descriptor stays the transaction's permanent identity key.
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
 * No-new-information guard: the ordering guard above is defeated by the
 * email's own format — its "As of" date is a SEND TIMESTAMP that advances
 * every morning regardless of whether the bank posted anything, so a stale,
 * information-free email (zero withdrawals, byte-identical balances) can
 * still carry a footer date that beats the stored one. A second, independent
 * check (`emailAddsNothingNew` in bankSyncMatch.ts) also skips the overwrite
 * when the email parses to zero withdrawals AND both balances are cent-exact
 * repeats of `Account.lastSyncedAvailableBalance`/`lastSyncedEndingBalance` —
 * the figures the last email that actually wrote `balance` recorded. Compared
 * against those dedicated fields rather than `Account.balance` itself, since
 * `balance` legitimately drifts from the email's figure as the user reviews
 * transactions client-side — the very state this guard exists to protect.
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
  buildCreateCardLast4Update,
  matchAccountByAccountLast4,
  getBillPayPeriodId,
  computeBalanceAsOf,
  shouldSkipBalanceOverwrite,
  emailAddsNothingNew,
  CONFIRM_DATE_TOLERANCE_DAYS,
  isVerifiedConfirmCandidate,
  type PendingConfirmCandidate,
  type BillPayCandidate,
  type PaidIncomeLike,
} from "./bankSyncMatch";
import {
  sendNotificationToUser,
  type NotificationPreferences,
} from "../shared/notifications";
import {
  BUDGETED_IN_CALENDAR as NO_SPEND_BILL_CATEGORY,
  datesToJudge,
  noSpendCatchupWindow,
  type SpendCandidate,
} from "./noSpendDay";
import {
  applyNoSpendDay,
  type NoSpendFreezeRefundNote,
  type NoSpendHabitFire,
  type NoSpendOutcome,
  type StagedNoSpendFire,
} from "./noSpendFire";
import { pickMerchantRule } from "./merchantRules";
import {
  describeRuleEffects,
  emptyRuleEffectCounts,
  readMerchantRules,
  ruleCreateCategory,
  ruleExemptedCharge,
} from "./merchantRuleEffects";

const db = admin.firestore();

/** The category new paid bills are filed under (mirrors quickAdd/index.ts).
 *  Imported from noSpendDay rather than redeclared so the two files that must
 *  agree about what a "planned" charge looks like cannot drift apart. */
const BUDGETED_IN_CALENDAR = NO_SPEND_BILL_CATEGORY;
/** The category a needs-category created row lands under until reviewed. */
const UNCATEGORIZED = "Uncategorized";

/**
 * Hard cap on withdrawal lines processed per request (abuse / runaway-parse
 * guard). A real nightly WF "account update" email carries roughly a dozen
 * lines — the largest ever observed in production is 16 — so this cap is a
 * huge margin over anything a legitimate email needs; anything beyond it is
 * malformed or hostile input.
 *
 * Firestore batch-size proof: each withdrawal stages AT MOST 3 document writes
 * (the pay_bill branch: a paid-instance/calendar write + the transaction row +
 * the alias arrayUnion, three distinct docs). Every other branch stages 1 or 0.
 * The email also stages a fixed overhead of 2 writes (the account ending-balance
 * overwrite + the ledger record), plus the no-spend catch-up term (one email
 * can now judge several unjudged days — see noSpendDay.ts's `datesToJudge`):
 *   - PER JUDGED DAY, up to `MAX_NO_SPEND_CATCHUP_DAYS` (4) of them: at most
 *     1 (the verdict doc) + `MAX_NO_SPEND_HABITS * 2` (a habit-doc update +
 *     a submission-doc set, per fired habit) = 1 + 20 = 21 — see
 *     noSpendFire.ts's `MAX_NO_SPEND_HABITS` doc for why this figure is
 *     per-day, not per-email.
 *   - PLUS exactly 1 more: the household update (points + freezeBank) is
 *     staged ONCE for the WHOLE EMAIL, after the judging loop — not once per
 *     day. `applyNoSpendDay` never writes the household doc itself (a
 *     per-day write there was the actual bug a stale-snapshot freezeBank
 *     clobber came from); see `NoSpendOutcome.freezeTokensRefunded`'s doc in
 *     noSpendFire.ts.
 * Worst-case batch:
 *   MAX_WITHDRAWALS * 3 + 2
 *     + (MAX_NO_SPEND_CATCHUP_DAYS * (1 + MAX_NO_SPEND_HABITS * 2) + 1)
 *   = 100 * 3 + 2 + (4 * (1 + 20) + 1)
 *   = 300 + 2 + (84 + 1)
 *   = 300 + 2 + 85
 *   = 387 < 500 (the hard limit).
 * Each term is kept separate so any one factor can be changed independently:
 * withdrawals, the fixed email overhead, the per-day catch-up cost, and the
 * single whole-email household write.
 *
 * `MAX_WITHDRAWALS` was deliberately lowered from 150 to 100 to buy headroom
 * for the catch-up window — see the paragraph above for why 100 is still an
 * enormous margin over what a real email ever carries. */
const MAX_WITHDRAWALS = 100;

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

/**
 * The habit half of a no-spend push, as a sentence fragment ending in a space
 * (or "" when nothing fired). Kept short deliberately: iOS truncates a push
 * body, and the balance that follows must survive.
 *
 * The streak is described as "N in a row" rather than "N-day": a weekend habit
 * is weekly-cadence, so its streak counts weeks, and one phrasing has to be
 * right for both.
 *
 * Takes just `fired` (not a full `NoSpendOutcome`) so the caller can pass a
 * list POOLED across every day a catch-up email judged, not only the most
 * recent one — a fire on an earlier settled day must still show up here even
 * when the day that determines the push title is a different, later day.
 */
function describeNoSpendFires(outcome: { fired: NoSpendHabitFire[] }): string {
  const { fired } = outcome;
  if (fired.length === 0) return "Nothing unplanned left your account. ";
  if (fired.length === 1) {
    const f = fired[0]!;
    const pts =
      f.pointsEarned !== 0 ? ` ${f.pointsEarned > 0 ? "+" : ""}${f.pointsEarned} pts` : "";
    const streak = f.streak > 1 ? `, ${f.streak} in a row` : "";
    return `${f.title} logged${pts}${streak}. `;
  }
  const total = fired.reduce((sum, f) => sum + f.pointsEarned, 0);
  const pts = total !== 0 ? ` ${total > 0 ? "+" : ""}${total} pts` : "";
  return `${fired.length} habits logged${pts}. `;
}

/** The subset of `counts` the ordinary sync tally reads. */
export interface SyncTallyCounts {
  created: number;
  confirmed: number;
  filled: number;
  billsPaid: number;
}

/**
 * The ordinary "N new, N confirmed, N filled, N bills paid." tally.
 *
 * `condensed: false` (the historical shape) always lists all four categories,
 * even the zero ones — kept exactly as before so a run with no fires-sentence
 * to share the body with is byte-for-byte unchanged.
 *
 * `condensed: true` drops zero categories and singularizes "1 bill paid" —
 * used ONLY when a fires sentence is also going into the same push body (see
 * `composeBankSyncSummaryBody`), so two full sentences plus the balance don't
 * risk running past what iOS renders before truncating. Returns "" when every
 * count is zero (a quiet email whose only news is the fires sentence).
 */
function describeSyncCounts(counts: SyncTallyCounts, condensed: boolean): string {
  if (!condensed) {
    return (
      `${counts.created} new, ${counts.confirmed} confirmed, ${counts.filled} filled, ` +
      `${counts.billsPaid} bills paid. `
    );
  }
  const parts: string[] = [];
  if (counts.created > 0) parts.push(`${counts.created} new`);
  if (counts.confirmed > 0) parts.push(`${counts.confirmed} confirmed`);
  if (counts.filled > 0) parts.push(`${counts.filled} filled`);
  if (counts.billsPaid > 0) {
    parts.push(`${counts.billsPaid} bill${counts.billsPaid === 1 ? "" : "s"} paid`);
  }
  return parts.length === 0 ? "" : `${parts.join(", ")}. `;
}

/**
 * Compose the push (and ledger/response) summary body from the aggregated
 * multi-day no-spend outcome. Pure — no Firestore, no dates — so it's unit
 * tested directly in `bankEmailSync.test.ts`.
 *
 * THE BUG THIS FUNCTION FIXES: with a catch-up window judging several days
 * per email, the MOST RECENT judged day can be dirty (today's charge) even
 * though an EARLIER judged day in the same run was clean and fired a habit
 * (a "No spend weekend" that a Monday purchase doesn't retroactively undo).
 * The push must still announce that fire — silently omitting it means a
 * habit fires and earns points with nobody told.
 *
 * The trap: `describeNoSpendFires` returns "Nothing unplanned left your
 * account. " when `fired` is empty. That's a TRUE statement on a day that
 * really was clean (the `mostRecentIsNoSpendDay` branch below, unchanged from
 * before this fix), but it would be a FALSE CLAIM prepended to the dirty
 * branch — the most recent day demonstrably was NOT clean. So the dirty
 * branch only ever gets a fires sentence when `allFired` is non-empty (some
 * OTHER judged day in this run fired something), and never calls the
 * unconditional form.
 */
export function composeBankSyncSummaryBody(params: {
  mostRecentIsNoSpendDay: boolean;
  allFired: NoSpendHabitFire[];
  counts: SyncTallyCounts;
  ruleSummary: string;
  balanceSummary: string;
}): string {
  const { mostRecentIsNoSpendDay, allFired, counts, ruleSummary, balanceSummary } = params;
  if (mostRecentIsNoSpendDay) {
    return `${describeNoSpendFires({ fired: allFired })}${ruleSummary}${balanceSummary}`;
  }
  const firesSummary = allFired.length > 0 ? describeNoSpendFires({ fired: allFired }) : "";
  // Condensed only when actually sharing the body with a fires sentence —
  // the common dirty-with-no-catch-up-fires case keeps the exact pre-fix text.
  const countsSummary = describeSyncCounts(counts, firesSummary.length > 0);
  return `${firesSummary}${countsSummary}${ruleSummary}${balanceSummary}`;
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
      // Household-authored merchant rules (F-MONEY-14). They drive three
      // CLASSIFICATION decisions below — which bill a charge pays, what category
      // a new row is born with, and whether a charge breaks a no-spend day — and
      // no more than that. Nothing here may write `rule.name` into a stored
      // `merchant`: the raw bank descriptor is the transaction's identity key,
      // which is what makes a rule retroactive, reversible and auditable.
      const merchantRules = readMerchantRules(householdData?.merchantRules);

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
      // Stored balanceAsOf + last-synced balance figures for the resolved
      // account (the only-if-newer guard and the no-new-information guard,
      // both applied at step 10 below). Reused from the already-loaded
      // accountsSnap — no extra read.
      const resolvedAccountSyncState = (() => {
        const doc = accountsSnap.docs.find((d) => d.id === resolvedAccountId);
        const data = doc?.data() as Record<string, unknown> | undefined;
        return {
          balanceAsOf: typeof data?.balanceAsOf === "string" ? data.balanceAsOf : undefined,
          lastSyncedAvailableBalance:
            typeof data?.lastSyncedAvailableBalance === "number"
              ? data.lastSyncedAvailableBalance
              : undefined,
          lastSyncedEndingBalance:
            typeof data?.lastSyncedEndingBalance === "number"
              ? data.lastSyncedEndingBalance
              : undefined,
        };
      })();
      const resolvedAccountBalanceAsOf = resolvedAccountSyncState.balanceAsOf;
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
          // CARD-1 (finding 1): so buildFillUpdates below can tell whether
          // this stub already carries a card digit before deciding whether
          // an incoming one is safe to write — mirrors index.ts's
          // reconcileCandidates construction (the quickAddExpense endpoint).
          cardLast4: typeof data.cardLast4 === "string" ? data.cardLast4 : undefined,
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

      // 8d. ALREADY-VERIFIED confirm candidates — the reviewed-row blind spot.
      //
      // 8b loads only `pending_review` rows, which silently made review speed
      // the enemy of correctness: the moment a user reviews an Apple Pay /
      // Shortcut capture it becomes `verified` and vanishes from the confirm
      // pool, so the bank email that arrives AFTERWARDS cannot recognise the
      // purchase and files a second copy of it. In production this never once
      // matched — every ledger entry since activation reads `confirmed: 0,
      // filled: 0`, with every line falling through to CREATE.
      //
      // Reviewing a row does not change WHAT it is, so a verified row is an
      // equally valid CONFIRM target — see `isVerifiedConfirmCandidate` for
      // the eligibility rule and every exclusion it makes. No balance
      // consequence: CONFIRM applies no delta in either direction (the email's
      // available balance is authoritative), so re-marking an already-verified
      // row `verified` moves no money; the write that matters is the `bankRef`.
      //
      // The `pending_review` pool keeps its own unbounded status query; this
      // one is date-windowed to the confirm tolerance so it stays a small read
      // on an auto-indexed single field, needing no composite index.
      if (parsed.withdrawals.length > 0) {
        const confirmStart = format(
          subDays(parseISO(minDate), CONFIRM_DATE_TOLERANCE_DAYS),
          "yyyy-MM-dd"
        );
        const confirmEnd = format(
          addDays(parseISO(maxDate), CONFIRM_DATE_TOLERANCE_DAYS),
          "yyyy-MM-dd"
        );
        const verifiedSnap = await db
          .collection(`households/${householdId}/transactions`)
          .where("date", ">=", confirmStart)
          .where("date", "<=", confirmEnd)
          .get();
        for (const d of verifiedSnap.docs) {
          const data = d.data() as Record<string, unknown>;
          if (!isVerifiedConfirmCandidate(data)) continue;
          pendingCandidates.push({
            id: d.id,
            amount: data.amount as number,
            date: typeof data.date === "string" ? data.date : today,
            merchant: typeof data.merchant === "string" ? data.merchant : "",
            accountId: typeof data.accountId === "string" ? data.accountId : undefined,
          });
        }
      }

      // 8e. F-HABITS-14 catch-up window — which of the last
      //     MAX_NO_SPEND_CATCHUP_DAYS days (the email's as-of date minus 1
      //     through minus that many) still need a no-spend verdict. Bounded,
      //     small doc-id gets (no composite index needed) — see
      //     noSpendDay.ts's `datesToJudge` for why "already judged" means
      //     "already has a verdict doc" (a dirty day never gets one, so it is
      //     correctly re-judged every night until it finally comes back
      //     clean).
      const noSpendAsOf = parsed.asOf ?? today;
      const noSpendWindow = noSpendCatchupWindow(noSpendAsOf);
      const existingNoSpendVerdicts = await Promise.all(
        noSpendWindow.map((date) => db.doc(`households/${householdId}/noSpendDays/${date}`).get())
      );
      const alreadyJudgedNoSpendDates = new Set<string>(
        existingNoSpendVerdicts.filter((d) => d.exists).map((d) => d.id)
      );
      const noSpendDatesToJudge = datesToJudge(noSpendAsOf, alreadyJudgedNoSpendDates);
      const noSpendDatesToJudgeSet = new Set(noSpendDatesToJudge);

      // 9. Decide + stage all writes in ONE atomic batch.
      const batch = db.batch();
      const transactionsPath = `households/${householdId}/transactions`;
      const calendarPath = `households/${householdId}/calendarItems`;
      const counts = {
        created: 0,
        confirmed: 0,
        filled: 0,
        billsPaid: 0,
        skipped: 0,
        // What the household's rules actually did to this email — reported in
        // the response, the ledger and the push, so a rule's effect is visible
        // rather than something the user has to infer from the ledger diff.
        ...emptyRuleEffectCounts(),
      };

      // Mutable candidate pools: once a withdrawal CONSUMES a stub/pending/bill,
      // it is pruned so a second withdrawal in the SAME email can't be routed to
      // the same target (which would let the last batch write win and silently
      // drop a real transaction). The displaced withdrawal then falls through the
      // remaining a→e steps (ultimately CREATE) — item 2.
      let stubPool: (ReconcileCandidate & { date?: string })[] = stubCandidates;
      let pendingPool: PendingConfirmCandidate[] = pendingCandidates;
      let billPool: BillPayCandidate[] = billCandidates;

      // F-HABITS-14 — spend this email is about to record, PER JUDGED DAY,
      // that the transactions query inside applyNoSpendDay cannot possibly
      // see: the CREATE branch, and only the CREATE branch. Keyed by date
      // (rather than a single list) because one email can now judge several
      // days at once (the catch-up window above) — a Saturday charge this
      // email CREATEs must be declared to SATURDAY's judgement specifically,
      // never folded into whichever day happens to be judged last.
      //
      // Every other decision resolves to a row that ALREADY EXISTS, and that row
      // is the authoritative record of the purchase — including its category and
      // its `creditPayment` flag, which is exactly what decides whether it counts
      // against a no-spend day. Re-declaring one here would strip that metadata
      // (this list can only guess `Uncategorized`) and the un-exempt copy would
      // disqualify a day the real row is exempt from: a confirmed credit-card
      // payment, or a pending row already categorized as a bill, would each break
      // a day they should not. Declaring only new rows keeps ONE representation of
      // every purchase, so the day's verdict always agrees with the transaction
      // list the user can actually see for that date.
      //
      // The trade-off, deliberately taken: a fill/confirm does not re-date the row
      // it targets, so a purchase the bank authorizes on the target day whose
      // stored row is dated earlier (an Apple Pay stub captured Wednesday for a
      // charge authorized Thursday) counts against the row's own date, not the
      // authorization date. One purchase still breaks exactly one day, and it
      // breaks the day the app shows it on — a day whose visible transaction list
      // is empty is never reported as spent.
      const noSpendExtraSpendByDate = new Map<string, SpendCandidate[]>();

      for (const w of parsed.withdrawals) {
        const decision = decideWithdrawal({
          withdrawal: w,
          existingBankRefs,
          stubs: stubPool,
          pendingCandidates: pendingPool,
          billCandidates: billPool,
          resolvedAccountId,
          merchantRules,
        });

        // Guard against two withdrawal lines racing onto the same target/ref
        // within this email (parser guarantees unique refs, but be defensive).
        existingBankRefs.add(w.bankRef);

        // The one rule that wins this descriptor+amount, shared by the create
        // branch and the reporting counters below. `pickBillToPay` resolves it
        // independently for the bill tier rather than taking it as an argument,
        // so a given line matches twice — the function is pure and total on the
        // same inputs, so the two always agree, and a nightly batch of a few
        // dozen lines against a bounded rule list makes the cost irrelevant.
        // Threading it through `decideWithdrawal` would put a caller-supplied
        // rule into a signature whose other steps must never see one.
        const rule = pickMerchantRule(w.descriptor, w.amount, merchantRules);
        // Counts CHARGES IN THIS EMAIL whose exemption the rule actually earned
        // — a statement about the withdrawal lines, whose descriptors are the
        // raw text the rule matched. It is not a count of rows the day's verdict
        // exempted: that set also includes rows stored on earlier nights (the
        // whole point of exemption reaching the loaded query). See
        // `ruleExemptedCharge` for which decisions are excluded and why the
        // three counters have to stay disjoint.
        if (ruleExemptedCharge(rule, decision.kind)) {
          counts.ruleExempted++;
        }
        // The category a brand-new row would be born with — needed BEFORE the
        // switch because the no-spend declaration below has to describe the row
        // this email is about to write, not a guess at it.
        const createCategory = ruleCreateCategory(rule, UNCATEGORIZED);

        // Declare a BRAND-NEW row landing on a day THIS EMAIL is actually
        // going to judge to that day's no-spend judgement — only a `create`
        // decision qualifies (see `shouldDeclareToNoSpend`'s doc in
        // noSpendDay.ts for the full reasoning: every other decision
        // resolves to a row that already exists and is already authoritative
        // about its own exemption status). It carries the rule's category so
        // the declaration and the stored row are the same row: a rule filing
        // a charge as e.g. a card payment must exempt it here exactly as the
        // stored row will be exempted tomorrow. (A rule's `exempt` flag is
        // honoured independently — `spendExemption` re-derives it from the
        // raw merchant, which this row carries.)
        //
        // Tested directly on `decision.kind` rather than through
        // `shouldDeclareToNoSpend(decision.kind, w.date, targetDate)`: that
        // function's date-equality check made sense when one email judged a
        // single target date, but a withdrawal can now be declared to any of
        // several judged days, so ALL date scoping lives in the
        // `noSpendDatesToJudgeSet.has(w.date)` check below — passing `w.date`
        // as both of the helper's date arguments would make its own
        // `withdrawalDate !== targetDate` guard permanently false (never
        // taken), silently degrading it to this exact `kind === "create"`
        // test while reading as if it still filtered by date. Calling it out
        // directly here is the honest version of that.
        if (noSpendDatesToJudgeSet.has(w.date) && decision.kind === "create") {
          const entry: SpendCandidate = {
            amount: w.amount,
            merchant: w.descriptor,
            category: createCategory.category,
          };
          const existing = noSpendExtraSpendByDate.get(w.date);
          if (existing) existing.push(entry);
          else noSpendExtraSpendByDate.set(w.date, [entry]);
        }

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
            //
            // CARD-1 (finding 1): this is the LIVE nightly Wells Fargo sync path
            // — the primary way this household's transactions arrive — so it
            // must thread cardLast4 through exactly like the quickAddExpense
            // endpoint does. `fillTargetStub` is looked up from the pool
            // `decision.stubId` was chosen from (pickFillTarget, inside
            // decideWithdrawal) so buildFillUpdates can see whatever cardLast4
            // the stub already carries; `fromBankNotification: true` because
            // every withdrawal in this loop was parsed out of the bank's own
            // email — that's "bank wins" the cardLast4 conflict policy (finding
            // 3), matching the quickAddExpense endpoint's `fromBankNotification`
            // gate on this same call.
            const fillTargetStub = stubPool.find((s) => s.id === decision.stubId);
            batch.update(db.doc(`${transactionsPath}/${decision.stubId}`), {
              ...buildFillUpdates(
                {
                  amount: w.amount,
                  merchant: w.descriptor,
                  accountId: resolvedAccountId,
                  cardLast4: w.cardLast4,
                  fromBankNotification: true,
                },
                fillTargetStub
              ),
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
            //
            // The target may ALREADY be verified (see 8d): a row the user
            // reviewed before this email arrived is still the same purchase.
            // Re-writing `verified` onto it is a no-op; the write that matters
            // is the `bankRef`, which is what stops a later email creating a
            // duplicate of a row someone had already dealt with.
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
            const { bill, matchedBy } = decision.match;
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
            // Learn the descriptor as an alias ONLY for a token-overlap match —
            // the guess we want to stop having to make again. An alias match
            // already knows it, and a RULE match is already recorded by the rule
            // the household wrote: learning an alias too would create a second,
            // redundant source of truth that survives deleting the rule, so the
            // link could not be undone by undoing the thing that made it.
            // Write onto the template for a recurring occurrence, else the item.
            if (matchedBy === "token") {
              const aliasTargetId = bill.templateId ?? bill.id;
              batch.update(db.doc(`${calendarPath}/${aliasTargetId}`), {
                bankDescriptorAliases: admin.firestore.FieldValue.arrayUnion(w.descriptor),
              });
            }
            counts.billsPaid++;
            if (matchedBy === "rule") counts.ruleBilled++;
            break;
          }
          case "create": {
            // Born verified (the account balance is authoritative from the
            // email), and flagged needsCategory so it surfaces for bucket
            // assignment in review WITHOUT a balance delta on categorize —
            // UNLESS a merchant rule already names the category, in which case
            // the row is filed there and `needsCategory` is omitted (the
            // household has answered that question already). See
            // `ruleCreateCategory`.
            //
            // `merchant` is the RAW bank descriptor, always. A rule's friendly
            // name is applied at render time and must never be persisted here.
            batch.set(db.collection(transactionsPath).doc(), {
              amount: Math.round(w.amount * 100) / 100,
              merchant: w.descriptor,
              date: w.date,
              status: "verified",
              isRecurring: false,
              source: "bank-sync",
              ...createCategory,
              payPeriodId,
              accountId: resolvedAccountId,
              bankRef: w.bankRef,
              ...buildCreateCardLast4Update(w.cardLast4),
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            counts.created++;
            if (createCategory.autoCategorized) counts.ruleCategorized++;
            break;
          }
        }
      }

      // 9b. F-HABITS-14 — judge EVERY day the catch-up window left unsettled
      //     (ascending), firing any habit wired to the no-spend trigger onto
      //     this same batch. Runs on EVERY sync, not just a zero-withdrawal
      //     one: a day whose only withdrawals were scheduled bills or
      //     transfers is still a no-spend day. Never throws — a habit-side
      //     problem must not fail a money sync that succeeded.
      //
      //     `stagedCleanDates` accumulates every day THIS loop has already
      //     judged clean, so when the SAME email settles both Saturday and
      //     Sunday, Sunday's weekend check can see Saturday's verdict even
      //     though Saturday's doc is only staged — not yet committed — on
      //     this batch (see noSpendFire.ts's `stagedCleanDates` doc).
      //
      //     `stagedCompletionsByHabit` is the same idea for the HABIT docs
      //     themselves: if the SAME habit fires on two different judged
      //     days in this run (e.g. a "day"-scope habit clean on both
      //     Saturday and Sunday — precisely the case this catch-up window
      //     exists to enable), a later day's read of the habits collection
      //     would otherwise be blind to an earlier day's in-flight fire,
      //     corrupting that day's streak and (for a threshold habit spanning
      //     the same scoring period) risking a double credit. See
      //     `ApplyNoSpendDayDeps.stagedCompletionsByHabit`'s doc in
      //     noSpendFire.ts for the full mechanics.
      const stagedCleanDates = new Set<string>();
      const stagedCompletionsByHabit = new Map<string, StagedNoSpendFire[]>();
      const noSpendOutcomes: NoSpendOutcome[] = [];
      for (const noSpendDate of noSpendDatesToJudge) {
        const outcome = await applyNoSpendDay({
          db,
          householdId,
          batch,
          targetDate: noSpendDate,
          today,
          extraSpend: noSpendExtraSpendByDate.get(noSpendDate) ?? [],
          // No `householdData` passed — `applyNoSpendDay` no longer writes to
          // the household doc itself (see the accumulation right below this
          // loop, and `NoSpendOutcome.freezeTokensRefunded`'s doc comment for
          // why per-call household writes are unsafe across several days on
          // one batch).
          // An `exempt` rule must apply to every row dated to the judged day, not
          // just the ones this email creates — an exempted subscription is an
          // ordinary stored transaction on every later sync.
          merchantRules,
          stagedCleanDates,
          stagedCompletionsByHabit,
        });
        noSpendOutcomes.push(outcome);
        if (outcome.isNoSpendDay) stagedCleanDates.add(noSpendDate);
        for (const sf of outcome.stagedFires) {
          const list = stagedCompletionsByHabit.get(sf.habitId);
          if (list) list.push(sf);
          else stagedCompletionsByHabit.set(sf.habitId, [sf]);
        }
      }
      // Used when reporting below. `mostRecentNoSpend` falls back to a
      // not-a-no-spend-day placeholder dated to the newest day in the window
      // when NOTHING in the window needed judging this run (every candidate
      // day was already settled by an earlier email) — a quiet night whose
      // response/ledger shape should stay familiar rather than crash on an
      // empty array.
      const mostRecentNoSpend: NoSpendOutcome = noSpendOutcomes[noSpendOutcomes.length - 1] ?? {
        targetDate: noSpendWindow[noSpendWindow.length - 1] ?? noSpendAsOf,
        isNoSpendDay: false,
        blockedBy: [],
        fired: [],
        weekendCompleted: false,
        pointsDelta: { daily: 0, weekly: 0, total: 0 },
        freezeTokensRefunded: 0,
        freezeRefundNotes: [],
        stagedFires: [],
      };
      // Habits fired across EVERY judged day, pooled — a fire on an earlier
      // settled day of a multi-day catch-up must still be announced even
      // though the push title below is driven by the most recent day alone.
      const allFiredNoSpendHabits: NoSpendHabitFire[] = noSpendOutcomes.flatMap((o) => o.fired);

      // Combine every judged day's points delta and freeze-token refund into
      // ONE household-doc write — see `NoSpendOutcome.freezeTokensRefunded`'s
      // doc comment in noSpendFire.ts for exactly why a per-day write is
      // unsafe (the whole-object `freezeBank` write is built from THIS SAME
      // `householdData` snapshot, loaded once above, before the batch; two
      // days each computing their own `tokens: original + 1` from that same
      // stale snapshot would have the later one silently overwrite the
      // earlier one's refund — the classic whole-map-write clobber this
      // repo's CLAUDE.md warns about for `freezeBanksByMember`/
      // `frozenDatesBy`). Points are combined here too even though bare
      // `FieldValue.increment` calls are themselves safe across multiple
      // same-batch writes to one document (Firestore applies same-batch
      // writes to a document atomically and IN ORDER, so relative transforms
      // correctly accumulate) — one simple, auditable household write per
      // email is easier to reason about than relying on that guarantee.
      const noSpendPointsDelta = { daily: 0, weekly: 0, total: 0 };
      let noSpendFreezeTokensRefunded = 0;
      const noSpendFreezeRefundNotes: NoSpendFreezeRefundNote[] = [];
      for (const outcome of noSpendOutcomes) {
        noSpendPointsDelta.daily += outcome.pointsDelta.daily;
        noSpendPointsDelta.weekly += outcome.pointsDelta.weekly;
        noSpendPointsDelta.total += outcome.pointsDelta.total;
        noSpendFreezeTokensRefunded += outcome.freezeTokensRefunded;
        noSpendFreezeRefundNotes.push(...outcome.freezeRefundNotes);
      }
      const noSpendHouseholdUpdates: Record<string, unknown> = {};
      if (noSpendPointsDelta.daily !== 0) {
        noSpendHouseholdUpdates["points.daily"] = admin.firestore.FieldValue.increment(
          noSpendPointsDelta.daily
        );
      }
      if (noSpendPointsDelta.weekly !== 0) {
        noSpendHouseholdUpdates["points.weekly"] = admin.firestore.FieldValue.increment(
          noSpendPointsDelta.weekly
        );
      }
      if (noSpendPointsDelta.total !== 0) {
        noSpendHouseholdUpdates["points.total"] = admin.firestore.FieldValue.increment(
          noSpendPointsDelta.total
        );
      }
      if (noSpendFreezeTokensRefunded > 0) {
        const freezeBank = householdData?.freezeBank as
          | { tokens?: number; maxTokens?: number; history?: unknown[] }
          | undefined;
        if (freezeBank) {
          // Whole-object write, matching every other freezeBank writer (it is a
          // nested map, not a counter, and all writers treat it as
          // last-writer-wins). Capped so a refund can't push the bank above its
          // ceiling. Computed ONCE here, from the total across every judged day,
          // so this is the only `freezeBank` write in the whole batch.
          const maxTokens = typeof freezeBank.maxTokens === "number" ? freezeBank.maxTokens : 2;
          const tokens = typeof freezeBank.tokens === "number" ? freezeBank.tokens : 0;
          noSpendHouseholdUpdates["freezeBank"] = {
            ...freezeBank,
            tokens: Math.min(maxTokens, tokens + noSpendFreezeTokensRefunded),
            history: [
              ...(Array.isArray(freezeBank.history) ? freezeBank.history : []),
              ...noSpendFreezeRefundNotes.map((n) => ({
                id: `nospend-${n.habitId}-${n.habitDate}`,
                type: "earned",
                amount: 1,
                date: today,
                habitId: n.habitId,
                habitDate: n.habitDate,
                notes: `Freeze refunded: ${n.title} was completed on ${n.habitDate} after all (no-spend day)`,
                createdAt: new Date().toISOString(),
              })),
            ],
          };
        }
      }
      if (Object.keys(noSpendHouseholdUpdates).length > 0) {
        batch.update(db.doc(`households/${householdId}`), noSpendHouseholdUpdates);
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
      const outOfOrder = shouldSkipBalanceOverwrite(resolvedAccountBalanceAsOf, incomingBalanceAsOf);
      // Second, independent guard (checked only when the first didn't already
      // skip): the email's footer date can be genuinely newer while still
      // telling us nothing we didn't already know — see `emailAddsNothingNew`'s
      // doc comment for why the footer date alone can't be trusted here.
      const noNewInfo =
        !outOfOrder &&
        emailAddsNothingNew({
          withdrawalCount: parsed.withdrawals.length,
          incomingAvailable: parsed.availableBalance,
          incomingEnding: parsed.endingBalance,
          storedAvailable: resolvedAccountSyncState.lastSyncedAvailableBalance,
          storedEnding: resolvedAccountSyncState.lastSyncedEndingBalance,
        });
      const balanceSkipped = outOfOrder || noNewInfo;
      // Which reason fired, so the push/response can tell the truth about why
      // (see item 6 below) — `undefined` when the overwrite actually happened.
      const balanceSkipReason: "out_of_order" | "no_new_info" | undefined = outOfOrder
        ? "out_of_order"
        : noNewInfo
          ? "no_new_info"
          : undefined;
      if (outOfOrder) {
        logger.info(
          `bankEmailSync: skipping balance overwrite for account ${resolvedAccountId} — ` +
            `stored balanceAsOf ${resolvedAccountBalanceAsOf} is newer than incoming ${incomingBalanceAsOf} ` +
            `(out-of-order email, messageId ${messageId})`
        );
      } else if (noNewInfo) {
        logger.info(
          `bankEmailSync: skipping balance overwrite for account ${resolvedAccountId} — ` +
            `email had 0 withdrawals and matched the last-synced balance exactly ` +
            `(no new information, messageId ${messageId})`
        );
      } else {
        batch.update(db.doc(`households/${householdId}/accounts/${resolvedAccountId}`), {
          ...buildBalanceUpdate(parsed.availableBalance),
          balanceAsOf: incomingBalanceAsOf,
          lastSyncedAvailableBalance: parsed.availableBalance,
          lastSyncedEndingBalance: parsed.endingBalance,
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
        // The MOST RECENT judged day's verdict, kept in this exact shape for
        // backward compatibility with every ledger entry written before the
        // multi-day catch-up window — "why did/didn't my habit fire on the
        // day I'm asking about" now needs `noSpendDays` below when that day
        // isn't the newest one this run judged.
        noSpend: {
          date: mostRecentNoSpend.targetDate,
          isNoSpendDay: mostRecentNoSpend.isNoSpendDay,
          firedHabitIds: mostRecentNoSpend.fired.map((f) => f.habitId),
          weekendCompleted: mostRecentNoSpend.weekendCompleted,
        },
        // One entry per day THIS EMAIL actually judged (ascending), so "why
        // did/didn't my habit fire?" stays answerable for every day the
        // catch-up window settled, not just the most recent one.
        noSpendDays: noSpendOutcomes.map((o) => ({
          date: o.targetDate,
          isNoSpendDay: o.isNoSpendDay,
          firedHabitIds: o.fired.map((f) => f.habitId),
          weekendCompleted: o.weekendCompleted,
        })),
      });

      await batch.commit();
      // The batch (which OVERWRITES the ledger claim with the durable processed
      // record) has committed. Disown the claim NOW so a failure in the
      // post-commit steps below (push / logApiCall / response) can never reach
      // the catch's delete and wipe the durably-written ledger entry — a
      // structural guarantee, not a reliance on those helpers swallowing errors.
      claimedByUs = false;

      // 12. Summary push + response.
      const balanceSummary =
        balanceSkipReason === "out_of_order"
          ? "Balance: unchanged (older email, out of order)"
          : balanceSkipReason === "no_new_info"
            ? "Balance: unchanged (nothing new in this email)"
            : `Balance: ${formatCurrency(parsed.availableBalance, { currency })}`;
      // A no-spend day deserves to read like the good news it is rather than
      // "0 new, 0 confirmed, 0 filled, 0 bills paid" — let alone the "Bank sync
      // failed" it used to produce before the parser learned that an omitted
      // Withdrawals section is a legitimate result.
      //
      // Keyed on the VERDICT, not on `withdrawals.length === 0`: a day whose only
      // withdrawals were scheduled bills or transfers is still a no-spend day
      // (see noSpendDay.ts), and that day would otherwise get the counts line.
      //
      // Driven by the MOST RECENT judged day specifically (so "No spend
      // weekend" still shows up when the Sunday rule fires in a batch that
      // also caught up earlier weekdays) — but the fired-habit sentence below
      // pools EVERY judged day, so an earlier day's fire in the same batch is
      // never silently dropped from the push body.
      const summaryTitle = mostRecentNoSpend.weekendCompleted
        ? "No spend weekend"
        : mostRecentNoSpend.isNoSpendDay
          ? "No spend day"
          : "Bank sync complete";
      // What the household's rules did, between the outcome and the balance.
      // Counts only, and omitted entirely when the rules did nothing, so a
      // household without rules sees the exact push it saw before — the body is
      // already close to what iOS will truncate.
      const ruleSummary = describeRuleEffects(counts);
      // See `composeBankSyncSummaryBody`'s doc: this is what makes a habit
      // fired on an EARLIER judged day still show up in the push even when
      // the most recent judged day was dirty.
      const summaryBody = composeBankSyncSummaryBody({
        mostRecentIsNoSpendDay: mostRecentNoSpend.isNoSpendDay,
        allFired: allFiredNoSpendHabits,
        counts,
        ruleSummary,
        balanceSummary,
      });
      await pushToBankSyncMembers(householdId, summaryTitle, summaryBody);
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
          ...(balanceSkipReason ? { balanceSkipReason } : {}),
          ...counts,
          // Most recent judged day only, mirroring the ledger's `noSpend`
          // field — see `noSpendDays` for every day this run settled.
          noSpend: {
            date: mostRecentNoSpend.targetDate,
            isNoSpendDay: mostRecentNoSpend.isNoSpendDay,
            blockedBy: mostRecentNoSpend.blockedBy.length,
            fired: mostRecentNoSpend.fired.length,
            weekendCompleted: mostRecentNoSpend.weekendCompleted,
          },
          noSpendDays: noSpendOutcomes.map((o) => ({
            date: o.targetDate,
            isNoSpendDay: o.isNoSpendDay,
            blockedBy: o.blockedBy.length,
            fired: o.fired.length,
            weekendCompleted: o.weekendCompleted,
          })),
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
