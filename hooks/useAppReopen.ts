import { useEffect, useRef } from 'react';

/**
 * Minimum time the app must stay hidden for a return-to-foreground to count as
 * a new "app open". Short task-switches (glancing at a text, screen briefly
 * locking) stay within the same "open"; coming back after this long re-arms
 * once-per-open surfaces like the pending-review drawer.
 */
export const APP_REOPEN_MIN_HIDDEN_MS = 5 * 60 * 1000;

/**
 * Invokes `onReopen` when the document transitions hidden → visible after
 * being hidden for at least `minHiddenMs`.
 *
 * Why this exists: on an installed iOS/Android PWA, "opening the app" almost
 * never remounts React — the page lives in the background for days and is
 * simply re-foregrounded. Anything keyed to "once per app open" via mount-time
 * state (e.g. MainLayout's pending-review auto-open latch) would otherwise
 * fire only on a genuine page load, so a spouse's phone never re-surfaces
 * pending transactions that synced in while the app was backgrounded.
 *
 * `visibilitychange` also fires on bfcache restores, so back-forward
 * navigation resumes are covered too.
 */
export function useAppReopen(
  onReopen: () => void,
  minHiddenMs: number = APP_REOPEN_MIN_HIDDEN_MS,
): void {
  // Latest-callback ref so consumers can pass inline closures without
  // re-subscribing the document listener every render.
  const onReopenRef = useRef(onReopen);
  useEffect(() => {
    onReopenRef.current = onReopen;
  }, [onReopen]);

  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // Don't overwrite an earlier hidden timestamp: some platforms emit
        // repeated 'hidden' events without an intervening 'visible'.
        hiddenAtRef.current ??= Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt !== null && Date.now() - hiddenAt >= minHiddenMs) {
        onReopenRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [minHiddenMs]);
}
