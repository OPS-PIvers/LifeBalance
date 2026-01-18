import * as admin from "firebase-admin";
import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";

const db = admin.firestore();

export interface ApiKeyPermissions {
  habits: boolean;
  expenses: boolean;
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
  error?: string;
}

// Rate limit configurations
const RATE_LIMITS = {
  habit: { limit: 100, windowMs: 60 * 60 * 1000 }, // 100/hour
  expense: { limit: 50, windowMs: 60 * 60 * 1000 }, // 50/hour
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

  // 3. Query all households for matching key using collectionGroup
  try {
    const keysSnapshot = await db
      .collectionGroup("apiKeys")
      .where("hashedKey", "==", hashedKey)
      .where("status", "==", "active")
      .limit(1)
      .get();

    if (keysSnapshot.empty) {
      logger.warn("API key not found or revoked");
      return { valid: false, error: "Invalid or revoked API key" };
    }

    const keyDoc = keysSnapshot.docs[0];
    const keyData = keyDoc.data() as HouseholdApiKey;
    const householdId = keyDoc.ref.parent.parent?.id;

    if (!householdId) {
      logger.error("Could not determine household ID from key document");
      return { valid: false, error: "Internal error" };
    }

    // 4. Update usage tracking (fire-and-forget)
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
  endpointType: "habit" | "expense" | "receipt"
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
    // Sanitize request body (remove sensitive data like images)
    const sanitizedBody = { ...requestBody };
    if (sanitizedBody.image) {
      sanitizedBody.image = "[BASE64_IMAGE_REDACTED]";
    }

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
