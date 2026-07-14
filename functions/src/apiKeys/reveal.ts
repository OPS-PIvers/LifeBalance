/**
 * Callable Cloud Functions for the operator-enabled "reveal & copy an existing
 * API key" flow (see docs/APIKEY_REVEAL_RUNBOOK.md).
 *
 * API keys are stored primarily as a one-way SHA-256 hash, so by default a key
 * cannot be re-displayed after creation. When the operator opts in — provisions
 * the APIKEY_ENC_KEY secret, exports these functions, and sets
 * VITE_APIKEY_REVEAL_ENABLED=true — newly created/regenerated keys are also
 * stored encrypted at rest (`attachapikeyencryption`), and a household admin can
 * later fetch the plaintext to copy it again (`revealapikey`).
 *
 * Both functions are admin-gated: only a member whose role is "admin" in the
 * named household may attach or reveal, mirroring the Firestore rules that make
 * the apiKeys subcollection admin-only.
 *
 * These are deliberately NOT exported from index.ts yet — exporting binds the
 * APIKEY_ENC_KEY secret, which a non-interactive `firebase deploy` requires to
 * already exist in Secret Manager. Activation is a human step; see the runbook.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { createHash } from "crypto";
import { encryptSecret, decryptSecret } from "./crypto";

/**
 * Server-only symmetric key used to encrypt/decrypt stored API keys. A human
 * sets it (e.g. `firebase functions:secrets:set APIKEY_ENC_KEY`) when the
 * reveal flow is activated; until then these functions are dormant.
 */
const apiKeyEncKey = defineSecret("APIKEY_ENC_KEY");

/** SHA-256 hex — must match apiKeyValidation.hashApiKey and the client. */
function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Validate + narrow the householdId/keyId args. The slash checks keep a crafted
 * id from escaping its collection path (it would otherwise throw an opaque
 * Firestore path error).
 */
function requireIds(
  householdId: unknown,
  keyId: unknown
): { householdId: string; keyId: string } {
  if (
    typeof householdId !== "string" ||
    !householdId ||
    householdId.includes("/")
  ) {
    throw new HttpsError(
      "invalid-argument",
      "A valid 'householdId' is required."
    );
  }
  if (typeof keyId !== "string" || !keyId || keyId.includes("/")) {
    throw new HttpsError("invalid-argument", "A valid 'keyId' is required.");
  }
  return { householdId, keyId };
}

/**
 * Throw permission-denied unless `uid` is an admin member of `householdId`.
 * Matches the server-side admin check used by deletehousehold and the
 * admin-only apiKeys Firestore rules.
 */
async function assertHouseholdAdmin(
  uid: string,
  householdId: string
): Promise<void> {
  const db = admin.firestore();
  const memberSnap = await db
    .doc(`households/${householdId}/members/${uid}`)
    .get();
  if (!memberSnap.exists || memberSnap.data()?.role !== "admin") {
    throw new HttpsError(
      "permission-denied",
      "Only a household admin can manage API keys."
    );
  }
}

/**
 * Attach an at-rest-encrypted copy of an already-created key to its Firestore
 * doc, so it can be revealed later. The caller supplies the plaintext it just
 * generated; we only store the ciphertext if its hash matches the doc's
 * `hashedKey`, so a caller can never stash a bogus or foreign ciphertext.
 */
export const attachapikeyencryption = onCall(
  { secrets: [apiKeyEncKey], cors: true },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const data = (request.data ?? {}) as Record<string, unknown>;
    const { householdId, keyId } = requireIds(data.householdId, data.keyId);
    const key = data.key;
    if (typeof key !== "string" || !key) {
      throw new HttpsError("invalid-argument", "A 'key' string is required.");
    }

    await assertHouseholdAdmin(request.auth.uid, householdId);

    const db = admin.firestore();
    const keyRef = db.doc(`households/${householdId}/apiKeys/${keyId}`);
    const snap = await keyRef.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "API key not found.");
    }
    // The supplied plaintext must be the one this doc actually represents.
    if (snap.data()?.hashedKey !== hashApiKey(key)) {
      throw new HttpsError(
        "permission-denied",
        "The provided key does not match this API key."
      );
    }

    const encryptedKey = encryptSecret(key, apiKeyEncKey.value());
    await keyRef.update({ encryptedKey });

    logger.info(
      `Attached reveal encryption for key ${keyId} in household ${householdId}`
    );
    return { success: true };
  }
);

/**
 * Return the plaintext of a previously-encrypted key to an admin so they can
 * copy it again. Fails with failed-precondition for legacy/hash-only keys that
 * were created before the reveal flow was enabled.
 */
export const revealapikey = onCall(
  { secrets: [apiKeyEncKey], cors: true },
  async (request): Promise<{ key: string }> => {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "The function must be called while authenticated."
      );
    }

    const data = (request.data ?? {}) as Record<string, unknown>;
    const { householdId, keyId } = requireIds(data.householdId, data.keyId);

    await assertHouseholdAdmin(request.auth.uid, householdId);

    const db = admin.firestore();
    const snap = await db
      .doc(`households/${householdId}/apiKeys/${keyId}`)
      .get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "API key not found.");
    }

    const encryptedKey = snap.data()?.encryptedKey;
    if (typeof encryptedKey !== "string" || !encryptedKey) {
      throw new HttpsError(
        "failed-precondition",
        "This key was created before copy-on-demand was enabled. Regenerate it to enable copying."
      );
    }

    try {
      const key = decryptSecret(encryptedKey, apiKeyEncKey.value());
      logger.info(
        `Revealed key ${keyId} in household ${householdId} to admin ${request.auth.uid}`
      );
      return { key };
    } catch (error) {
      logger.error("revealapikey: decryption failed", error);
      throw new HttpsError("internal", "Could not decrypt the API key.");
    }
  }
);
