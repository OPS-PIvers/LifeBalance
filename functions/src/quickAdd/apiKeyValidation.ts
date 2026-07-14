import * as admin from "firebase-admin";
import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";

const db = admin.firestore();

export interface ApiKeyPermissions {
  habits: boolean;
  expenses: boolean;
  shoppingList: boolean;
  // Pay/mark a calendar bill via quickAddBillPay (F-MONEY-11). Optional so keys
  // minted before this permission existed keep validating (bills defaults off).
  bills?: boolean;
  receiptScanning: boolean;
}

export interface HouseholdApiKey {
  id: string;
  hashedKey: string;
  keyPrefix: string;
  name: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  usageCount: number;
  status: "active" | "revoked";
  permissions: ApiKeyPermissions;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  householdId?: string;
  permissions?: ApiKeyPermissions;
  keyId?: string;
  keyCreatedBy?: string;  // uid of the user who created the API key
  error?: string;
}

// Rate limit configurations
const RATE_LIMITS = {
  habit: { limit: 100, windowMs: 60 * 60 * 1000 }, // 100/hour
  expense: { limit: 50, windowMs: 60 * 60 * 1000 }, // 50/hour
  shopping: { limit: 100, windowMs: 60 * 60 * 1000 }, // 100/hour
  bill: { limit: 50, windowMs: 60 * 60 * 1000 }, // 50/hour
};

/**
 * Validate API key format
 * Format: lb_{householdPrefix}_{32hexChars}
 */
export function isValidKeyFormat(key: string): boolean {
  return /^lb_[a-zA-Z0-9]{6}_[a-f0-9]{32}$/.test(key);
}

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Extract the Authorization header and return the API key
 */
export function extractApiKey(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7); // Remove "Bearer " prefix
}

/**
 * Validate an API key and return household info
 */
export async function validateApiKey(
  providedKey: string
): Promise<ApiKeyValidationResult> {
  // 1. Check format
  if (!isValidKeyFormat(providedKey)) {
    logger.warn("Invalid API key format");
    return { valid: false, error: "Invalid API key format" };
  }

  // 2. Hash the provided key
  const hashedKey = hashApiKey(providedKey);

  // 3. Use a collection-group query (backed by the composite index on hashedKey+status)
  //    to find the matching API key in a single read, regardless of which household owns it.
  try {
    const apiKeysSnapshot = await db
      .collectionGroup("apiKeys")
      .where("hashedKey", "==", hashedKey)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (apiKeysSnapshot.empty) {
      logger.warn("API key not found or revoked");
      return { valid: false, error: "Invalid or revoked API key" };
    }

    // .limit(1) guarantees exactly one doc when not empty; guard for noUncheckedIndexedAccess
    const keyDoc = apiKeysSnapshot.docs[0];
    if (!keyDoc) {
      logger.error("Unexpected empty docs after non-empty check");
      return { valid: false, error: "Internal error" };
    }
    const keyData = keyDoc.data() as HouseholdApiKey;

    // Derive householdId from the document path:
    // path is households/{householdId}/apiKeys/{keyId}
    const householdId = keyDoc.ref.parent.parent?.id;
    if (!householdId) {
      logger.error("Could not derive householdId from API key document path");
      return { valid: false, error: "Internal error" };
    }

    // Update usage tracking (fire-and-forget)
    keyDoc.ref
      .update({
        lastUsedAt: new Date().toISOString(),
        usageCount: admin.firestore.FieldValue.increment(1),
      })
      .catch((err) => logger.error("Failed to update key usage:", err));

    logger.info(`API key validated for household: ${householdId}`);
    return {
      valid: true,
      householdId,
      permissions: keyData.permissions,
      keyId: keyDoc.id,
      keyCreatedBy: keyData.createdBy,
    };
  } catch (error) {
    logger.error("Error validating API key:", error);
    return { valid: false, error: "Internal error" };
  }
}

/**
 * Check rate limit for a specific endpoint type
 */
export async function checkRateLimit(
  householdId: string,
  endpointType: "habit" | "expense" | "shopping" | "bill"
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const config = RATE_LIMITS[endpointType];
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const usageRef = db.doc(`households/${householdId}/apiUsage/${endpointType}`);

  try {
    // Wrap the read + conditional write in a transaction so concurrent
    // requests can't both pass the limit check and over-increment the counter.
    return await db.runTransaction(async (txn) => {
      const usageDoc = await txn.get(usageRef);
      const data = usageDoc.data();

      if (!data) {
        // First request, create tracking doc
        txn.set(usageRef, {
          count: 1,
          windowStart: now,
          lastRequest: now,
        });
        return { allowed: true };
      }

      // Check if we need to reset the window
      if (data.windowStart < windowStart) {
        // Window expired, reset
        txn.set(usageRef, {
          count: 1,
          windowStart: now,
          lastRequest: now,
        });
        return { allowed: true };
      }

      // Check if limit exceeded
      if (data.count >= config.limit) {
        const retryAfterMs = data.windowStart + config.windowMs - now;
        logger.warn(
          `Rate limit exceeded for ${endpointType} in household ${householdId}`
        );
        return { allowed: false, retryAfterMs };
      }

      // Increment counter
      txn.update(usageRef, {
        count: admin.firestore.FieldValue.increment(1),
        lastRequest: now,
      });

      return { allowed: true };
    });
  } catch (error) {
    // Fail CLOSED: if the rate-limit bookkeeping read/write errors, deny the
    // request rather than letting it through. The quickAdd endpoints are public
    // (API-key auth only), so failing open would let an attacker bypass the
    // limiter entirely by inducing Firestore errors — unbounded writes and
    // Firebase billing amplification. The short retry window keeps a transient
    // Firestore blip from locking a legitimate caller out for the full
    // rate-limit window (callers honor the Retry-After header we return).
    logger.error("Error checking rate limit (failing closed):", error);
    return { allowed: false, retryAfterMs: 60 * 1000 };
  }
}

/**
 * Recursively sanitize objects for logging
 * - Redacts sensitive keys
 * - Truncates long strings
 * - Limits recursion depth
 */
export function sanitizeForLogging(obj: unknown, depth = 0): unknown {
  if (depth > 5) return "[DEPTH_EXCEEDED]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    if (obj.length > 500) return obj.substring(0, 500) + "... [TRUNCATED]";
    return obj;
  }
  if (typeof obj === "number" || typeof obj === "boolean") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item: unknown) => sanitizeForLogging(item, depth + 1));
  }

  if (typeof obj === "object") {
    const newObj: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      const lowerKey = key.toLowerCase();
      // Redact sensitive keys
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("auth") ||
        lowerKey.includes("creditcard") ||
        lowerKey.includes("cvv") ||
        lowerKey === "image" ||
        // Redact keys that are likely API keys (but not keyPrefix/keyId)
        (lowerKey.includes("key") &&
          !lowerKey.includes("prefix") &&
          !lowerKey.includes("id"))
      ) {
        newObj[key] = "[REDACTED]";
      } else {
        newObj[key] = sanitizeForLogging(
          (obj as Record<string, unknown>)[key],
          depth + 1
        );
      }
    }
    return newObj;
  }

  return "[UNKNOWN_TYPE]";
}

/**
 * Log an API call for audit purposes
 */
export async function logApiCall(
  householdId: string,
  keyPrefix: string,
  endpoint: string,
  requestBody: Record<string, unknown>,
  responseStatus: number,
  ipAddress?: string
): Promise<void> {
  try {
    // Sanitize request body (remove sensitive data like images, truncate long strings)
    const sanitizedBody = sanitizeForLogging(requestBody);

    // Await the write: in serverless (Cloud Functions) the instance can be
    // frozen the moment the HTTP response is sent, so a non-awaited background
    // write may be suspended or dropped — losing the audit record. A logging
    // failure must still never fail the request, hence the try/catch.
    await db.collection("logs/api_calls/requests").add({
      householdId,
      keyPrefix,
      endpoint,
      requestBody: sanitizedBody,
      responseStatus,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ipAddress: ipAddress || null,
    });
  } catch (error) {
    logger.error("Failed to log API call:", error);
  }
}

/**
 * Validate that a string is a safe Firestore ID
 * Prevents path traversal characters like '/' and '..'
 */
export function isValidFirestoreId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  // Allow alphanumeric, underscore, hyphen
  // Standard Firestore IDs are base64-like alphanumeric
  return /^[a-zA-Z0-9_-]+$/.test(id);
}
