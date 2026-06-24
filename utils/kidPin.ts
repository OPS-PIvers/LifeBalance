/**
 * Kid Mode exit-PIN hashing (Plan 080b).
 *
 * The PIN is a 4–6 digit code a PARENT enters to leave a kid's scoped view — the
 * Netflix-Kids "are you a grown-up?" gate. It is a child-deterrent, NOT a
 * high-value secret, but we still never store the raw PIN: it is salted and
 * hashed with SHA-256 via Web Crypto, and only the resulting string
 * (`Household.kidModePinHash`) is persisted.
 *
 * Stored format: `v1:<saltHex>:<digestHex>` (versioned so the scheme can evolve
 * without a migration — `verifyKidPin` rejects any other shape).
 */

const PIN_MIN_DIGITS = 4;
const PIN_MAX_DIGITS = 6;
const SALT_BYTES = 16;
const SCHEME_VERSION = 'v1';

/** A well-formed PIN is 4–6 digits (no spaces or other characters). */
export function isValidPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`).test(pin);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function digestHex(saltHex: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${saltHex}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

/**
 * Hash a PIN with a fresh random salt. Throws on a malformed PIN so callers
 * validate (and surface a friendly message) before ever persisting.
 */
export async function hashKidPin(pin: string): Promise<string> {
  if (!isValidPinFormat(pin)) {
    throw new Error(`Invalid PIN: must be ${PIN_MIN_DIGITS}-${PIN_MAX_DIGITS} digits`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const saltHex = toHex(salt);
  const digest = await digestHex(saltHex, pin);
  return `${SCHEME_VERSION}:${saltHex}:${digest}`;
}

/**
 * Verify a PIN against a stored hash. Returns `false` (never throws) for any
 * malformed input, unknown scheme, or mismatch, so a corrupt stored value can't
 * crash the exit flow — it just means the PIN won't verify.
 */
export async function verifyKidPin(
  pin: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored || !isValidPinFormat(pin)) return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== SCHEME_VERSION) return false;
  const saltHex = parts[1];
  const expectedHex = parts[2];
  if (!saltHex || !expectedHex) return false;
  const actualHex = await digestHex(saltHex, pin);
  return timingSafeEqualHex(actualHex, expectedHex);
}

/** Length-constant hex comparison (both are fixed-length SHA-256 digests). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
