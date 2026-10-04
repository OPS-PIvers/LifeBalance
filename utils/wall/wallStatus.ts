/**
 * Small pure rules for the wall runtime (docs/plans/wall-display-kiosk.md §4.8).
 */

export const OFFLINE_STRIP_AFTER_MS = 15 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
/** A heartbeat write still pending after this long means we're offline. */
export const HEARTBEAT_PENDING_OFFLINE_MS = 60 * 1000;
export const NIGHT_WAKE_MS = 60 * 1000;

export type OfflineLevel = 'online' | 'mark' | 'strip';

/** Under 15 min offline: the rail mark. 15 min or more: the strip. */
export function offlineLevel(offlineSince: number | null, now: number): OfflineLevel {
  if (offlineSince === null) return 'online';
  return now - offlineSince >= OFFLINE_STRIP_AFTER_MS ? 'strip' : 'mark';
}

/**
 * The nightly maintenance reload runs once per local date, any time from
 * 03:00 to 03:59 (a skipped attempt, e.g. writes still pending, simply tries
 * again on a later minute in that hour).
 */
export function isMaintenanceDue(hour: number, today: string, lastRunDate: string | null): boolean {
  return hour === 3 && lastRunDate !== today;
}
