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

      // 6. Check if habit is stale and reset if needed
      if (isHabitStale(habit)) {
        const resetUpdate = resetStaleHabit(habit);
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
    const { amount: rawAmount, merchant, category = "Uncategorized", date, notes } = req.body || {};

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
      logger.warn(`Invalid amount received: ${JSON.stringify({ rawAmount, amount, type: typeof rawAmount })}`);
      errorResponse(
        res,
        400,
        `amount must be a valid number. Received: ${typeof rawAmount === 'undefined' ? 'undefined' : JSON.stringify(rawAmount)}. ` +
          `Send a plain number (50 or -50) or a currency string ("$50.00"). Both positive and negative values are accepted.`,
        "BAD_REQUEST"
      );
      return;
    }

    // Accept both positive and negative amounts — iOS automation sign varies by version.
    // Expenses are always stored as positive numbers; the sign carries no meaning here.
    amount = Math.abs(amount);

    // Skip zero-dollar holds. Apple Pay's "Transaction" automation trigger fires on the
    // authorization event, which for many cards/merchants (gas, hotels, tipped purchases)
    // comes through as a $0 pre-authorization hold. The real amount settles later on the
    // bank side and does NOT re-fire the on-device trigger, so a $0 here is never the final
    // amount — it would just clutter the review queue. We drop it without creating a
    // transaction, but still log the event (Cloud Logging + api_calls) so it's possible to
    // see how often these holds occur. Returns 200 so the iOS shortcut doesn't show an error.
    if (amount === 0) {
      // Truncate before logging: merchant length validation runs later in this
      // function, so guard against an oversized string bloating the log here.
      const merchantLabel =
        typeof merchant === "string" && merchant.trim()
          ? merchant.trim().substring(0, 100)
          : "unknown merchant";
      logger.info(
        `Skipped zero-dollar Apple Pay hold for household ${householdId} at ${merchantLabel}`
      );
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);
      jsonResponse(res, 200, {
        success: true,
        skipped: true,
        message: "Skipped zero-dollar hold (Apple Pay pre-authorization, not a real charge)",
      });
      return;
    }

    // Security: Input validation & sanitization
    if (!merchant || typeof merchant !== "string") {
      errorResponse(res, 400, "merchant is required", "BAD_REQUEST");
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

    const transactionDate = date || format(new Date(), "yyyy-MM-dd");

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
      errorResponse(res, 400, "date must be in YYYY-MM-DD format", "BAD_REQUEST");
      return;
    }

    try {
      // 5. Get household data for pay period calculation
      const householdRef = db.doc(`households/${householdId}`);
      const householdDoc = await householdRef.get();
      const householdData = householdDoc.data();

      // Calculate pay period (simplified - just use the transaction date)
      const payPeriodId = householdData?.lastPaycheckDate || transactionDate;

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
      };

      const transactionRef = await db
        .collection(`households/${householdId}/transactions`)
        .add(transactionData);

      // Note: Don't deduct from checking yet - that happens when user verifies the transaction

      // 7. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);

      // 8. Return success
      jsonResponse(res, 200, {
        success: true,
        message: `Expense added: $${amount.toFixed(2)} at ${merchant} (pending review)`,
        data: {
          transactionId: transactionRef.id,
          amount,
          merchant,
          category,
          date: transactionDate,
          status: "pending_review",
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
            const result = results.find((r) => r.name === itemName);
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
