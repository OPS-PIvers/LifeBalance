/**
 * Quick Add HTTP Cloud Functions for iOS Shortcuts Integration
 *
 * These endpoints accept HTTP POST requests with API key authentication
 * to enable quick-add functionality from iOS Shortcuts.
 */

import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { format } from "date-fns";
import {
  validateApiKey,
  extractApiKey,
  checkRateLimit,
  logApiCall,
  isValidFirestoreId,
} from "./apiKeyValidation";
import {
  Habit,
  isHabitStale,
  processToggleHabit,
  resetStaleHabit,
  fuzzyMatchHabit,
  normalizeHabitTitle,
} from "./habitProcessor";
import { formatCurrency } from "../utils/formatCurrency";
import { getPayPeriodForTransaction } from "../plaid/payPeriod";
import {
  RECONCILE_WINDOW_MS,
  pickFillTarget,
  buildFillUpdates,
  pickDuplicateShortcutRow,
  buildDuplicateMergeUpdates,
  pickReverseDuplicateRow,
  buildReverseDuplicateMergeUpdates,
  type ReconcileCandidate,
} from "./reconcile";
import {
  matchAccountByLast4,
  normalizeCardLast4,
  normalizeUsDate,
  type AccountLike,
} from "./accountMatch";
import { parseTransactionEmail } from "./emailParser";
import { DUPLICATE_WINDOW_DAYS, isLikelyDuplicate, type IdentityTransaction } from "./transactionIdentity";
import {
  findBillToPay,
  isRecurringId,
  parseRecurringId,
  type BillCalendarItem,
} from "./billMatch";
import { fuzzyMatchMember, type MemberLike } from "./todoMatch";
import { resolveTodoCategory } from "./todoCategoryMatch";
import { parseTodoPhrase } from "./todoParser";
import { isManualReview } from "./captureReview";
import { mergeQuantity, resolveNewQuantityField } from "./quantityLogic";

// Read/export GET endpoint (getTodos). Kept in its own module and re-exported
// here so this barrel's deploy surface stays complete while the endpoint body
// lives away from the churny expense-endpoint code below (fewer merge conflicts).
export { getTodos } from "./getTodos";

// Nightly Wells Fargo bank-email sync endpoint. Kept in its own module (like
// getTodos) so the churny expense-endpoint code below and this stay apart; it is
// re-exported here and surfaced for deploy from functions/src/index.ts.
export { bankEmailSync } from "./bankEmailSync";

/** The category new paid bills are filed under (mirrors utils/categories.ts). */
const BUDGETED_IN_CALENDAR = "Budgeted in Calendar";

const db = admin.firestore();

/** Minimal subset of the Express/Firebase response object used by the helpers below. */
interface HttpResponse {
  status(code: number): { json(body: unknown): void; send(body: string): void };
  set(header: string, value: string): void;
}

// Common response helpers
function jsonResponse(
  res: HttpResponse,
  status: number,
  data: Record<string, unknown>
): void {
  res.status(status).json(data);
}

function errorResponse(
  res: HttpResponse,
  status: number,
  message: string,
  code: string
): void {
  res.status(status).json({
    success: false,
    message,
    error: { code },
  });
}

// Production hosting origins (see firebase.json / .github/DEPLOYMENT_SETUP.md).
// There is no browser UI that calls these endpoints today — the allowlist just
// bounds the blast radius if one is ever added, rather than granting every
// website on the internet the ability to read responses from a signed-in
// visitor's browser via `Access-Control-Allow-Origin: *`.
const ALLOWED_ORIGINS = new Set<string>([
  "https://lifebalance-26080.web.app",
  "https://lifebalance-26080.firebaseapp.com",
]);

/**
 * Set CORS headers for browser callers only.
 *
 * These endpoints are consumed primarily by iOS Shortcuts / curl / other
 * non-browser HTTP clients, none of which send an `Origin` header — CORS is a
 * browser-only enforcement mechanism, so those callers are unaffected either
 * way. When an `Origin` header IS present we only echo it back (letting the
 * browser read the response) if it's in the production hosting allowlist
 * above; otherwise no `Access-Control-Allow-Origin` header is set, so the
 * browser blocks the response (and, since these endpoints require a
 * non-simple `Authorization`/JSON request, blocks the preflight from ever
 * authorizing the actual POST).
 */
function applyCorsHeaders(
  req: { headers: { origin?: string } },
  res: HttpResponse
): void {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
}

/**
 * POST /quickAddHabit
 * Toggle a habit by ID or name
 */
export const quickAddHabit = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    applyCorsHeaders(req, res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      errorResponse(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 1. Validate API Key
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

    // 2. Check permissions
    if (!permissions?.habits) {
      errorResponse(res, 403, "API key does not have habits permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "habit");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Parse request body
    const { habitId, habitName, direction = "up", today: rawToday } = req.body || {};

    if (!habitId && !habitName) {
      errorResponse(res, 400, "Either habitId or habitName is required", "BAD_REQUEST");
      return;
    }

    // Optional caller-local date (yyyy-MM-dd). Functions run in UTC, so when the
    // client (e.g. an iOS Shortcut) supplies its local date we use it for streak
    // math to avoid off-by-one-day errors for non-UTC users. Falls back to the
    // server date inside processToggleHabit when omitted/invalid.
    const today =
      typeof rawToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
        ? rawToday
        : undefined;

    // Security: Input validation
    if (habitId && (typeof habitId !== "string" || habitId.length > 100)) {
      errorResponse(res, 400, "habitId must be a string (max 100 chars)", "BAD_REQUEST");
      return;
    }

    // Security: Validate habitId format to prevent path traversal
    if (habitId && !isValidFirestoreId(habitId)) {
      errorResponse(res, 400, "habitId contains invalid characters", "BAD_REQUEST");
      return;
    }

    if (habitName && (typeof habitName !== "string" || habitName.length > 100)) {
      errorResponse(res, 400, "habitName too long (max 100 chars)", "BAD_REQUEST");
      return;
    }

    if (direction !== "up" && direction !== "down") {
      errorResponse(res, 400, "direction must be 'up' or 'down'", "BAD_REQUEST");
      return;
    }

    try {
      // 5. Find the habit
      let habit: Habit | null = null;
      let habitRef: admin.firestore.DocumentReference | null = null;

      if (habitId) {
        // Direct lookup by ID
        habitRef = db.doc(`households/${householdId}/habits/${habitId}`);
        const habitDoc = await habitRef.get();
        if (habitDoc.exists) {
          habit = { id: habitDoc.id, ...habitDoc.data() } as Habit;
        }
      } else if (habitName) {
        // Fast path: indexed exact-match lookup on the denormalized
        // `titleLower` field, avoiding a full-collection scan for the common
        // case of an exact (case/whitespace-insensitive) title match.
        const normalizedName = normalizeHabitTitle(habitName);
        const exactSnapshot = await db
          .collection(`households/${householdId}/habits`)
          .where("titleLower", "==", normalizedName)
          .limit(1)
          .get();

        if (!exactSnapshot.empty) {
          const exactDoc = exactSnapshot.docs[0];
          if (exactDoc) {
            habit = { id: exactDoc.id, ...exactDoc.data() } as Habit;
            habitRef = db.doc(`households/${householdId}/habits/${habit.id}`);
          }
        }

        // Fallback: full-collection scan + fuzzy match. Covers habits not yet
        // backfilled with `titleLower` and partial/starts-with name matches.
        if (!habit) {
          const habitsSnapshot = await db
            .collection(`households/${householdId}/habits`)
            .get();
          const habits = habitsSnapshot.docs.map(
            (doc) => ({ id: doc.id, ...doc.data() } as Habit)
          );
          habit = fuzzyMatchHabit(habits, habitName);
          if (habit) {
            habitRef = db.doc(`households/${householdId}/habits/${habit.id}`);
          }
        }
      }

      if (!habit || !habitRef) {
        // Do not echo user-supplied habitId/habitName back into the response —
        // it's unvalidated input and this endpoint is public (API-key auth
        // only), so reflecting it would be a stored/reflected content risk.
        errorResponse(res, 404, "Habit not found", "NOT_FOUND");
        await logApiCall(householdId, apiKey.substring(0, 16), "habit", req.body, 404);
        return;
      }

      // 6. Check if habit is stale and reset if needed.
      //    Thread the caller-local `today` (when supplied) so staleness and the
      //    reset are anchored on the user's local day — matching
      //    processToggleHabit below and the client's getHabitResetUpdate. This
      //    prevents the evening double-credit bug for non-UTC users where the
      //    UTC server day has rolled over but it's still the same local day.
      if (isHabitStale(habit, today)) {
        const resetUpdate = resetStaleHabit(habit, today);
        await habitRef.update(resetUpdate);
        habit = { ...habit, ...resetUpdate, count: 0 };
        logger.info(`Reset stale habit: ${habit.title}`);
      }

      // 7. Process the toggle
      const result = today
        ? processToggleHabit(habit, direction, today)
        : processToggleHabit(habit, direction);

      if (!result) {
        errorResponse(res, 400, "Cannot decrement habit below 0", "BAD_REQUEST");
        await logApiCall(householdId, apiKey.substring(0, 16), "habit", req.body, 400);
        return;
      }

      // 8. Update the habit document and household points atomically so they
      //    can never diverge if one write fails (mirrors the client's
      //    writeBatch pattern in hooks/useHabitActions.tsx).
      const batch = db.batch();
      batch.update(habitRef, {
        ...result.updatedHabit,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (result.pointsChange !== 0) {
        const householdRef = db.doc(`households/${householdId}`);
        batch.update(householdRef, {
          "points.daily": admin.firestore.FieldValue.increment(result.pointsChange),
          "points.weekly": admin.firestore.FieldValue.increment(result.pointsChange),
          "points.total": admin.firestore.FieldValue.increment(result.pointsChange),
        });
      }
      await batch.commit();

      // 10. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "habit", req.body, 200);

      // 11. Return success
      const pointsMsg =
        result.pointsChange > 0
          ? `+${result.pointsChange} pts`
          : result.pointsChange < 0
          ? `${result.pointsChange} pts`
          : "";
      const multiplierMsg = result.multiplier > 1 ? ` (${result.multiplier}x streak bonus)` : "";

      jsonResponse(res, 200, {
        success: true,
        message: `Habit '${habit.title}' ${direction === "up" ? "completed" : "decremented"}! ${pointsMsg}${multiplierMsg}`,
        data: {
          habitId: habit.id,
          habitTitle: habit.title,
          newCount: result.updatedHabit.count,
          streakDays: result.updatedHabit.streakDays,
          pointsChange: result.pointsChange,
          multiplier: result.multiplier,
        },
      });
    } catch (error) {
      logger.error("Error in quickAddHabit:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "habit", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);

/**
 * POST /quickAddExpense
 * Create a quick expense transaction
 */
export const quickAddExpense = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    applyCorsHeaders(req, res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      errorResponse(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 1. Validate API Key
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

    // 2. Check permissions
    if (!permissions?.expenses) {
      errorResponse(res, 403, "API key does not have expenses permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "expense");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Parse and validate request body
    let { amount: rawAmount, merchant, date } = req.body || {};
    const { category = "Uncategorized", notes } = req.body || {};

    // Optional card last-4 (e.g. Wells Fargo email sends "...8899") used to
    // auto-route this expense to the matching account. An explicit `accountId`
    // takes precedence; both are resolved after the household read below.
    let rawCardLast4 = (req.body || {}).cardLast4;
    const rawAccountId = (req.body || {}).accountId;

    // Card last-4 arrives as a short string ("...8899") or a number; anything
    // longer than a masked-card fragment is bogus. Actual digit extraction /
    // account matching happens after the household read below. This runs
    // BEFORE any validation that audit-logs the body (logApiCall persists
    // req.body), so a Shortcut that mis-captures a full card number never
    // leaves more than the last 4 digits in our logs.
    if (rawCardLast4 !== undefined && rawCardLast4 !== null) {
      if (
        (typeof rawCardLast4 !== "string" && typeof rawCardLast4 !== "number") ||
        String(rawCardLast4).length > 30
      ) {
        errorResponse(res, 400, "cardLast4 must be a short string (e.g. '8899')", "BAD_REQUEST");
        return;
      }
      // Sanitize the request body IN-PLACE to just the last 4 digits (or
      // null). Account matching below still reads the original `rawCardLast4`
      // (normalizeCardLast4 handles the mask forms).
      if (req.body) {
        req.body.cardLast4 = normalizeCardLast4(rawCardLast4);
      }
    }

    // Server-side email parsing: instead of running four fragile on-device
    // regexes, the bank-email Shortcut can send the WHOLE email body as
    // `emailText` and we extract amount/merchant/card/date here (emailParser.ts)
    // where the logic is versioned, layered per bank wording, and unit-tested.
    // Explicitly provided fields always win — the parser only fills the gaps —
    // so existing regex-based Shortcuts keep working unchanged.
    const rawEmailText = (req.body || {}).emailText;
    const emailKeyPresent = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "emailText"
    );
    // Redact the blob IN-PLACE before anything logs the body (same treatment
    // as cardLast4 above): logApiCall persists req.body — including the
    // validation-failure audit entries below — and a full bank email can carry
    // balances and account details that must never sit in audit logs;
    // sanitizeForLogging's 500-char truncation is not enough.
    if (emailKeyPresent && req.body) {
      req.body.emailText =
        typeof rawEmailText === "string"
          ? `[redacted email text: ${rawEmailText.length} chars]`
          : "[redacted email text: non-string value]";
    }
    const emailProvided =
      typeof rawEmailText === "string" && rawEmailText.trim() !== "";
    // A field counts as "missing" when absent OR blank — a Shortcut with an
    // empty variable sends "" and must not block other values.
    const isBlank = (v: unknown): boolean =>
      v === undefined || v === null || (typeof v === "string" && !v.trim());
    if (emailKeyPresent && !emailProvided) {
      if (
        rawEmailText !== undefined &&
        rawEmailText !== null &&
        typeof rawEmailText !== "string"
      ) {
        await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
        errorResponse(res, 400, "emailText must be a string", "BAD_REQUEST");
        return;
      }
      // An empty emailText is only fatal when there's nothing else to build
      // the transaction from. A dictionary that carries a leftover empty
      // emailText row NEXT TO a valid amount (e.g. a Wallet automation built
      // by duplicating the email one) must not be rejected — fall through and
      // let normal amount/merchant validation run.
      if (isBlank(rawAmount)) {
        // The email Shortcut ran but the body never made it into the request.
        // Two real-world causes, in observed order of likelihood: (1) fetch-only
        // mail accounts (Gmail/Workspace in Apple Mail) trigger the automation
        // before the message body has downloaded, so "Get Text from Input"
        // coerces the email to "" — a Wait action fixes it; (2) the emailText
        // field isn't pointing at the "Get Text from Input" output. This message
        // is exactly what the Shortcut's own notification shows the user.
        await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
        errorResponse(
          res,
          400,
          "emailText was empty — the automation ran but no email body reached the " +
            "server. Most often the email body hadn't downloaded yet (Gmail/" +
            "Workspace accounts are fetch-only): add a Wait action of 10–20 seconds " +
            "before “Get Text from Input”. Also check emailText is set to that " +
            "action's Text output and its input is Shortcut Input. (If this " +
            "automation isn't email-based, delete the emailText row from its " +
            "dictionary.)",
          "BAD_REQUEST"
        );
        return;
      }
    }
    if (emailProvided) {
      if (rawEmailText.length > 100000) {
        await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
        errorResponse(res, 400, "emailText too long (max 100000 chars)", "BAD_REQUEST");
        return;
      }
      const parsed = parseTransactionEmail(rawEmailText);
      if (parsed.amount === null && parsed.merchant === null) {
        // Nothing recognizable — tell the Shortcut owner (the notification
        // shows this message) instead of silently skipping the purchase.
        await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
        errorResponse(
          res,
          400,
          "Could not find an amount or merchant in emailText — the bank may have " +
            "changed its email wording",
          "BAD_REQUEST"
        );
        return;
      }
      if (isBlank(rawAmount)) {
        // No readable amount but a known merchant → fall through as a $0
        // "awaiting amount" stub (capture beats completeness, same philosophy
        // as the Apple Pay $0 pre-auth path below).
        rawAmount = parsed.amount ?? 0;
      }
      if (typeof merchant !== "string" || !merchant.trim()) {
        // Amount without a readable merchant is still worth capturing — land
        // it under a review-obvious placeholder rather than dropping it.
        merchant = parsed.merchant ?? "Card purchase";
      }
      if (isBlank(rawCardLast4)) {
        rawCardLast4 = parsed.cardLast4 ?? rawCardLast4;
        // Keep the audit-log copy in step: the sanitize-in-place above ran on
        // the blank client value, so the parsed last-4 that account routing
        // will actually use must replace it (normalized, never more than 4).
        if (req.body && rawCardLast4 !== undefined && rawCardLast4 !== null) {
          req.body.cardLast4 = normalizeCardLast4(rawCardLast4);
        }
      }
      if (isBlank(date)) {
        // undefined (not a blank string) so a parse miss falls back to today
        // below instead of failing date validation.
        date = parsed.date ?? undefined;
      }
    }

    // Opt-in marker set ONLY by the bank-notification Shortcut (which parses the
    // real settled amount out of the bank's push). It gates the reconcile step
    // below so a regular voice-expense Shortcut — also amount>0, also
    // source:'shortcut' — can never absorb an unrelated Apple Pay $0 stub.
    // Shortcuts may send a Boolean or a text "true"/"1", so accept both. An
    // email-sourced post IS a bank notification, so `emailText` defaults it on
    // (an explicit value still wins — e.g. `fromBankNotification: false`).
    const rawFromBank = (req.body || {}).fromBankNotification;
    const fromBankNotification =
      rawFromBank === undefined || rawFromBank === null
        ? emailProvided
        : rawFromBank === true || rawFromBank === "true" || rawFromBank === 1 || rawFromBank === "1";

    // Convert amount to number.
    // iOS Shortcuts may send amounts as a plain number or as a formatted currency string
    // (e.g. "$50.00", "-$50.00", "USD 50.00", "50,00", "1.234,56",
    //  or accounting notation "(50.00)" / "(€50,00)" = -50).
    // We normalise all of these so the automation succeeds regardless of iOS version or locale.
    let amount: number;
    if (typeof rawAmount === "string") {
      const raw = rawAmount.trim();
      // Negative if wrapped in parentheses (accounting notation) or contains a '-' anywhere
      const isNegative = /^\(.*\)$/.test(raw) || raw.includes("-");
      // Remove parens, minus signs, and non-numeric characters except digit separators
      const digitsOnly = raw.replace(/[()]/g, "").replace(/-/g, "").replace(/[^\d.,]/g, "");
      let numeric = NaN;
      if (digitsOnly.length > 0) {
        const lastDot   = digitsOnly.lastIndexOf(".");
        const lastComma = digitsOnly.lastIndexOf(",");
        const decPos    = Math.max(lastDot, lastComma);
        if (decPos >= 0) {
          // Everything before the last separator is the integer part (strip grouping); after is fractional
          const intPart  = digitsOnly.slice(0, decPos).replace(/[.,]/g, "");
          const fracPart = digitsOnly.slice(decPos + 1);
          numeric = parseFloat(fracPart ? `${intPart}.${fracPart}` : intPart);
        } else {
          numeric = parseFloat(digitsOnly);
        }
      }
      amount = isNegative ? -Math.abs(numeric) : numeric;
    } else {
      amount = rawAmount;
    }

    // Round to 2 decimal places to avoid floating-point precision issues
    if (typeof amount === "number" && !isNaN(amount)) {
      amount = Math.round(amount * 100) / 100;
    }

    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      // Name the body fields that DID arrive (names only — values may be
      // sensitive): the Shortcut's own error notification then identifies
      // which automation sent the bad request (emailText ⇒ the email one).
      const receivedFields = Object.keys(req.body || {}).join(", ") || "none";
      // rawAmount is unvalidated user input echoed into the log and response;
      // cap it so an oversized string can't bloat either.
      const safeRawAmount =
        typeof rawAmount === "string" && rawAmount.length > 100
          ? `${rawAmount.substring(0, 100)}... [TRUNCATED]`
          : rawAmount;
      logger.warn(
        `Invalid amount received: ${JSON.stringify({ rawAmount: safeRawAmount, amount, type: typeof rawAmount, receivedFields })}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
      errorResponse(
        res,
        400,
        `amount must be a valid number. Received: ${typeof safeRawAmount === 'undefined' ? 'undefined' : JSON.stringify(safeRawAmount)}. ` +
          `Send a plain number (50 or -50) or a currency string ("$50.00"). Both positive and negative values are accepted. ` +
          `Body fields received: ${receivedFields}.`,
        "BAD_REQUEST"
      );
      return;
    }

    // Accept both positive and negative amounts — iOS automation sign varies by version.
    // Expenses are always stored as positive numbers; the sign carries no meaning here.
    amount = Math.abs(amount);

    // Apple Pay's "Transaction" automation trigger fires on the authorization event,
    // which for many cards/merchants (gas, hotels, tipped purchases) comes through as a
    // $0 pre-authorization hold. The real amount settles later on the bank side and does
    // NOT re-fire the on-device trigger. Rather than dropping the event, we create an
    // "awaiting amount" stub transaction (amount 0, needsAmount:true) so the user can fill
    // in the real amount during review — provided we have a merchant to identify it by.
    // If there is no usable merchant a blank stub is useless, so we still skip it (but log
    // the event so it's possible to see how often these holds occur). Returns 200 either
    // way so the iOS shortcut doesn't show an error.
    const hasMerchant =
      typeof merchant === "string" && merchant.trim().length > 0;
    if (amount === 0 && !hasMerchant) {
      logger.info(
        `Skipped merchant-less zero-dollar Apple Pay hold for household ${householdId}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);
      jsonResponse(res, 200, {
        success: true,
        skipped: true,
        message: "Skipped zero-dollar hold with no merchant (Apple Pay pre-authorization)",
      });
      return;
    }
    // A $0 WITH a merchant falls through to the normal validation + write path
    // below and is persisted as a needsAmount stub (see transactionData).

    // Security: Input validation & sanitization
    if (!merchant || typeof merchant !== "string") {
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
      errorResponse(
        res,
        400,
        `merchant is required. Body fields received: ${Object.keys(req.body || {}).join(", ") || "none"}.`,
        "BAD_REQUEST"
      );
      return;
    }

    if (merchant.length > 100) {
      errorResponse(res, 400, "merchant name too long (max 100 chars)", "BAD_REQUEST");
      return;
    }

    if (category !== undefined && category !== null) {
      if (typeof category !== "string" || category.length > 50) {
        errorResponse(res, 400, "category must be a string (max 50 chars)", "BAD_REQUEST");
        return;
      }
    }

    if (notes !== undefined && notes !== null) {
      if (typeof notes !== "string" || notes.length > 500) {
        errorResponse(res, 400, "notes must be a string (max 500 chars)", "BAD_REQUEST");
        return;
      }
    }

    // An explicit accountId (when provided) must be a valid Firestore id.
    if (rawAccountId !== undefined && rawAccountId !== null) {
      if (typeof rawAccountId !== "string" || !isValidFirestoreId(rawAccountId)) {
        errorResponse(res, 400, "accountId contains invalid characters", "BAD_REQUEST");
        return;
      }
    }

    // Resolve the transaction date. Prefer the explicit `date` (accepted as
    // YYYY-MM-DD or US MM/DD/YYYY — the Wells Fargo email format — normalized to
    // ISO); otherwise fall back to the caller-local `today` (yyyy-MM-dd) — same
    // as quickAddHabit — because Cloud Functions run in UTC and `new Date()` is
    // the UTC server day, wrong for evening US users. Server date is last resort.
    const rawToday = (req.body || {}).today;
    const localToday =
      typeof rawToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
        ? rawToday
        : undefined;

    let transactionDate: string;
    if (date !== undefined && date !== null && date !== "") {
      const normalizedDate = normalizeUsDate(date);
      if (!normalizedDate) {
        errorResponse(
          res,
          400,
          "date must be in YYYY-MM-DD or MM/DD/YYYY format",
          "BAD_REQUEST"
        );
        return;
      }
      transactionDate = normalizedDate;
    } else {
      transactionDate = localToday || format(new Date(), "yyyy-MM-dd");
    }

    try {
      // 5. Get household data for pay period calculation
      const householdRef = db.doc(`households/${householdId}`);
      const householdDoc = await householdRef.get();
      const householdData = householdDoc.data();

      // Currency for the user-facing response string is sourced from the
      // household doc (the top-level `currency` field added by the client).
      const currency = householdData?.currency || "USD";

      const transactionsPath = `households/${householdId}/transactions`;

      // Resolve the target account. An explicit `accountId` wins; otherwise the
      // card last-4 (Wells Fargo email sends "...8899") is matched against the
      // household's accounts so the transaction is routed to the right card. A
      // read is only incurred when a card hint is present and no explicit id.
      let resolvedAccountId: string | undefined =
        typeof rawAccountId === "string" && rawAccountId.trim()
          ? rawAccountId.trim()
          : undefined;
      if (!resolvedAccountId && rawCardLast4 !== undefined && rawCardLast4 !== null) {
        try {
          const accountsSnap = await db
            .collection(`households/${householdId}/accounts`)
            .get();
          const accountList: AccountLike[] = accountsSnap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              cardLast4:
                typeof data.cardLast4 === "string" ? data.cardLast4 : undefined,
              cardLast4s:
                Array.isArray(data.cardLast4s) &&
                data.cardLast4s.every((c) => typeof c === "string")
                  ? (data.cardLast4s as string[])
                  : undefined,
            };
          });
          resolvedAccountId = matchAccountByLast4(rawCardLast4, accountList) ?? undefined;
        } catch (accountErr) {
          // Account routing is best-effort: never block capture on it. The
          // transaction is created untagged and falls back to the checking
          // account during review.
          logger.warn(`Account match failed; leaving transaction untagged: ${accountErr}`);
        }
      }

      // CARD-1: the card last-4 that resolved (or attempted to resolve) the
      // account above — normalized the same way accountMatch.ts normalizes it
      // for routing — persisted onto the row instead of being discarded once
      // routing is done, so a later PR can attribute the purchase to whoever
      // owns that card (see Account.cardOwners / utils/cardOwnership.ts).
      // Independent of whether routing actually found a match: even an
      // unmatched/ambiguous card digit is worth keeping on the row. Computed
      // HERE (before the reconcile block below) so the fill/merge builders can
      // thread it through instead of losing it on those paths (finding 1).
      const persistedCardLast4 =
        rawCardLast4 !== undefined && rawCardLast4 !== null
          ? normalizeCardLast4(rawCardLast4) ?? undefined
          : undefined;

      // --- Reconcile the two Apple Pay capture paths (see reconcile.ts), then
      // cross-path dedup against ALL recent transactions (plan 03 PR-3) ---
      // Fetch the household's recent rows ONCE (same query as before, now
      // unconditional so the identity-dedup pass below can reuse it without a
      // second read) and try the stub-fill merge first — it keeps priority and
      // its own gating (fromBankNotification, amount > 0, source:'shortcut'
      // stubs only) is unchanged. Only when stub-fill does NOT short-circuit do
      // we fall through to the broader duplicate check against every recent row
      // (any source), which can never touch the original stub-fill behavior.
      let possibleDuplicateOf: string | undefined;
      try {
        // The QUERY window must cover the identity-dedup horizon (±3 calendar
        // days, +1 for timezone slack) — the stub-fill pass keeps its own much
        // tighter 30-minute gate via the per-row filter below. Querying only
        // 30 minutes back would silently miss e.g. a Plaid row from yesterday.
        const queryCutoff = admin.firestore.Timestamp.fromMillis(
          Date.now() - (DUPLICATE_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000
        );
        const stubCutoffMs = Date.now() - RECONCILE_WINDOW_MS;
        // Single where() → covered by the automatic single-field index on
        // createdAt; the window is small so we filter the rest in memory.
        const recentSnap = await db
          .collection(transactionsPath)
          .where("createdAt", ">=", queryCutoff)
          .get();

        const reconcileCandidates: ReconcileCandidate[] = [];
        const identityCandidates: (IdentityTransaction & { id: string })[] = [];
        const refById = new Map<string, admin.firestore.DocumentReference>();
        for (const d of recentSnap.docs) {
          const data = d.data() as Record<string, unknown>;
          refById.set(d.id, d.ref);

          // Stub-fill candidates: only source:'shortcut' pending rows created
          // within the ORIGINAL 30-minute reconcile window — the wider query
          // above must not widen stub-fill's behavior. Duck-typed (not
          // instanceof) because tests mock firebase-admin; a row with no
          // parseable createdAt can only reach here through a mock anyway —
          // the query itself filters on createdAt, so real docs always carry
          // it — and is treated as in-window to match the old query-only gate.
          const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
          const createdAtMs =
            typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : undefined;
          const withinStubWindow = createdAtMs === undefined || createdAtMs >= stubCutoffMs;
          if (
            withinStubWindow &&
            data.source === "shortcut" &&
            data.status === "pending_review" &&
            typeof data.amount === "number" &&
            Number.isFinite(data.amount)
          ) {
            reconcileCandidates.push({
              id: d.id,
              amount: data.amount,
              merchant: typeof data.merchant === "string" ? data.merchant : "",
              needsAmount: data.needsAmount === true,
              accountId:
                typeof data.accountId === "string" ? data.accountId : undefined,
              fromBankNotification: data.fromBankNotification === true,
              // CARD-1 (finding 1): so buildFillUpdates/buildDuplicateMergeUpdates/
              // buildReverseDuplicateMergeUpdates can tell whether this candidate
              // already carries a card digit before deciding to write one.
              cardLast4:
                typeof data.cardLast4 === "string" ? data.cardLast4 : undefined,
            });
          }

          // Identity-dedup candidates: any source/status, best-effort defaults
          // for fields this narrow recent-row read may not carry.
          if (
            typeof data.amount === "number" &&
            Number.isFinite(data.amount) &&
            (data.status === "verified" || data.status === "pending_review")
          ) {
            identityCandidates.push({
              id: d.id,
              amount: data.amount,
              merchant: typeof data.merchant === "string" ? data.merchant : "",
              date: typeof data.date === "string" ? data.date : transactionDate,
              category: typeof data.category === "string" ? data.category : "",
              status: data.status,
              accountId:
                typeof data.accountId === "string" ? data.accountId : undefined,
              needsAmount: data.needsAmount === true,
            });
          }
        }

        if (fromBankNotification && amount > 0) {
          const target = pickFillTarget(
            { amount, merchant: merchant.trim(), category, accountId: resolvedAccountId, cardLast4: persistedCardLast4 },
            reconcileCandidates
          );
          const targetRef = target ? refById.get(target.id) : undefined;
          if (target && targetRef) {
            await targetRef.update(
              buildFillUpdates(
                {
                  amount,
                  merchant: merchant.trim(),
                  category,
                  accountId: resolvedAccountId,
                  cardLast4: persistedCardLast4,
                  // CARD-1 (finding 3): this branch is gated on
                  // `fromBankNotification && amount > 0`, so the incoming
                  // record IS the bank notification — "bank wins" the
                  // cardLast4 conflict policy.
                  fromBankNotification,
                },
                target
              )
            );
            await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);
            jsonResponse(res, 200, {
              success: true,
              merged: true,
              message: `Updated pending: ${formatCurrency(amount, { currency })} at ${merchant} (filled awaiting-amount)`,
              data: {
                transactionId: target.id,
                amount,
                merchant,
                category,
                date: transactionDate,
                status: "pending_review",
                accountId: resolvedAccountId ?? null,
              },
            });
            return;
          }

          // No $0 stub to fill, but the Apple Pay "Transaction" automation may
          // have already captured this SAME purchase at its full amount (a
          // normal pending row, not a stub) under a different merchant string —
          // e.g. "Target" from Apple Pay vs "TARGET T-2189" from the bank. That
          // pair is only ever 'possible' to the shared identity check (both
          // captures are usually untagged), so it would otherwise survive as two
          // rows. Collapse it here, with the same tight window + exactly-one +
          // cross-source guards the stub-fill path uses.
          const dupTarget = pickDuplicateShortcutRow(
            { amount, merchant: merchant.trim(), category, accountId: resolvedAccountId, cardLast4: persistedCardLast4 },
            reconcileCandidates
          );
          const dupRef = dupTarget ? refById.get(dupTarget.id) : undefined;
          if (dupTarget && dupRef) {
            const mergeUpdates = buildDuplicateMergeUpdates(
              {
                amount,
                merchant: merchant.trim(),
                category,
                accountId: resolvedAccountId,
                cardLast4: persistedCardLast4,
                // CARD-1 (finding 3): same "bank wins" reasoning as the
                // stub-fill call above — this branch is also gated on
                // `fromBankNotification && amount > 0`.
                fromBankNotification,
              },
              dupTarget
            );
            if (Object.keys(mergeUpdates).length > 0) {
              await dupRef.update(mergeUpdates);
            }
            await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);
            jsonResponse(res, 200, {
              success: true,
              merged: true,
              message: `Already recorded: ${formatCurrency(amount, { currency })} at ${merchant} (matched a recent capture of the same purchase)`,
              data: {
                transactionId: dupTarget.id,
                amount,
                merchant,
                category,
                date: transactionDate,
                status: "pending_review",
                accountId: (dupTarget.accountId ?? resolvedAccountId) ?? null,
              },
            });
            return;
          }
          // No unambiguous stub or duplicate to fold into → fall through to
          // identity dedup, then a normal row.
        }

        // Reverse ordering (mirror of the block above): this is a NON-bank
        // Apple Pay "Transaction" capture (amount > 0, not a stub), and the bank
        // notification for the SAME purchase may have arrived FIRST — landing as
        // a `fromBankNotification` real-amount row under a uglier merchant string
        // ("TARGET T-2189" vs "Target"). That pair is only 'possible' to the
        // identity check (both usually untagged), so it would otherwise survive
        // as two rows. Fold this capture into that bank row, rewriting it into
        // the Apple Pay capture so the cleaner data survives — same tight window +
        // exactly-one + cross-source guards as the forward path.
        if (!fromBankNotification && amount > 0) {
          const reverseTarget = pickReverseDuplicateRow(
            { amount, merchant: merchant.trim(), category, accountId: resolvedAccountId, cardLast4: persistedCardLast4 },
            reconcileCandidates
          );
          const reverseRef = reverseTarget ? refById.get(reverseTarget.id) : undefined;
          if (reverseTarget && reverseRef) {
            const mergeUpdates = buildReverseDuplicateMergeUpdates(
              {
                amount,
                merchant: merchant.trim(),
                category,
                accountId: resolvedAccountId,
                cardLast4: persistedCardLast4,
                // CARD-1 (finding 3): this branch is gated on
                // `!fromBankNotification && amount > 0` — the incoming
                // record is the NON-bank Apple Pay capture, so it must
                // never win a cardLast4 conflict against `reverseTarget`'s
                // bank-resolved value. Explicit for clarity even though
                // `false` is already the default.
                fromBankNotification,
              },
              reverseTarget
            );
            // No Object.keys guard here (unlike the forward path above): unlike
            // buildDuplicateMergeUpdates — which can return {} because it only
            // conditionally sets accountId — buildReverseDuplicateMergeUpdates
            // ALWAYS returns at least { merchant, fromBankNotification: false }, so
            // the patch is never empty. Keep that invariant if either field is
            // ever made conditional, or restore the guard.
            await reverseRef.update(mergeUpdates);
            await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);
            jsonResponse(res, 200, {
              success: true,
              merged: true,
              message: `Already recorded: ${formatCurrency(amount, { currency })} at ${merchant} (matched a recent capture of the same purchase)`,
              data: {
                transactionId: reverseTarget.id,
                amount,
                merchant,
                category,
                date: transactionDate,
                status: "pending_review",
                accountId: (reverseTarget.accountId ?? resolvedAccountId) ?? null,
              },
            });
            return;
          }
          // No unambiguous bank row to fold into → fall through to identity
          // dedup, then a normal row.
        }

        // Cross-path duplicate check: did this same purchase already arrive via
        // another path (Plaid, manual, a receipt scan, …)? A confident match
        // annotates the EXISTING row instead of inserting a second one; a
        // weaker ('possible') match still inserts, flagged for the review UI.
        const incoming: IdentityTransaction = {
          amount,
          merchant: merchant.trim(),
          date: transactionDate,
          category,
          status: "pending_review",
          accountId: resolvedAccountId,
        };
        let confidentDuplicateId: string | undefined;
        for (const row of identityCandidates) {
          const verdict = isLikelyDuplicate(incoming, row);
          if (verdict === "duplicate") {
            confidentDuplicateId = row.id;
            possibleDuplicateOf = row.id;
            break;
          }
          if (verdict === "possible" && !possibleDuplicateOf) {
            possibleDuplicateOf = row.id;
          }
        }
        if (confidentDuplicateId) {
          // The purchase already exists as another row (e.g. it already arrived
          // via Plaid) — skip creating a second transaction entirely rather
          // than annotate; quickAdd has no id of its own worth stamping onto
          // the existing row (unlike Plaid sync's `plaidTransactionId`).
          await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);
          jsonResponse(res, 200, {
            success: true,
            merged: true,
            message: `Already recorded: ${formatCurrency(amount, { currency })} at ${merchant} (matched an existing transaction)`,
            data: {
              transactionId: confidentDuplicateId,
              amount,
              merchant,
              category,
              date: transactionDate,
              status: "pending_review",
              accountId: resolvedAccountId ?? null,
            },
          });
          return;
        }
        // If we get here the verdict was at most 'possible' (or no match) —
        // possibleDuplicateOf (if set) flags the new row created below.
      } catch (reconcileErr) {
        // Reconciliation/dedup is best-effort: a lookup/update failure must
        // never block capture, so log and fall through to the normal create path.
        logger.warn(
          `Reconcile/dedup lookup failed; creating a new transaction instead: ${reconcileErr}`
        );
        possibleDuplicateOf = undefined;
      }

      // Calculate the pay period for this transaction. Use the shared, ported
      // helper rather than the old `lastPaycheckDate || transactionDate`
      // shortcut: a back-dated expense (date < lastPaycheckDate) must NOT be
      // scoped into the CURRENT period, or it gets wrongly counted by
      // calculateBucketSpent / sumPendingSpend. The helper returns '' for
      // pre-period / untracked dates.
      const payPeriodId = getPayPeriodForTransaction(
        transactionDate,
        householdData?.lastPaycheckDate
      );

      // 6. Create transaction document as PENDING (for review)
      const transactionData = {
        amount,
        merchant: merchant.trim(),
        category,
        date: transactionDate,
        status: "pending_review",  // Matches Transaction type; surfaces in the Budget tab for review
        isRecurring: false,
        source: "shortcut" as const,
        autoCategorized: false,
        payPeriodId,
        notes: notes || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        // Route to the card matched by last-4 (or explicit accountId). Omitted
        // when nothing matched so review falls back to the checking account.
        ...(resolvedAccountId ? { accountId: resolvedAccountId } : {}),
        // CARD-1: the card digits themselves (see persistedCardLast4 above).
        // Omitted when no card digit was ever supplied/parsed.
        ...(persistedCardLast4 ? { cardLast4: persistedCardLast4 } : {}),
        // Apple Pay $0 pre-auth stub: flags the review UI that the real amount
        // still needs to be entered. Omitted for normal (amount > 0) expenses.
        ...(amount === 0 ? { needsAmount: true } : {}),
        // Marks a row created FROM a bank notification so a later bank
        // notification never folds into it (pickDuplicateShortcutRow only merges
        // into a non-bank Apple Pay capture). Omitted otherwise to keep the
        // stored shape minimal.
        ...(fromBankNotification ? { fromBankNotification: true } : {}),
        // Plan 03: a weaker ('possible') identity match against an existing
        // row — the review UI surfaces a Merge / Keep-both choice. Omitted
        // when no candidate scored 'possible' (or the dedup lookup failed).
        ...(possibleDuplicateOf ? { possibleDuplicateOf } : {}),
      };

      const transactionRef = await db
        .collection(transactionsPath)
        .add(transactionData);

      // Note: Don't deduct from checking yet - that happens when user verifies the transaction

      // 7. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);

      // 8. Return success. A $0 stub reads as "awaiting amount" rather than
      //    "$0.00" so the iOS notification isn't misleading.
      jsonResponse(res, 200, {
        success: true,
        message:
          amount === 0
            ? `Awaiting amount: ${merchant} (added for review)`
            : `Expense added: ${formatCurrency(amount, { currency })} at ${merchant} (pending review)`,
        data: {
          transactionId: transactionRef.id,
          amount,
          merchant,
          category,
          date: transactionDate,
          status: "pending_review",
          accountId: resolvedAccountId ?? null,
        },
      });
    } catch (error) {
      logger.error("Error in quickAddExpense:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);

/**
 * POST /quickAddShoppingItem
 * Add an item to the shopping list via voice or shortcut.
 *
 * When the household's `captureReview.shopping` setting is `'review'`, each
 * NEWLY created row (single or batch mode) is stamped `needsReview: true`
 * (held out of the visible list until approved) — see captureReview.ts. A
 * quantity-bump onto an existing item (matched name, not yet purchased) never
 * toggles `needsReview`, whether the household is in auto or review mode:
 * merging into an already-visible item must not retroactively hide it, and
 * merging into an already-held item must not prematurely surface it.
 */
export const quickAddShoppingItem = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    applyCorsHeaders(req, res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      errorResponse(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 1. Validate API Key
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

    // 2. Check permissions
    if (!permissions?.shoppingList) {
      errorResponse(res, 403, "API key does not have shoppingList permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "shopping");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Parse and validate request body
    // Support both single item and batch items for flexibility. `quantity` is
    // intentionally left undefined (not defaulted to 1) when the caller omits
    // it — a captured item with no explicit count must write NO quantity
    // field at all, not an invented "1" (see resolveNewQuantityField below).
    const { item, items, quantity, category = "Other", store } = req.body || {};

    // Batch mode: items array provided
    if (items && Array.isArray(items)) {
      if (items.length === 0) {
        errorResponse(res, 400, "items array cannot be empty", "BAD_REQUEST");
        return;
      }

      if (items.length > 20) {
        errorResponse(res, 400, "Maximum 20 items per batch request", "BAD_REQUEST");
        return;
      }

      // Validate all items first
      for (const itemObj of items) {
        if (!itemObj.item || typeof itemObj.item !== "string") {
          errorResponse(res, 400, "Each item must have a 'item' (name) field", "BAD_REQUEST");
          return;
        }
        if (itemObj.item.length > 100) {
          errorResponse(res, 400, `Item name too long: ${itemObj.item} (max 100 chars)`, "BAD_REQUEST");
          return;
        }
        // Security: Validate optional fields to prevent storage exhaustion
        if (itemObj.category !== undefined && itemObj.category !== null) {
          if (typeof itemObj.category !== "string" || itemObj.category.length > 50) {
            errorResponse(res, 400, `Category too long for item '${itemObj.item}' (max 50 chars)`, "BAD_REQUEST");
            return;
          }
        }
        if (itemObj.store !== undefined && itemObj.store !== null) {
          if (typeof itemObj.store !== "string" || itemObj.store.length > 50) {
            errorResponse(res, 400, `Store too long for item '${itemObj.item}' (max 50 chars)`, "BAD_REQUEST");
            return;
          }
        }
        if (itemObj.quantity !== undefined && itemObj.quantity !== null) {
          if (typeof itemObj.quantity !== "number" || itemObj.quantity < 0.01) {
             errorResponse(res, 400, `Invalid quantity for item '${itemObj.item}'`, "BAD_REQUEST");
             return;
          }
        }
      }

      try {
        // 5. Determine the household's shopping capture-review mode ONCE per
        //    request (not per item) — items created while shopping is in
        //    'review' mode are held (needsReview: true) until approved. See
        //    captureReview.ts. Only stamped on NEWLY created rows below; a
        //    quantity-bump onto an existing item (visible or already held)
        //    must not retroactively toggle its review state. Also drives the
        //    dedup match below: a capture may only merge into an existing row
        //    with the SAME held-state, never across the held/visible boundary
        //    (an auto capture merging into a held row would silently vanish
        //    into the review drawer; a held capture merging into a visible
        //    row would silently surface without review).
        const householdSnap = await db.doc(`households/${householdId}`).get();
        const incomingHeld = isManualReview(
          householdSnap.data()?.captureReview,
          "shopping"
        );

        // 6. Fetch existing items once for duplicate checking
        const shoppingListRef = db.collection(
          `households/${householdId}/shoppingList`
        );
        const existingItems = await shoppingListRef
          .where("isPurchased", "==", false)
          .get();

        const results: Array<{
          itemId: string;
          name: string;
          quantity?: string;
          category?: string;
          store?: string | null;
          updated?: boolean;
          created?: boolean;
        }> = [];

        // 7. Plan all writes into a single WriteBatch so all items are
        //    committed atomically in one round-trip instead of N sequential
        //    awaits (matches the client's writeBatch pattern in
        //    contexts/FirebaseHouseholdContext.tsx handleShoppingItems).
        const batch = db.batch();

        // Build a mutable map of normalized-name → resolved quantity STRING so
        // that within-batch duplicate detection works even when the same item
        // name appears more than once in the request array. `undefined` means
        // "no quantity written yet" (a brand-new row created without one) —
        // distinct from an empty string, and mergeQuantity treats it the same
        // as any other absent quantity (counts as 1 for accumulation).
        const pendingQuantities = new Map<string, { ref: admin.firestore.DocumentReference; quantity: string | undefined }>();

        for (const itemObj of items) {
          const itemName = itemObj.item.trim();
          const hasExplicitQuantity = itemObj.quantity !== undefined && itemObj.quantity !== null;
          // The count to ADD for merge/accumulation purposes — an absent
          // per-item quantity still counts as 1, matching the app-wide
          // "no explicit quantity means one" convention.
          const mergeAddCount: number = hasExplicitQuantity ? itemObj.quantity : 1;
          const itemCategory = itemObj.category || category;
          const itemStore = itemObj.store || store || null;

          const normalizedItem = itemName.toLowerCase();

          // Check if a previous iteration of this batch already touched this
          // item (within-batch dedup before checking Firestore).
          const pending = pendingQuantities.get(normalizedItem);
          if (pending !== undefined) {
            const merged = mergeQuantity(pending.quantity, mergeAddCount);
            pendingQuantities.set(normalizedItem, { ref: pending.ref, quantity: merged });
            // Update the already-queued batch operation in-place.
            batch.update(pending.ref, {
              quantity: merged,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            });
            const result = results.find(
              (r) => r.name.toLowerCase() === normalizedItem
            );
            if (result !== undefined) {
              result.quantity = merged;
            }
            continue;
          }

          const duplicate = existingItems.docs.find((doc) => {
            const data = doc.data();
            return (
              data.name?.toLowerCase() === normalizedItem &&
              (data.needsReview === true) === incomingHeld
            );
          });

          if (duplicate) {
            // Merge onto the existing item, preserving its unit (and reading
            // a legacy raw-number quantity correctly — no migration needed).
            const currentQty = duplicate.data().quantity as string | number | undefined;
            const merged = mergeQuantity(currentQty, mergeAddCount);
            batch.update(duplicate.ref, {
              quantity: merged,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            });
            pendingQuantities.set(normalizedItem, { ref: duplicate.ref, quantity: merged });
            results.push({
              itemId: duplicate.id,
              name: itemName,
              quantity: merged,
              updated: true,
            });
          } else {
            // Pre-allocate a new doc ref so we can return its id synchronously
            // and still commit everything in a single batch.
            const newRef = shoppingListRef.doc();
            // No quantity was supplied -> write NO quantity field at all
            // (never invent a "1"). resolveNewQuantityField also collapses an
            // explicit count of 1 to `undefined`, matching that same
            // convention for a single explicitly-requested unit.
            const resolvedQuantity = hasExplicitQuantity
              ? resolveNewQuantityField(itemObj.quantity)
              : undefined;
            const shoppingItemData = {
              name: itemName,
              ...(resolvedQuantity !== undefined ? { quantity: resolvedQuantity } : {}),
              category: itemCategory,
              store: itemStore,
              isPurchased: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              source: "shortcut",
              // Held for review only on brand-new rows — see the mode
              // determination above. Omitted (not `false`) when auto, to
              // keep today's stored shape unchanged.
              ...(incomingHeld ? { needsReview: true } : {}),
            };
            batch.set(newRef, shoppingItemData);
            pendingQuantities.set(normalizedItem, { ref: newRef, quantity: resolvedQuantity });
            results.push({
              itemId: newRef.id,
              name: itemName,
              quantity: resolvedQuantity,
              category: itemCategory,
              store: itemStore,
              created: true,
            });
          }
        }

        // Commit all creates/updates in one round-trip.
        await batch.commit();

        // 8. Log API call
        await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

        // 9. Return success with all results
        jsonResponse(res, 200, {
          success: true,
          message: `Added ${results.length} item(s) to shopping list`,
          data: {
            items: results,
            count: results.length,
          },
        });
        return;
      } catch (error) {
        logger.error("Error in quickAddShoppingItem (batch):", error);
        await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 500);
        errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
        return;
      }
    }

    // Single item mode (backwards compatible)
    if (!item || typeof item !== "string") {
      errorResponse(res, 400, "item name is required", "BAD_REQUEST");
      return;
    }

    // Security: Input validation
    if (item.length > 100) {
      errorResponse(res, 400, "item name too long (max 100 chars)", "BAD_REQUEST");
      return;
    }

    if (category !== undefined && category !== null) {
      if (typeof category !== "string" || category.length > 50) {
        errorResponse(res, 400, "category must be a string (max 50 chars)", "BAD_REQUEST");
        return;
      }
    }

    if (store !== undefined && store !== null) {
      if (typeof store !== "string" || store.length > 50) {
        errorResponse(res, 400, "store name must be a string (max 50 chars)", "BAD_REQUEST");
        return;
      }
    }

    // Absent quantity is valid — the caller just didn't specify a count, and
    // no field will be written for it below. A SUPPLIED value must still be a
    // positive number, though.
    const hasExplicitQuantity = quantity !== undefined && quantity !== null;
    if (hasExplicitQuantity && (typeof quantity !== "number" || quantity < 1)) {
      errorResponse(res, 400, "quantity must be a positive number", "BAD_REQUEST");
      return;
    }
    // The count to ADD for merge/accumulation purposes — an absent quantity
    // still counts as 1, matching the app-wide "no explicit quantity means
    // one" convention.
    const mergeAddCount: number = hasExplicitQuantity ? quantity : 1;

    try {
      // 5. Determine the household's shopping capture-review mode (see the
      //    batch-mode branch above for the full rationale — same behavior
      //    here: only a newly created row is stamped `needsReview`, and the
      //    dedup match below only merges within the same held-state).
      const householdSnap = await db.doc(`households/${householdId}`).get();
      const incomingHeld = isManualReview(
        householdSnap.data()?.captureReview,
        "shopping"
      );

      // 6. Check for duplicate items (case-insensitive), scoped to the SAME
      //    held-state as this capture — a visible/auto item and a held/review
      //    item are never dedup candidates for each other (see FIX 3 comment
      //    on the batch-mode branch above).
      const existingItems = await db
        .collection(`households/${householdId}/shoppingList`)
        .where("isPurchased", "==", false)
        .get();

      const normalizedItem = item.trim().toLowerCase();
      const duplicate = existingItems.docs.find((doc) => {
        const data = doc.data();
        return (
          data.name?.toLowerCase() === normalizedItem &&
          (data.needsReview === true) === incomingHeld
        );
      });

      if (duplicate) {
        // Merge onto the existing item, preserving its unit (and reading a
        // legacy raw-number quantity correctly — no migration needed).
        // needsReview is deliberately left untouched — a quantity bump onto
        // an existing (visible or held) item must not retroactively toggle
        // its review state.
        const currentQty = duplicate.data().quantity as string | number | undefined;
        const merged = mergeQuantity(currentQty, mergeAddCount);
        await duplicate.ref.update({
          quantity: merged,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

        jsonResponse(res, 200, {
          success: true,
          message: `Updated "${item}" quantity to ${merged}`,
          data: {
            itemId: duplicate.id,
            name: item,
            quantity: merged,
            updated: true,
          },
        });
        return;
      }

      // 7. Create new shopping list item. No quantity was supplied -> write
      // NO quantity field at all (never invent a "1"). resolveNewQuantityField
      // also collapses an explicit count of 1 back to `undefined`, matching
      // that same convention for a single explicitly-requested unit.
      const resolvedQuantity = hasExplicitQuantity ? resolveNewQuantityField(quantity) : undefined;
      const shoppingItemData = {
        name: item.trim(),
        ...(resolvedQuantity !== undefined ? { quantity: resolvedQuantity } : {}),
        category,
        store: store || null,
        isPurchased: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "shortcut",
        ...(incomingHeld ? { needsReview: true } : {}),
      };

      const itemRef = await db
        .collection(`households/${householdId}/shoppingList`)
        .add(shoppingItemData);

      // 8. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

      // 9. Return success
      jsonResponse(res, 200, {
        success: true,
        message: `Added "${item}" to shopping list`,
        data: {
          itemId: itemRef.id,
          name: item,
          quantity: resolvedQuantity,
          category,
          store: store || null,
        },
      });
    } catch (error) {
      logger.error("Error in quickAddShoppingItem:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);

/**
 * Helper: Detects command type from text using keyword matching
 */
function detectCommandType(text: string): 'shopping' | 'todo' | 'expense' | 'unknown' {
  const lowerText = text.toLowerCase();

  // Shopping keywords
  if (lowerText.includes('shopping list') ||
      lowerText.includes('shopping') ||
      lowerText.includes('grocery') ||
      lowerText.includes('groceries') ||
      lowerText.includes('add to list') ||
      lowerText.includes('buy') ||
      lowerText.includes('get milk') ||
      lowerText.includes('get eggs') ||
      lowerText.includes('pick up')) {
    return 'shopping';
  }

  // Todo keywords
  if (lowerText.includes('remind me') ||
      lowerText.includes('to do') ||
      lowerText.includes('todo') ||
      lowerText.includes('task') ||
      lowerText.includes('need to') ||
      lowerText.includes('remember to') ||
      lowerText.includes('don\'t forget')) {
    return 'todo';
  }

  // Expense keywords
  if (lowerText.includes('spent') ||
      lowerText.includes('paid') ||
      lowerText.includes('cost') ||
      lowerText.includes('bought') ||
      lowerText.includes('expense') ||
      lowerText.includes('$') ||
      /\d+\s*(dollar|bucks|usd)/.test(lowerText)) {
    return 'expense';
  }

  return 'unknown';
}

/**
 * POST /quickAddNaturalLanguage
 * Accepts natural language text from iOS Shortcuts and queues it for processing
 */
export const quickAddNaturalLanguage = onRequest(
  { cors: false, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    applyCorsHeaders(req, res);

    // Handle preflight
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      errorResponse(res, 405, "Method not allowed", "METHOD_NOT_ALLOWED");
      return;
    }

    // 1. Validate API Key
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

    // 2. Check permissions (require at least one permission)
    if (!permissions?.shoppingList && !permissions?.expenses && !permissions?.habits) {
      errorResponse(res, 403, "API key does not have required permissions", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "shopping");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Validate request body
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      errorResponse(res, 400, "Missing required field: text", "BAD_REQUEST");
      return;
    }

    const trimmedText = text.trim();

    if (trimmedText.length === 0) {
      errorResponse(res, 400, "Text cannot be empty", "BAD_REQUEST");
      return;
    }

    if (trimmedText.length > 500) {
      errorResponse(res, 400, "Text too long (max 500 characters)", "BAD_REQUEST");
      return;
    }

    // 5. Detect command type
    const commandType = detectCommandType(trimmedText);

    // 6. Enforce permissions based on detected type
    switch (commandType) {
      case "expense":
        if (!permissions?.expenses) {
          errorResponse(res, 403, "API key does not have expenses permission", "FORBIDDEN");
          return;
        }
        break;
      case "shopping":
        if (!permissions?.shoppingList) {
          errorResponse(res, 403, "API key does not have shoppingList permission", "FORBIDDEN");
          return;
        }
        break;
      case "todo":
        if (!permissions?.habits) {
          errorResponse(res, 403, "API key does not have habits permission", "FORBIDDEN");
          return;
        }
        break;
      case "unknown":
      default:
        // For ambiguous commands, require all relevant permissions to prevent privilege escalation
        if (!permissions?.expenses || !permissions?.shoppingList || !permissions?.habits) {
          errorResponse(
            res,
            403,
            "API key does not have sufficient permissions for ambiguous command type",
            "FORBIDDEN"
          );
          return;
        }
        break;
    }

    try {

      // 7. Write to pendingItems collection
      const pendingItemData = {
        text: trimmedText,
        type: commandType,
        source: "shortcut",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processed: false,
      };

      const pendingRef = await db
        .collection(`households/${householdId}/pendingItems`)
        .add(pendingItemData);

      // 8. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

      // 9. Return success
      jsonResponse(res, 200, {
        success: true,
        message: "Command queued. Open app to process.",
        data: {
          itemId: pendingRef.id,
          type: commandType,
          text: trimmedText,
        },
      });
    } catch (error) {
      logger.error("Error in quickAddNaturalLanguage:", error);
      if (householdId && apiKey) {
        await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 500);
      }
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);

/**
 * POST /quickAddBillPay
 * Mark a matching upcoming calendar bill as paid ("Hey Siri, I paid rent").
 *
 * Accepts `{ title, today?, accountId? }`. Looks up the household's unpaid
 * EXPENSE calendar items (expanding recurring templates server-side via
 * billMatch.ts), matches by title (exact → contains → starts-with, earliest due
 * date wins), then replicates the client's payCalendarItem writeBatch with the
 * Admin SDK: it marks the bill paid (creating a paid-instance record for a
 * recurring occurrence), decrements the paying account's balance, and writes a
 * verified transaction — all in one atomic batch. Defaults to the household's
 * first checking account.
 */
export const quickAddBillPay = onRequest(
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

    // 1. Validate API Key
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

    // 2. Check permissions
    if (!permissions?.bills) {
      errorResponse(res, 403, "API key does not have bills permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "bill");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Parse and validate the request body
    const { title, accountId: rawAccountId, today: rawToday } = req.body || {};

    if (!title || typeof title !== "string" || !title.trim()) {
      errorResponse(res, 400, "title is required", "BAD_REQUEST");
      return;
    }
    if (title.length > 100) {
      errorResponse(res, 400, "title too long (max 100 chars)", "BAD_REQUEST");
      return;
    }

    // Caller-local date (yyyy-MM-dd). Functions run in UTC, so the iOS Shortcut's
    // local date anchors the due-date window (falls back to the server date).
    const today =
      typeof rawToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
        ? rawToday
        : format(new Date(), "yyyy-MM-dd");

    if (rawAccountId !== undefined && rawAccountId !== null) {
      if (typeof rawAccountId !== "string" || !isValidFirestoreId(rawAccountId)) {
        errorResponse(res, 400, "accountId contains invalid characters", "BAD_REQUEST");
        return;
      }
    }

    try {
      // 5. Load calendar items and find the matching unpaid bill.
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
            typeof data.parentRecurringId === "string"
              ? data.parentRecurringId
              : undefined,
          isDeleted: data.isDeleted === true,
        };
      });

      const match = findBillToPay(calendarItems, title, today);
      if (!match) {
        // Do not echo the user-supplied title back (public endpoint, unvalidated).
        errorResponse(res, 404, "No matching unpaid bill found", "NOT_FOUND");
        await logApiCall(householdId, apiKey.substring(0, 16), "bill", req.body, 404);
        return;
      }

      // 6. Resolve the paying account: explicit accountId (must be checking) →
      //    the household's first checking account. Bills always draw from
      //    checking (mirrors the Safe-to-Spend "checking is the pool" model).
      const accountsSnap = await db
        .collection(`households/${householdId}/accounts`)
        .get();
      const accounts = accountsSnap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          type: data.type,
          order: typeof data.order === "number" ? data.order : Number.MAX_SAFE_INTEGER,
        };
      });
      const checkingAccounts = accounts
        .filter((a) => a.type === "checking")
        .sort((a, b) => a.order - b.order);

      let payingAccountId: string | undefined;
      if (typeof rawAccountId === "string" && rawAccountId.trim()) {
        const explicit = checkingAccounts.find((a) => a.id === rawAccountId.trim());
        if (!explicit) {
          errorResponse(res, 400, "accountId is not a checking account", "BAD_REQUEST");
          await logApiCall(householdId, apiKey.substring(0, 16), "bill", req.body, 400);
          return;
        }
        payingAccountId = explicit.id;
      } else {
        payingAccountId = checkingAccounts[0]?.id;
      }

      if (!payingAccountId) {
        errorResponse(res, 400, "No checking account to pay from", "BAD_REQUEST");
        await logApiCall(householdId, apiKey.substring(0, 16), "bill", req.body, 400);
        return;
      }

      // 7. Read household for currency + pay-period calculation.
      const householdRef = db.doc(`households/${householdId}`);
      const householdDoc = await householdRef.get();
      const householdData = householdDoc.data();
      const currency = householdData?.currency || "USD";

      const paidAmount = Math.round(match.amount * 100) / 100;
      const specificDate = match.date;
      const payPeriodId = getPayPeriodForTransaction(
        specificDate,
        householdData?.lastPaycheckDate
      );

      // 8. Atomic writeBatch mirroring the client's payCalendarItem: mark the
      //    bill paid, decrement the account balance, write a verified txn.
      const batch = db.batch();

      if (isRecurringId(match.id)) {
        // Recurring occurrence → create a paid-instance record (suppresses the
        // synthetic occurrence on future expansions).
        const parsed = parseRecurringId(match.id);
        if (!parsed) {
          errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
          await logApiCall(householdId, apiKey.substring(0, 16), "bill", req.body, 500);
          return;
        }
        const newCalendarRef = db
          .collection(`households/${householdId}/calendarItems`)
          .doc();
        batch.set(newCalendarRef, {
          title: match.title,
          amount: paidAmount,
          date: specificDate,
          type: "expense",
          isPaid: true,
          isRecurring: false,
          parentRecurringId: parsed.templateId,
          source: "shortcut",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        batch.update(
          db.doc(`households/${householdId}/calendarItems/${match.id}`),
          { isPaid: true, amount: paidAmount }
        );
      }

      // Account balance delta (server-side increment avoids lost updates).
      batch.update(db.doc(`households/${householdId}/accounts/${payingAccountId}`), {
        balance: admin.firestore.FieldValue.increment(-paidAmount),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Verified transaction dated to the bill's due date.
      const transactionRef = db
        .collection(`households/${householdId}/transactions`)
        .doc();
      batch.set(transactionRef, {
        amount: paidAmount,
        merchant: match.title,
        category: BUDGETED_IN_CALENDAR,
        date: specificDate,
        status: "verified",
        isRecurring: !!match.isRecurring,
        source: "shortcut" as const,
        autoCategorized: true,
        payPeriodId,
        accountId: payingAccountId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();

      // 9. Log + respond.
      await logApiCall(householdId, apiKey.substring(0, 16), "bill", req.body, 200);
      jsonResponse(res, 200, {
        success: true,
        message: `Paid ${match.title}: ${formatCurrency(paidAmount, { currency })}`,
        data: {
          transactionId: transactionRef.id,
          title: match.title,
          amount: paidAmount,
          date: specificDate,
          accountId: payingAccountId,
          payPeriodId,
        },
      });
    } catch (error) {
      logger.error("Error in quickAddBillPay:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "bill", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);

/**
 * POST /quickAddTodo
 * Create a shared household to-do via iOS Shortcuts / Siri (F-TODO-07).
 *
 * Accepts `{ text, parse?, dueDate?, dueTime?, reminderMinutesBefore?,
 * assignedTo?, isImportant?, category?, today? }`. When `parse === true` (F-TODO-15) the
 * server first runs the deterministic natural-language parser
 * (todoParser.ts) over `text` — "Call dentist tomorrow at 3pm, remind me 30
 * minutes before" — and any explicit structured field still overrides its
 * parsed counterpart. `dueTime` (F-TODO-14) is HH:mm 24-hour wall-clock
 * in the assignee's timezone; `reminderMinutesBefore` (non-negative integer
 * minutes of lead time, 0 = at the due time) requires `dueTime`. `dueDate`
 * defaults to the caller-local "today" (forwarded the same way
 * quickAddExpense/quickAddHabit already do — Cloud Functions run in UTC).
 * `assignedTo` is resolved against the household's members: an exact uid
 * match wins, otherwise a fuzzy display-name match (same tiering as
 * habitProcessor's fuzzyMatchHabit / todoMatch's fuzzyMatchMember). Writes
 * with `source: 'shortcut'` — already a valid `ToDo.source` value, so no
 * schema/rules change is needed. When the household's `captureReview.todo`
 * setting is `'review'` the created to-do is stamped `needsReview: true`
 * (held out of the visible list until approved) — see captureReview.ts.
 * `category` (F-TODO-16) is optional free text (max 50 chars); it is resolved
 * case-insensitively against the household's `todoCategories` vocabulary via
 * `resolveTodoCategory` (todoCategoryMatch.ts) — a match adopts the
 * household's stored casing, a miss is stored as-is (the household's
 * `todoCategories` list itself is never mutated by this endpoint, minting a
 * new category is a UI action), and an absent/blank/whitespace-only value
 * leaves the to-do Uncategorized (the field is omitted, never written as '').
 */
export const quickAddTodo = onRequest(
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

    // 1. Validate API Key
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

    // 2. Check permissions
    if (!permissions?.todos) {
      errorResponse(res, 403, "API key does not have todos permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit
    const rateLimit = await checkRateLimit(householdId, "todo");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 3600000) / 1000)));
      errorResponse(res, 429, "Rate limit exceeded. Try again later.", "RATE_LIMITED");
      return;
    }

    // 4. Parse and validate the request body
    const {
      text,
      parse: rawParse,
      dueDate: rawDueDate,
      dueTime: rawDueTime,
      reminderMinutesBefore: rawReminder,
      assignedTo: rawAssignedTo,
      isImportant: rawIsImportant,
      category: rawCategory,
      today: rawToday,
    } = req.body || {};

    if (!text || typeof text !== "string" || !text.trim()) {
      errorResponse(res, 400, "text is required", "BAD_REQUEST");
      return;
    }
    if (text.length > 500) {
      errorResponse(res, 400, "text too long (max 500 chars)", "BAD_REQUEST");
      return;
    }

    // Caller-local date (yyyy-MM-dd). Functions run in UTC, so the iOS Shortcut's
    // local date anchors the default due date (falls back to the server date) —
    // same pattern as quickAddHabit/quickAddExpense/quickAddBillPay.
    const today =
      typeof rawToday === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
        ? rawToday
        : format(new Date(), "yyyy-MM-dd");

    // F-TODO-15: optional deterministic natural-language parsing. Runs before
    // the structured-field validation; every explicit field below still
    // overrides its parsed counterpart.
    const parsed = rawParse === true ? parseTodoPhrase(text.trim(), today) : null;
    const taskText = parsed ? parsed.text : text.trim();

    let dueDate: string;
    if (rawDueDate !== undefined && rawDueDate !== null && rawDueDate !== "") {
      if (typeof rawDueDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rawDueDate)) {
        errorResponse(res, 400, "dueDate must be in YYYY-MM-DD format", "BAD_REQUEST");
        return;
      }
      dueDate = rawDueDate;
    } else {
      dueDate = parsed?.dueDate ?? today;
    }

    // F-TODO-14: optional due time + reminder lead time. Mirrors the client
    // form's constraint: a reminder is only meaningful anchored to a time.
    let dueTime: string | undefined;
    if (rawDueTime !== undefined && rawDueTime !== null && rawDueTime !== "") {
      if (typeof rawDueTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(rawDueTime)) {
        errorResponse(res, 400, "dueTime must be in HH:mm 24-hour format", "BAD_REQUEST");
        return;
      }
      dueTime = rawDueTime;
    } else {
      dueTime = parsed?.dueTime;
    }

    let reminderMinutesBefore: number | undefined;
    if (rawReminder !== undefined && rawReminder !== null && rawReminder !== "") {
      const parsedNum = typeof rawReminder === "string" ? Number(rawReminder) : rawReminder;
      if (typeof parsedNum !== "number" || !Number.isInteger(parsedNum) || parsedNum < 0 || parsedNum > 10080) {
        errorResponse(
          res, 400,
          "reminderMinutesBefore must be a non-negative integer number of minutes (max 10080)",
          "BAD_REQUEST"
        );
        return;
      }
      if (dueTime === undefined) {
        errorResponse(res, 400, "reminderMinutesBefore requires dueTime", "BAD_REQUEST");
        return;
      }
      reminderMinutesBefore = parsedNum;
    } else if (parsed?.reminderMinutesBefore !== undefined && dueTime !== undefined) {
      // Parser output is already anchored, but an explicit rawDueTime of ""
      // could have cleared the anchor — re-check before adopting.
      reminderMinutesBefore = parsed.reminderMinutesBefore;
    }

    if (rawIsImportant !== undefined && rawIsImportant !== null) {
      if (typeof rawIsImportant !== "boolean") {
        errorResponse(res, 400, "isImportant must be a boolean", "BAD_REQUEST");
        return;
      }
    }
    const isImportant = rawIsImportant === true || (rawIsImportant == null && parsed?.isImportant === true);

    if (rawAssignedTo !== undefined && rawAssignedTo !== null && rawAssignedTo !== "") {
      if (typeof rawAssignedTo !== "string" || rawAssignedTo.length > 100) {
        errorResponse(res, 400, "assignedTo must be a string (max 100 chars)", "BAD_REQUEST");
        return;
      }
    }

    // F-TODO-16: category, if supplied, must be a string — resolution
    // (case-insensitive matching + the length cap) happens in
    // resolveTodoCategory below, once the household's todoCategories are on hand.
    if (rawCategory !== undefined && rawCategory !== null && typeof rawCategory !== "string") {
      errorResponse(res, 400, "category must be a string", "BAD_REQUEST");
      return;
    }

    try {
      // 5. Determine the household's todo capture-review mode — a todo
      //    created while todos are in 'review' mode is held (needsReview:
      //    true) until approved. See captureReview.ts.
      const householdSnap = await db.doc(`households/${householdId}`).get();
      const householdData = householdSnap.data();
      const todoManualReview = isManualReview(householdData?.captureReview, "todo");

      // F-TODO-16: resolve the optional category against the household's
      // existing vocabulary (case-insensitive; adopts stored casing on match,
      // stored as-is on miss). Absent/blank stays Uncategorized.
      const category = resolveTodoCategory(
        typeof rawCategory === "string" ? rawCategory : undefined,
        householdData?.todoCategories
      );

      // 6. Resolve assignedTo (uid or fuzzy display-name match) against the
      //    household's members. Absent when not provided — the client's
      //    ToDo form treats an unassigned todo the same way.
      let assignedTo: string | undefined;
      if (typeof rawAssignedTo === "string" && rawAssignedTo.trim()) {
        const membersSnap = await db
          .collection(`households/${householdId}/members`)
          .get();
        const members: MemberLike[] = membersSnap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            uid: d.id,
            displayName: typeof data.displayName === "string" ? data.displayName : "",
          };
        });

        const trimmed = rawAssignedTo.trim();
        // An explicit uid always wins over the fuzzy name match.
        const byUid = members.find((m) => m.uid === trimmed);
        const matched = byUid ?? fuzzyMatchMember(members, trimmed);
        if (!matched) {
          // Do not echo the user-supplied assignedTo back (public endpoint,
          // unvalidated input).
          errorResponse(res, 404, "No matching household member for assignedTo", "NOT_FOUND");
          await logApiCall(householdId, apiKey.substring(0, 16), "todo", req.body, 404);
          return;
        }
        assignedTo = matched.uid;
      }

      // F-TODO-14: a reminder push goes to the ASSIGNEE, so an unassigned
      // timed reminder would never fire — and would pollute the 15-minute
      // reminder scan forever (matches the query, skipped in memory, never
      // stamped). The app's edit drawer already requires an assignee; here we
      // default to the API key's owner ("remind ME"), or reject when there is
      // no one to anchor to.
      if (reminderMinutesBefore !== undefined && assignedTo === undefined) {
        if (validation.keyCreatedBy) {
          assignedTo = validation.keyCreatedBy;
        } else {
          // No logApiCall: validation-error 400s in this endpoint don't log
          // (only household-data failures like the assignedTo 404 do).
          errorResponse(
            res, 400,
            "reminderMinutesBefore requires assignedTo (reminders are delivered to the assignee)",
            "BAD_REQUEST"
          );
          return;
        }
      }

      // 7. Create the to-do document.
      const todoData: Record<string, unknown> = {
        text: taskText,
        completeByDate: dueDate,
        isCompleted: false,
        source: "shortcut",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(assignedTo ? { assignedTo } : {}),
        ...(isImportant ? { isImportant: true } : {}),
        ...(dueTime !== undefined ? { dueTime } : {}),
        ...(reminderMinutesBefore !== undefined ? { reminderMinutesBefore } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(validation.keyCreatedBy ? { createdBy: validation.keyCreatedBy } : {}),
        ...(todoManualReview ? { needsReview: true } : {}),
      };

      const todoRef = await db
        .collection(`households/${householdId}/todos`)
        .add(todoData);

      // 8. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "todo", req.body, 200);

      // 9. Return success
      jsonResponse(res, 200, {
        success: true,
        message: `Added to-do: ${taskText}`,
        data: {
          todoId: todoRef.id,
          text: taskText,
          completeByDate: dueDate,
          assignedTo: assignedTo ?? null,
          isImportant,
          dueTime: dueTime ?? null,
          reminderMinutesBefore: reminderMinutesBefore ?? null,
          category: category ?? null,
        },
      });
    } catch (error) {
      logger.error("Error in quickAddTodo:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "todo", req.body, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);
