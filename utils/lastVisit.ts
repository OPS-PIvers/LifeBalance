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
