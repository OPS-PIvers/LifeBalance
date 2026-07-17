/**
 * Per-device "last visit" timestamp for the partner-activity Dashboard surface
 * (the "since you were here" moment).
 *
 * This is deliberately a per-DEVICE localStorage value, not a synced field: the
 * question it answers is "what happened since I last looked at this on THIS
 * phone", which is inherently device-local. Best-effort throughout — a private
 * browsing / storage-blocked context simply degrades to "no recorded visit"
 * (the selector then shows nothing, which is the correct empty behavior).
 */

export const LAST_VISIT_STORAGE_KEY = 'LIFEBALANCE_LAST_VISIT';

/** Read the previously stored visit timestamp (ISO), or null if none/unreadable. */
export function readLastVisit(): string | null {
  try {
    return window.localStorage.getItem(LAST_VISIT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist `nowISO` as the latest visit timestamp. Best-effort. */
export function writeLastVisit(nowISO: string): void {
  try {
    window.localStorage.setItem(LAST_VISIT_STORAGE_KEY, nowISO);
  } catch {
    // Storage unavailable — the card just won't have a baseline next open.
  }
}

/**
 * The frozen "previous visit" baseline for this app SESSION (module lifetime).
 *
 * The first call reads the stored marker, advances it to `nowISO`, and caches
 * the prior value; every later call (a remount of the widget, StrictMode's
 * double mount, navigating away and back) returns the same cached baseline
 * without touching storage again. Without this cache, a remount's read would
 * see the timestamp the previous mount just wrote ("just now") and the digest
 * would always be empty after the first mount.
 */
let sessionBaseline: string | null | undefined;

export function getSessionBaseline(nowISO: string): string | null {
  if (sessionBaseline === undefined) {
    sessionBaseline = readLastVisit();
    writeLastVisit(nowISO);
  }
  return sessionBaseline;
}

/** Test-only: forget the cached session baseline so each test starts fresh. */
export function resetSessionBaselineForTests(): void {
  sessionBaseline = undefined;
}
