import { useEffect, useRef } from 'react';

/** The minimal member shape this hook needs — kept narrow so callers/tests
 * don't have to construct a full `HouseholdMember`. */
export interface TimezoneAutoHealMember {
  uid: string;
  notificationPreferences?: {
    timezone?: string;
  };
}

interface UseTimezoneAutoHealParams {
  householdId: string | null | undefined;
  /** The real signed-in member (NOT the Kid-Mode `actAs` target) — see
   * FirebaseHouseholdContext's `currentUser`, which is keyed off the Firebase
   * Auth uid and unaffected by `activeMemberId`. */
  currentUser: TimezoneAutoHealMember | null | undefined;
  /** Persists the healed zone via a `notificationPreferences.timezone` dot-path
   * write. Must never throw — this hook doesn't handle rejections beyond
   * logging, matching every other write* callback in FirebaseHouseholdContext. */
  healTimezone: (memberUid: string, timezone: string) => void | Promise<void>;
  /** Injectable for tests; defaults to the browser's resolved IANA zone. */
  detectTimezone?: () => string;
}

/**
 * TZ-1: auto-heals a signed-in member's `notificationPreferences.timezone`
 * once per session when it's missing/empty or stale against the browser's
 * currently-detected IANA zone.
 *
 * Every scheduled Cloud Function (habit reminders, streak warnings, bill
 * reminders, the weekly recap, the daily briefing) decides a member's local
 * "today" from this field and falls back to `'UTC'` when it's absent (see
 * `functions/src/shared/notifications.ts`'s `isTimeToSend` and
 * `functions/src/recap/index.ts`) — for a US-Central member that silently
 * shifts every "7am local" job to 2am local. Before this hook the field was
 * only ever captured as a side effect of hitting Save on Settings →
 * Notifications, so a member who never opened that screen (confirmed in
 * production) had no timezone at all.
 *
 * Mirrors the once-per-household-load pattern in `hooks/usePointsSync.ts`: a
 * ref keyed on `householdId:uid` guards the effect so it fires at most once
 * per (household, member) pair for the life of this mount, and re-fires for a
 * different household/member (e.g. household switch) without needing a reset.
 */
export const useTimezoneAutoHeal = ({
  householdId,
  currentUser,
  healTimezone,
  detectTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
}: UseTimezoneAutoHealParams): void => {
  const healedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!householdId || !currentUser?.uid) return;

    const sessionKey = `${householdId}:${currentUser.uid}`;
    if (healedForRef.current === sessionKey) return;

    const detected = detectTimezone();
    // A detection failure (e.g. an unsupported environment) must never write
    // an empty/garbage value over a real stored zone.
    if (!detected) return;

    // Mark as handled for this (household, member) pair before writing, so a
    // rejected write (or a StrictMode double-invoke) can't loop retries —
    // matching writeSyncedPoints' "log and move on" resilience below.
    healedForRef.current = sessionKey;

    const stored = currentUser.notificationPreferences?.timezone;
    if (stored === detected) return; // already correct — nothing to heal

    // An async IIFE (rather than `Promise.resolve(healTimezone(...)).catch()`)
    // so a SYNCHRONOUS throw from `healTimezone` is caught too, not just a
    // rejected promise — this hook must never be able to block app boot.
    void (async () => {
      try {
        await healTimezone(currentUser.uid, detected);
      } catch (error) {
        console.error('[useTimezoneAutoHeal] Failed to heal member timezone:', error);
      }
    })();
  }, [householdId, currentUser?.uid, currentUser?.notificationPreferences?.timezone, healTimezone, detectTimezone]);
};
