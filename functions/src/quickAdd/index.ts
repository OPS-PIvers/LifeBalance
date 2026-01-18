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
} from "./apiKeyValidation";
import {
  Habit,
  isHabitStale,
  processToggleHabit,
  resetStaleHabit,
  fuzzyMatchHabit,
} from "./habitProcessor";

const db = admin.firestore();

// Common response helpers
function jsonResponse(
  res: any,
  status: number,
  data: Record<string, unknown>
): void {
  res.status(status).json(data);
}

function errorResponse(
  res: any,
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
    const { habitId, habitName, direction = "up" } = req.body || {};

    if (!habitId && !habitName) {
      errorResponse(res, 400, "Either habitId or habitName is required", "BAD_REQUEST");
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
      const result = processToggleHabit(habit, direction);

      if (!result) {
        errorResponse(res, 400, "Cannot decrement habit below 0", "BAD_REQUEST");
        await logApiCall(householdId, apiKey.substring(0, 16), "habit", req.body, 400);
        return;
      }

      // 8. Update Firestore
      await habitRef.update({
        ...result.updatedHabit,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });

      // 9. Update household points
      if (result.pointsChange !== 0) {
        const householdRef = db.doc(`households/${householdId}`);
        await householdRef.update({
          "points.daily": admin.firestore.FieldValue.increment(result.pointsChange),
          "points.weekly": admin.firestore.FieldValue.increment(result.pointsChange),
          "points.total": admin.firestore.FieldValue.increment(result.pointsChange),
        });
      }

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
    const { amount, merchant, category = "Uncategorized", date, notes } = req.body || {};

    if (typeof amount !== "number" || amount <= 0) {
      errorResponse(res, 400, "amount must be a positive number", "BAD_REQUEST");
      return;
    }

    if (!merchant || typeof merchant !== "string") {
      errorResponse(res, 400, "merchant is required", "BAD_REQUEST");
      return;
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

      // 6. Create transaction document
      const transactionData = {
        amount,
        merchant: merchant.trim(),
        category,
        date: transactionDate,
        status: "verified",
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

      // 7. Deduct from checking account
      const accountsSnapshot = await db
        .collection(`households/${householdId}/accounts`)
        .where("type", "==", "checking")
        .limit(1)
        .get();

      let newCheckingBalance: number | null = null;

      if (!accountsSnapshot.empty) {
        const checkingAccount = accountsSnapshot.docs[0];
        const currentBalance = checkingAccount.data().balance || 0;
        newCheckingBalance = currentBalance - amount;

        await checkingAccount.ref.update({
          balance: newCheckingBalance,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 8. Log API call
      await logApiCall(householdId, apiKey.substring(0, 16), "expense", req.body, 200);

      // 9. Return success
      jsonResponse(res, 200, {
        success: true,
        message: `Expense added: $${amount.toFixed(2)} at ${merchant}`,
        data: {
          transactionId: transactionRef.id,
          amount,
          merchant,
          category,
          date: transactionDate,
          newCheckingBalance,
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
