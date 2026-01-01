import { useEffect, useRef, useCallback } from 'react';
import { startOfDay, addDays, differenceInMilliseconds } from 'date-fns';

/**
 * A hook that schedules a callback to run at midnight and periodically.
 * Handles self-rescheduling after each midnight and is DST-safe.
 *
 * @param callback - The async function to run at midnight and periodically
 * @param enabled - Whether the scheduler should be active
 * @param intervalMs - How often to run the callback (default: 60000ms = 1 minute)
 */
export const useMidnightScheduler = (
  callback: () => Promise<void>,
  enabled: boolean,
  intervalMs: number = 60 * 1000
): void => {
  const callbackRef = useRef(callback);
  const isMountedRef = useRef(true);

  // Keep callback ref up to date without triggering re-subscriptions
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const safeCallback = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      await callbackRef.current();
    } catch (error) {
      console.error('[useMidnightScheduler] Callback error:', error);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    isMountedRef.current = true;

    // Run immediately on mount
    safeCallback();

    // Set up periodic interval
    const intervalId = setInterval(safeCallback, intervalMs);

    // Self-rescheduling midnight timeout
    let midnightTimeoutId: ReturnType<typeof setTimeout>;

    const scheduleMidnightCheck = () => {
      if (!isMountedRef.current) return;

      const now = new Date();
      // Use addDays for DST safety instead of manual 24h calculation
      const tomorrow = startOfDay(addDays(now, 1));
      const msUntilMidnight = differenceInMilliseconds(tomorrow, now);

      midnightTimeoutId = setTimeout(() => {
        if (!isMountedRef.current) return;
        safeCallback();
        // Reschedule for the next midnight
        scheduleMidnightCheck();
      }, msUntilMidnight);
    };

    // Schedule the first midnight check
    scheduleMidnightCheck();

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
      clearTimeout(midnightTimeoutId);
    };
  }, [enabled, intervalMs, safeCallback]);
};
