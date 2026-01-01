import { useEffect, useRef, useCallback } from 'react';
import { startOfDay, addDays, differenceInMilliseconds } from 'date-fns';

/**
 * A hook that schedules a callback to run at midnight and periodically.
 * Handles self-rescheduling after each midnight and is DST-safe.
 *
 * @param callback - The async function to run at midnight and periodically
 * @param enabled - Whether the scheduler should be active
 * @param options - Configuration options
 * @param options.intervalMs - How often to run the callback (default: 300000ms = 5 minutes)
 * @param options.initialDelayMs - Delay before first execution to prevent race conditions (default: 0)
 */
export const useMidnightScheduler = (
  callback: () => Promise<void>,
  enabled: boolean,
  options: { intervalMs?: number; initialDelayMs?: number } = {}
): void => {
  const { intervalMs = 5 * 60 * 1000, initialDelayMs = 0 } = options;
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
    let intervalId: ReturnType<typeof setInterval>;
    let midnightTimeoutId: ReturnType<typeof setTimeout>;
    let initialDelayTimeoutId: ReturnType<typeof setTimeout>;

    const startScheduler = () => {
      if (!isMountedRef.current) return;

      // Run callback immediately after initial delay
      safeCallback();

      // Set up periodic interval (5 min default - midnight timeout handles precision)
      intervalId = setInterval(safeCallback, intervalMs);

      // Self-rescheduling midnight timeout
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
    };

    // Apply initial delay to stagger initialization and prevent race conditions
    if (initialDelayMs > 0) {
      initialDelayTimeoutId = setTimeout(startScheduler, initialDelayMs);
    } else {
      startScheduler();
    }

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialDelayTimeoutId);
      clearInterval(intervalId);
      clearTimeout(midnightTimeoutId);
    };
  }, [enabled, intervalMs, initialDelayMs, safeCallback]);
};
