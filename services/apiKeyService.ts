/**
 * API Key Service for iOS Shortcuts Integration
 *
 * Handles client-side generation and management of API keys
 * for the Quick Add Cloud Functions.
 */

import { db } from "@/firebase.config";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { HouseholdApiKey, ApiKeyPermissions } from "@/types/schema";

/**
 * Generate a cryptographically secure random hex string
 */
function generateRandomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hash a string using SHA-256
 */
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GenerateApiKeyResult {
  key: string; // The actual key (only shown once!)
  keyData: Omit<HouseholdApiKey, "id">;
}

/**
 * Generate a new API key for a household
 *
 * IMPORTANT: The returned `key` is the only time the plain-text key will be available.
 * It must be shown to the user immediately and cannot be retrieved later.
 *
 * @param householdId - The household ID
 * @param name - User-provided name for the key (e.g., "iPhone Shortcut")
 * @param permissions - Which endpoints the key can access
 * @param createdBy - UID of the user creating the key
 */
export async function generateApiKey(
  householdId: string,
  name: string,
  permissions: ApiKeyPermissions,
  createdBy: string
): Promise<GenerateApiKeyResult> {
  // Generate the key in format: lb_{householdPrefix}_{32hexChars}
  const householdPrefix = householdId.substring(0, 6);
  const randomPart = generateRandomHex(16); // 32 hex chars
  const key = `lb_${householdPrefix}_${randomPart}`;

  // Hash the key for storage
  const hashedKey = await sha256(key);

  // Create the key prefix for display (first 16 chars)
  const keyPrefix = key.substring(0, 16);

  const keyData: Omit<HouseholdApiKey, "id"> = {
    hashedKey,
    keyPrefix,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    createdBy,
    usageCount: 0,
    status: "active",
    permissions,
  };

  // Store in Firestore
  const keysCollection = collection(db, `households/${householdId}/apiKeys`);
  const docRef = await addDoc(keysCollection, {
    ...keyData,
    createdAt: serverTimestamp(), // Use server timestamp for actual storage
  });

  return {
    key, // Return the plain-text key (only time it's available!)
    keyData: {
      ...keyData,
      id: docRef.id,
    } as HouseholdApiKey,
  };
}

/**
 * Revoke an API key (sets status to 'revoked')
 *
 * @param householdId - The household ID
 * @param keyId - The API key document ID
 */
export async function revokeApiKey(
  householdId: string,
  keyId: string
): Promise<void> {
  const keyRef = doc(db, `households/${householdId}/apiKeys/${keyId}`);
  await updateDoc(keyRef, {
    status: "revoked",
  });
}

/**
 * Update API key permissions
 *
 * @param householdId - The household ID
 * @param keyId - The API key document ID
 * @param permissions - New permissions
 */
export async function updateApiKeyPermissions(
  householdId: string,
  keyId: string,
  permissions: ApiKeyPermissions
): Promise<void> {
  const keyRef = doc(db, `households/${householdId}/apiKeys/${keyId}`);
  await updateDoc(keyRef, {
    permissions,
  });
}

/**
 * Update API key name
 *
 * @param householdId - The household ID
 * @param keyId - The API key document ID
 * @param name - New name
 */
export async function updateApiKeyName(
  householdId: string,
  keyId: string,
  name: string
): Promise<void> {
  const keyRef = doc(db, `households/${householdId}/apiKeys/${keyId}`);
  await updateDoc(keyRef, {
    name: name.trim(),
  });
}

/**
 * Delete an API key permanently
 *
 * @param householdId - The household ID
 * @param keyId - The API key document ID
 */
export async function deleteApiKey(
  householdId: string,
  keyId: string
): Promise<void> {
  const keyRef = doc(db, `households/${householdId}/apiKeys/${keyId}`);
  await deleteDoc(keyRef);
}

/**
 * Get the Cloud Functions base URL for the current Firebase project
 */
export function getQuickAddBaseUrl(): string {
  // Firebase project ID from environment
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID || "lifebalance-26080";
  return `https://us-central1-${projectId}.cloudfunctions.net`;
}

/**
 * Get the full URL for a Quick Add endpoint
 */
export function getQuickAddEndpointUrl(
  endpoint: "habit" | "expense" | "shopping" | "receipt"
): string {
  const baseUrl = getQuickAddBaseUrl();
  const endpointMap = {
    habit: "quickAddHabit",
    expense: "quickAddExpense",
    shopping: "quickAddShoppingItem",
    receipt: "quickAddReceipt",
  };
  return `${baseUrl}/${endpointMap[endpoint]}`;
}
