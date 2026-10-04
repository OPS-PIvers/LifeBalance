/**
 * The "this device is a wall display" flag (docs/plans/wall-display-kiosk.md
 * §4.2). Set when someone starts pairing from the login screen, cleared on
 * unpair. While set, a signed-out launch goes to the pairing screen instead
 * of Google sign-in, and the service-worker update prompt stays silent.
 * The same key is read by the inline script in index.html — keep in sync.
 */
export const WALL_DEVICE_KEY = 'LB_WALL_DEVICE';

export function isWallDevice(): boolean {
  try {
    return localStorage.getItem(WALL_DEVICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setWallDevice(on: boolean): void {
  try {
    if (on) localStorage.setItem(WALL_DEVICE_KEY, '1');
    else localStorage.removeItem(WALL_DEVICE_KEY);
  } catch {
    // Storage blocked: pairing still works, the flag just won't persist.
  }
}

/** Display uids are `display_{did}` (functions/src/wall/pairingLogic.ts). */
export const DISPLAY_UID_PREFIX = 'display_';

export interface DisplayClaims {
  hid: string;
  did: string;
}

/** Reads the display claims off an ID token's claims, or null for a normal user. */
export function parseDisplayClaims(claims: Record<string, unknown>): DisplayClaims | null {
  if (claims['display'] !== true) return null;
  const hid = claims['hid'];
  const did = claims['did'];
  if (typeof hid !== 'string' || !hid || typeof did !== 'string' || !did) return null;
  return { hid, did };
}
