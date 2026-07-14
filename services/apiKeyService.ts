/**
 * API Key Service for iOS Shortcuts Integration
 *
 * Handles client-side generation and management of API keys
 * for the Quick Add Cloud Functions.
 */

import { db, getFunctionsInstance } from "@/firebase.config";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
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
 * Mint a fresh key + its storable metadata (does NOT persist).
 *
 * Shared by generateApiKey (new key) and regenerateApiKey (rotate in place) so
 * the key format, hashing, and default metadata stay identical across both.
 */
async function buildKeyMaterial(
  householdId: string,
  name: string,
  permissions: ApiKeyPermissions,
  createdBy: string
): Promise<{ key: string; keyData: Omit<HouseholdApiKey, "id"> }> {
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

  return { key, keyData };
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
  const { key, keyData } = await buildKeyMaterial(
    householdId,
    name,
    permissions,
    createdBy
  );

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
 * Rotate an existing API key's secret *in place*.
 *
 * Mints a brand-new secret that keeps the SAME name and permissions as the old
 * key, then atomically swaps it in via a single writeBatch (create new + delete
 * old) so a shortcut is never left pointing at a key that has already vanished.
 *
 * Because keys are stored only as a hash, the plain-text secret is
 * unrecoverable once created — regeneration is the safe, one-tap alternative to
 * the delete-then-recreate-and-reconfigure dance when a shortcut needs the key
 * value again. Like generateApiKey, the returned `key` is the ONLY time the
 * plain text is available.
 *
 * We create+delete rather than updating the doc in place because the Firestore
 * rules deliberately forbid mutating `hashedKey`/`keyPrefix` on an existing doc;
 * doing it this way preserves that immutability guarantee with no rules change.
 *
 * @param householdId - The household ID
 * @param keyId - The document ID of the key being rotated
 * @param name - Name to carry over to the new key
 * @param permissions - Permissions to carry over to the new key
 * @param createdBy - UID of the user performing the rotation
 */
export async function regenerateApiKey(
  householdId: string,
  keyId: string,
  name: string,
  permissions: ApiKeyPermissions,
  createdBy: string
): Promise<GenerateApiKeyResult> {
  const { key, keyData } = await buildKeyMaterial(
    householdId,
    name,
    permissions,
    createdBy
  );

  const keysCollection = collection(db, `households/${householdId}/apiKeys`);
  const newRef = doc(keysCollection);
  const oldRef = doc(db, `households/${householdId}/apiKeys/${keyId}`);

  const batch = writeBatch(db);
  batch.set(newRef, {
    ...keyData,
    createdAt: serverTimestamp(), // Use server timestamp for actual storage
  });
  batch.delete(oldRef);
  await batch.commit();

  return {
    key, // Return the plain-text key (only time it's available!)
    keyData: {
      ...keyData,
      id: newRef.id,
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
 * Whether the operator has enabled the "reveal & copy an existing key" flow.
 *
 * Mirrors the VITE_USE_GEMINI_PROXY convention: OFF by default, flipped ON in
 * the deploy workflow once the APIKEY_ENC_KEY secret is provisioned and the
 * reveal Cloud Functions are exported (docs/APIKEY_REVEAL_RUNBOOK.md). When OFF,
 * keys behave exactly as before — hash-only, shown once, no copy-again.
 */
export function isApiKeyRevealEnabled(): boolean {
  return import.meta.env.VITE_APIKEY_REVEAL_ENABLED === "true";
}

/**
 * Attach an at-rest-encrypted copy of a freshly created/regenerated key so it
 * can be revealed later. Best-effort: the caller should tolerate failure (the
 * key still works, it just won't be copyable). Sends the plaintext to the
 * `attachapikeyencryption` callable, which stores the ciphertext only if its
 * hash matches the key doc.
 */
export async function attachApiKeyEncryption(
  householdId: string,
  keyId: string,
  key: string
): Promise<void> {
  const [{ httpsCallable }, functions] = await Promise.all([
    import("firebase/functions"),
    getFunctionsInstance(),
  ]);
  const fn = httpsCallable<
    { householdId: string; keyId: string; key: string },
    { success: boolean }
  >(functions, "attachapikeyencryption");
  await fn({ householdId, keyId, key });
}

/**
 * Fetch the plaintext of a previously-encrypted key (admin-only, server-side
 * decryption via the `revealapikey` callable) so the user can copy it again.
 */
export async function revealApiKey(
  householdId: string,
  keyId: string
): Promise<string> {
  const [{ httpsCallable }, functions] = await Promise.all([
    import("firebase/functions"),
    getFunctionsInstance(),
  ]);
  const fn = httpsCallable<
    { householdId: string; keyId: string },
    { key: string }
  >(functions, "revealapikey");
  const result = await fn({ householdId, keyId });
  return result.data.key;
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
  endpoint: "habit" | "expense" | "shopping" | "naturalLanguage" | "bill"
): string {
  const baseUrl = getQuickAddBaseUrl();
  const endpointMap = {
    habit: "quickAddHabit",
    expense: "quickAddExpense",
    shopping: "quickAddShoppingItem",
    naturalLanguage: "quickAddNaturalLanguage",
    bill: "quickAddBillPay",
  };
  return `${baseUrl}/${endpointMap[endpoint]}`;
}
