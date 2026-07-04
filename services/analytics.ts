/**
 * Firebase Analytics — lazy, fully defensive instrumentation.
 *
 * Analytics must NEVER break the app or block boot, so this module:
 *  - initializes only in the browser, in production, with a configured
 *    measurementId, and only when the environment reports `isSupported()`;
 *  - loads the `firebase/analytics` SDK via dynamic `import()` so it stays off
 *    the eager boot path and its init work happens after first paint;
 *  - swallows every error and turns `track()` into a no-op whenever analytics
 *    is unavailable (dev, tests, SSR, unsupported browsers, or init failure).
 *
 * Call `track(event, params?)` at meaningful product moments. It is safe to call
 * before init resolves (the event is simply dropped) and in any environment.
 */
import app from '@/firebase.config';
import type { Analytics } from 'firebase/analytics';

// Pure type (erased at build time) so the firebase/analytics SDK is referenced
// only through the dynamic import() below, never statically in the boot path.
type LogEventFn = typeof import('firebase/analytics')['logEvent'];

let analytics: Analytics | null = null;
let logEventFn: LogEventFn | null = null;
let initPromise: Promise<void> | null = null;
// Whether initialization has SETTLED (SDK ready, or permanently unavailable —
// dev, unsupported browser, init failure). Until then, events are queued below
// so boot-time calls (e.g. `notification_opened` fired from index.tsx before
// the dynamic import resolves) aren't silently dropped in production.
let initSettled = false;
const MAX_PENDING_EVENTS = 20;
const pendingEvents: Array<[string, Record<string, unknown> | undefined]> = [];

function flushPendingEvents(): void {
  if (analytics && logEventFn) {
    for (const [event, params] of pendingEvents) {
      try {
        logEventFn(analytics, event, params);
      } catch {
        // Swallow — analytics must never break product code.
      }
    }
  }
  pendingEvents.length = 0;
}

function initAnalytics(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async (): Promise<void> => {
    try {
      // Skip entirely outside a production browser session with a measurementId.
      if (
        typeof window === 'undefined' ||
        !import.meta.env.PROD ||
        !import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
      ) {
        return;
      }
      const mod = await import('firebase/analytics');
      if (await mod.isSupported()) {
        analytics = mod.getAnalytics(app);
        logEventFn = mod.logEvent;
      }
    } catch (e) {
      // Best-effort: analytics failures must never surface to the user.
      console.warn('Firebase Analytics unavailable:', e);
    } finally {
      initSettled = true;
      flushPendingEvents();
    }
  })();
  return initPromise;
}

// Begin initialization eagerly but non-blocking; the dynamic import keeps the
// SDK off the critical boot path.
void initAnalytics();

/**
 * Log a product analytics event. No-ops safely (and never throws) when
 * analytics isn't available — dev, tests, SSR, or unsupported browsers.
 * Events fired before async initialization settles are queued (bounded) and
 * flushed once the SDK is ready, so boot-time events aren't lost.
 */
export function track(event: string, params?: Record<string, unknown>): void {
  if (!analytics || !logEventFn) {
    if (!initSettled) {
      if (pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push([event, params]);
      // The first user interaction may beat the eager init; kick it off again.
      void initAnalytics();
    }
    return;
  }
  try {
    logEventFn(analytics, event, params);
  } catch {
    // Swallow — analytics must never break product code.
  }
}
