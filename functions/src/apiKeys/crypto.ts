/**
 * Authenticated symmetric encryption for iOS-Shortcut API keys.
 *
 * API keys are stored primarily as a one-way SHA-256 hash (used for request
 * validation — see quickAdd/apiKeyValidation.ts), which is why a key can never
 * be re-displayed once created. To support an operator-enabled "copy the key
 * again later" flow, we ADDITIONALLY store the key encrypted at rest with
 * AES-256-GCM under a server-only secret (APIKEY_ENC_KEY). The plaintext is
 * decryptable only inside a Cloud Function that holds the secret — it never
 * reaches Firestore in the clear and never reaches the client except as the
 * response of an admin-authenticated `revealapikey` call.
 *
 * GCM gives us confidentiality AND integrity: a tampered ciphertext (e.g. a
 * client that wrote garbage into the `encryptedKey` field) fails the auth-tag
 * check on decrypt and throws, rather than yielding a wrong-but-plausible key.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the standard/recommended size for GCM
const VERSION = "v1";

/**
 * Derive a stable 32-byte AES key from the configured secret.
 *
 * If the operator sets APIKEY_ENC_KEY to exactly 64 hex characters it is used
 * as the raw 32-byte key; any other value is SHA-256'd to 32 bytes so that any
 * sufficiently random secret string works without the operator having to
 * produce an exact-length key.
 */
export function deriveKey(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt `plaintext`, returning a self-describing, versioned payload string:
 *   "v1:<ivBase64>:<ciphertextBase64>:<authTagBase64>"
 * Each call uses a fresh random IV, so encrypting the same key twice yields
 * different payloads.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":");
}

/**
 * Decrypt a payload produced by {@link encryptSecret}. Throws if the payload is
 * malformed, the version is unknown, or the auth tag fails (tampered ciphertext
 * or wrong key).
 */
export function decryptSecret(payload: string, secret: string): string {
  const [version, ivB64, ciphertextB64, authTagB64] = payload.split(":");
  if (version !== VERSION || !ivB64 || !ciphertextB64 || !authTagB64) {
    throw new Error("Malformed ciphertext payload");
  }
  const key = deriveKey(secret);
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
