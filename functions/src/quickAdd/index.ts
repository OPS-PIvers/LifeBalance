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
} from "./habitProcessor";
import { formatCurrency } from "../utils/formatCurrency";
import { getPayPeriodForTransaction } from "../plaid/payPeriod";
import {
  RECONCILE_WINDOW_MS,
  pickFillTarget,
  buildFillUpdates,
  type ReconcileCandidate,
} from "./reconcile";
import {
  matchAccountByLast4,
  normalizeCardLast4,
  normalizeUsDate,
  type AccountLike,
} from "./accountMatch";
import { parseTransactionEmail } from "./emailParser";
import { isLikelyDuplicate, type IdentityTransaction } from "./transactionIdentity";

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

// CORS headers for iOS Shortcuts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * POST /quickAddHabit
 * Toggle a habit by ID or name
 */
export const quickAddHabit = onRequest(
  { cors: true, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) =>
      res.set(key, value)
    );

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
        // Fuzzy match by name
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

      if (!habit || !habitRef) {
        errorResponse(res, 404, `Habit not found: ${habitId || habitName}`, "NOT_FOUND");
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
  { cors: true, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) =>
      res.set(key, value)
    );

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
      // The email Shortcut ran but the body never made it into the request.
      // The usual mis-wiring is the emailText field not pointing at the "Get
      // Text from Input" output — say so precisely, because this message is
      // exactly what the Shortcut's own notification shows the user.
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 400);
      errorResponse(
        res,
        400,
        "emailText was empty — the automation ran but no email body reached the " +
          "server. In the Shortcut, set emailText to the Text output of " +
          "“Get Text from Input” and set that action's input to Shortcut Input.",
        "BAD_REQUEST"
      );
      return;
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
      // A field counts as "missing" when absent OR blank — a Shortcut with an
      // empty variable sends "" and must not block the parser's value.
      const isBlank = (v: unknown): boolean =>
        v === undefined || v === null || (typeof v === "string" && !v.trim());
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
        const cutoff = admin.firestore.Timestamp.fromMillis(
          Date.now() - RECONCILE_WINDOW_MS
        );
        // Single where() → covered by the automatic single-field index on
        // createdAt; the window is tiny so we filter the rest in memory.
        const recentSnap = await db
          .collection(transactionsPath)
          .where("createdAt", ">=", cutoff)
          .get();

        const reconcileCandidates: ReconcileCandidate[] = [];
        const identityCandidates: (IdentityTransaction & { id: string })[] = [];
        const refById = new Map<string, admin.firestore.DocumentReference>();
        for (const d of recentSnap.docs) {
          const data = d.data() as Record<string, unknown>;
          refById.set(d.id, d.ref);

          // Stub-fill candidates: only source:'shortcut' pending rows (unchanged).
          if (
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
            { amount, merchant: merchant.trim(), category, accountId: resolvedAccountId },
            reconcileCandidates
          );
          const targetRef = target ? refById.get(target.id) : undefined;
          if (target && targetRef) {
            await targetRef.update(
              buildFillUpdates({ amount, merchant: merchant.trim(), category, accountId: resolvedAccountId })
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
          // No unambiguous stub to fill → fall through to identity dedup, then a normal row.
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
        // Apple Pay $0 pre-auth stub: flags the review UI that the real amount
        // still needs to be entered. Omitted for normal (amount > 0) expenses.
        ...(amount === 0 ? { needsAmount: true } : {}),
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
 * POST /quickAddReceipt
 * Scan a receipt image and optionally create a transaction
 *
 * Note: This endpoint requires the Gemini API to be configured on the server.
 * For now, this is a placeholder that returns a "not implemented" response.
 * Full implementation requires:
 * 1. Installing @google/genai in functions package
 * 2. Setting up GEMINI_API_KEY in Firebase environment config
 * 3. Porting the analyzeReceipt logic from the client
 */
export const quickAddReceipt = onRequest(
  { cors: true, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) =>
      res.set(key, value)
    );

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
    if (!permissions?.receiptScanning) {
      errorResponse(res, 403, "API key does not have receiptScanning permission", "FORBIDDEN");
      return;
    }

    // 3. Check rate limit (uses daily AI quota)
    const rateLimit = await checkRateLimit(householdId, "receipt");
    if (!rateLimit.allowed) {
      res.set("Retry-After", String(Math.ceil((rateLimit.retryAfterMs || 86400000) / 1000)));
      errorResponse(res, 429, "Daily receipt scanning quota exceeded. Try again tomorrow.", "RATE_LIMITED");
      return;
    }

    // 4. Parse request body
    const { image, autoCreate = false } = req.body || {};

    if (!image || typeof image !== "string") {
      errorResponse(res, 400, "image (base64) is required", "BAD_REQUEST");
      return;
    }

    // Check image size (rough check - base64 is ~33% larger than binary)
    // 5MB binary = ~6.67MB base64
    if (image.length > 7 * 1024 * 1024) {
      errorResponse(res, 400, "Image too large. Maximum size is 5MB.", "BAD_REQUEST");
      return;
    }

    try {
      // For now, return a placeholder response
      // TODO: Implement Gemini integration in Cloud Functions
      // This requires:
      // 1. npm install @google/genai in functions/
      // 2. firebase functions:config:set gemini.api_key="YOUR_KEY"
      // 3. Port analyzeReceipt logic

      await logApiCall(householdId, apiKey.substring(0, 16), "receipt", { imageSize: image.length, autoCreate }, 501);

      errorResponse(
        res,
        501,
        "Receipt scanning is not yet implemented in Cloud Functions. Use the app for receipt scanning.",
        "NOT_IMPLEMENTED"
      );
    } catch (error) {
      logger.error("Error in quickAddReceipt:", error);
      await logApiCall(householdId, apiKey.substring(0, 16), "receipt", { autoCreate }, 500);
      errorResponse(res, 500, "Internal server error", "INTERNAL_ERROR");
    }
  }
);

/**
 * POST /quickAddShoppingItem
 * Add an item to the shopping list via voice or shortcut
 */
export const quickAddShoppingItem = onRequest(
  { cors: true, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) =>
      res.set(key, value)
    );

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
    // Support both single item and batch items for flexibility
    const { item, items, quantity = 1, category = "Other", store } = req.body || {};

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
        // 5. Fetch existing items once for duplicate checking
        const shoppingListRef = db.collection(
          `households/${householdId}/shoppingList`
        );
        const existingItems = await shoppingListRef
          .where("isPurchased", "==", false)
          .get();

        const results: Array<{
          itemId: string;
          name: string;
          quantity: number;
          category?: string;
          store?: string | null;
          updated?: boolean;
          created?: boolean;
        }> = [];

        // 6. Plan all writes into a single WriteBatch so all items are
        //    committed atomically in one round-trip instead of N sequential
        //    awaits (matches the client's writeBatch pattern in
        //    contexts/FirebaseHouseholdContext.tsx handleShoppingItems).
        const batch = db.batch();

        // Build a mutable map of normalized-name → resolved quantity so that
        // within-batch duplicate detection works even when the same item name
        // appears more than once in the request array.
        const pendingQuantities = new Map<string, { ref: admin.firestore.DocumentReference; quantity: number }>();

        for (const itemObj of items) {
          const itemName = itemObj.item.trim();
          const itemQuantity = itemObj.quantity || 1;
          const itemCategory = itemObj.category || category;
          const itemStore = itemObj.store || store || null;

          const normalizedItem = itemName.toLowerCase();

          // Check if a previous iteration of this batch already touched this
          // item (within-batch dedup before checking Firestore).
          const pending = pendingQuantities.get(normalizedItem);
          if (pending !== undefined) {
            pending.quantity += itemQuantity;
            // Update the already-queued batch operation in-place.
            batch.update(pending.ref, {
              quantity: pending.quantity,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            });
            const result = results.find(
              (r) => r.name.toLowerCase() === normalizedItem
            );
            if (result !== undefined) {
              result.quantity = pending.quantity;
            }
            continue;
          }

          const duplicate = existingItems.docs.find(
            (doc) => doc.data().name?.toLowerCase() === normalizedItem
          );

          if (duplicate) {
            // Update quantity of existing item
            const currentQty = duplicate.data().quantity || 1;
            const newQty = currentQty + itemQuantity;
            batch.update(duplicate.ref, {
              quantity: newQty,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            });
            pendingQuantities.set(normalizedItem, { ref: duplicate.ref, quantity: newQty });
            results.push({
              itemId: duplicate.id,
              name: itemName,
              quantity: newQty,
              updated: true,
            });
          } else {
            // Pre-allocate a new doc ref so we can return its id synchronously
            // and still commit everything in a single batch.
            const newRef = shoppingListRef.doc();
            const shoppingItemData = {
              name: itemName,
              quantity: itemQuantity,
              category: itemCategory,
              store: itemStore,
              isPurchased: false,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
              source: "shortcut",
            };
            batch.set(newRef, shoppingItemData);
            pendingQuantities.set(normalizedItem, { ref: newRef, quantity: itemQuantity });
            results.push({
              itemId: newRef.id,
              name: itemName,
              quantity: itemQuantity,
              category: itemCategory,
              store: itemStore,
              created: true,
            });
          }
        }

        // Commit all creates/updates in one round-trip.
        await batch.commit();

        // 7. Log API call
        await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

        // 8. Return success with all results
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

    if (typeof quantity !== "number" || quantity < 1) {
      errorResponse(res, 400, "quantity must be a positive number", "BAD_REQUEST");
      return;
    }

    try {
      // 5. Check for duplicate items (case-insensitive)
      const existingItems = await db
        .collection(`households/${householdId}/shoppingList`)
        .where("isPurchased", "==", false)
        .get();

      const normalizedItem = item.trim().toLowerCase();
      const duplicate = existingItems.docs.find(
        (doc) => doc.data().name?.toLowerCase() === normalizedItem
      );

      if (duplicate) {
        // Update quantity instead of creating duplicate
        const currentQty = duplicate.data().quantity || 1;
        await duplicate.ref.update({
          quantity: currentQty + quantity,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });

        await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

        jsonResponse(res, 200, {
          success: true,
          message: `Updated "${item}" quantity to ${currentQty + quantity}`,
          data: {
            itemId: duplicate.id,
            name: item,
            quantity: currentQty + quantity,
            updated: true,
          },
        });
        return;
      }

      // 6. Create new shopping list item
      const shoppingItemData = {
        name: item.trim(),
        quantity,
        category,
        store: store || null,
        isPurchased: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: "shortcut",
      };

      const itemRef = await db
        .collection(`households/${householdId}/shoppingList`)
        .add(shoppingItemData);

      // 7. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "shopping", req.body, 200);

      // 8. Return success
      jsonResponse(res, 200, {
        success: true,
        message: `Added "${item}" to shopping list`,
        data: {
          itemId: itemRef.id,
          name: item,
          quantity,
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
  { cors: true, region: "us-central1" },
  async (req, res) => {
    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) =>
      res.set(key, value)
    );

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
