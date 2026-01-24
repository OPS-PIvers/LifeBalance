import * as admin from "firebase-admin";
import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";

const db = admin.firestore();

export interface ApiKeyPermissions {
  habits: boolean;
  expenses: boolean;
  shoppingList: boolean;
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
  receipt: { limit: 20, windowMs: 24 * 60 * 60 * 1000 }, // 20/day
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
 * Extract household prefix from API key
 * Format: lb_{householdPrefix}_{randomPart}
 */
function extractHouseholdPrefix(key: string): string | null {
  const parts = key.split("_");
  if (parts.length !== 3 || parts[0] !== "lb") {
    return null;
  }
  return parts[1]; // The 6-character household prefix
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

  // 2. Extract household prefix from key
  const householdPrefix = extractHouseholdPrefix(providedKey);
  if (!householdPrefix) {
    logger.warn("Could not extract household prefix from key");
    return { valid: false, error: "Invalid API key format" };
  }

  // 3. Hash the provided key
  const hashedKey = hashApiKey(providedKey);

  // 4. Query households that match the prefix
  // Since we don't have the full household ID, we need to search
  // We'll use a range query to find households starting with this prefix
  try {
    const householdsSnapshot = await db
      .collection("households")
      .where(admin.firestore.FieldPath.documentId(), ">=", householdPrefix)
      .where(
        admin.firestore.FieldPath.documentId(),
        "<=",
        householdPrefix + "\uf8ff"
      )
      .limit(10) // Shouldn't be more than a few households with same prefix
      .get();

    if (householdsSnapshot.empty) {
      logger.warn("No households found matching prefix");
      return { valid: false, error: "Invalid or revoked API key" };
    }

    // 5. Check each household's apiKeys subcollection for matching hashed key
    for (const householdDoc of householdsSnapshot.docs) {
      const apiKeysSnapshot = await db
        .collection(`households/${householdDoc.id}/apiKeys`)
        .where("hashedKey", "==", hashedKey)
        .where("status", "==", "active")
        .limit(1)
        .get();

      if (!apiKeysSnapshot.empty) {
        const keyDoc = apiKeysSnapshot.docs[0];
        const keyData = keyDoc.data() as HouseholdApiKey;

        // Update usage tracking (fire-and-forget)
        keyDoc.ref
          .update({
            lastUsedAt: new Date().toISOString(),
            usageCount: admin.firestore.FieldValue.increment(1),
          })
          .catch((err) => logger.error("Failed to update key usage:", err));

        logger.info(`API key validated for household: ${householdDoc.id}`);
        return {
          valid: true,
          householdId: householdDoc.id,
          permissions: keyData.permissions,
          keyId: keyDoc.id,
          keyCreatedBy: keyData.createdBy,
        };
      }
    }

    logger.warn("API key not found or revoked");
    return { valid: false, error: "Invalid or revoked API key" };
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
  endpointType: "habit" | "expense" | "shopping" | "receipt"
): Promise<{ allowed: boolean; retryAfterMs?: number }> {
  const config = RATE_LIMITS[endpointType];
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const usageRef = db.doc(`households/${householdId}/apiUsage/${endpointType}`);

  try {
    const usageDoc = await usageRef.get();
    const data = usageDoc.data();

    if (!data) {
      // First request, create tracking doc
      await usageRef.set({
        count: 1,
        windowStart: now,
        lastRequest: now,
      });
      return { allowed: true };
    }

    // Check if we need to reset the window
    if (data.windowStart < windowStart) {
      // Window expired, reset
      await usageRef.set({
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
    await usageRef.update({
      count: admin.firestore.FieldValue.increment(1),
      lastRequest: now,
    });

    return { allowed: true };
  } catch (error) {
    logger.error("Error checking rate limit:", error);
    // Fail open to not block legitimate requests on errors
    return { allowed: true };
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
    // Don't fail the request if logging fails
    logger.error("Failed to log API call:", error);
  }
}
