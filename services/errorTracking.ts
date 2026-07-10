/**
 * Sentry error tracking — lazy, fully defensive instrumentation.
 *
 * Error tracking must NEVER break the app or block boot, so this module:
 *  - initializes only in a production browser with a configured DSN
 *    (`VITE_SENTRY_DSN`);
 *  - loads the `@sentry/react` SDK via dynamic `import()` so it stays off the
 *    eager boot path and its init work happens after first paint;
 *  - never sends default PII, and scrubs request/breadcrumb bodies in
 *    `beforeSend` — this app handles household finances, so no amounts,
 *    merchants, or other financial data may ever leave the device;
 *  - captures error events only (no performance/replay integrations) to keep
 *    the bundle and event quota minimal;
 *  - swallows every error and turns `captureException()` into a no-op
 *    whenever tracking is unavailable (dev, tests, SSR, missing DSN, or init
 *    failure).
 *
 * Call `initErrorTracking()` once at boot and `captureException(error, context?)`
 * from the global handlers / ErrorBoundary. Both are safe to call in any
 * environment and never throw.
 */

// Pure type (erased at build time) so the @sentry/react SDK is referenced only
// through the dynamic import() below, never statically in the boot path.
type SentryModule = typeof import('@sentry/react');

let sentry: SentryModule | null = null;
let initPromise: Promise<void> | null = null;
// Whether initialization has SETTLED (SDK ready, or permanently unavailable —
// dev, missing DSN, init failure). Until then, errors are queued below so
// boot-time failures (e.g. a synchronous crash before the dynamic import
// resolves) aren't silently dropped in production.
let initSettled = false;
const MAX_PENDING_ERRORS = 10;
const pendingErrors: Array<[unknown, Record<string, string> | undefined]> = [];

// Strips anything that could carry financial data (request bodies, breadcrumb
// data payloads) before an event ever leaves the device.
function scrubEvent(
  event: import('@sentry/react').ErrorEvent,
): import('@sentry/react').ErrorEvent {
  delete event.request;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      const { data: _data, ...rest } = breadcrumb;
      return rest;
    });
  }
  return event;
}

function flushPendingErrors(): void {
  if (sentry) {
    for (const [error, context] of pendingErrors) {
      try {
        sentry.captureException(error, context ? { extra: context } : undefined);
      } catch {
        // Swallow — error tracking must never break product code.
      }
    }
  }
  pendingErrors.length = 0;
}

function initErrorTrackingInternal(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async (): Promise<void> => {
    try {
      const dsn = import.meta.env.VITE_SENTRY_DSN;
      // Skip entirely outside a production browser session with a DSN.
      if (typeof window === 'undefined' || !import.meta.env.PROD || !dsn) {
        return;
      }
      const mod = await import('@sentry/react');
      mod.init({
        dsn,
        sendDefaultPii: false,
        // Default integrations stay ON (breadcrumbs feed scrubEvent; Dedupe
        // collapses the overlap with the manual pre-init handlers in
        // index.tsx). Performance tracing and session replay are opt-in
        // integrations we deliberately never add — error events only.
        beforeSend: scrubEvent,
      });
      sentry = mod;
    } catch (e) {
      // Best-effort: error-tracking failures must never surface to the user.
      console.warn('Sentry unavailable:', e);
    } finally {
      initSettled = true;
      flushPendingErrors();
    }
  })();
  return initPromise;
}

/**
 * Kick off Sentry initialization. Fire-and-forget — must not block boot. Safe
 * to call in any environment (dev, tests, SSR); no-ops without a DSN.
 */
export function initErrorTracking(): void {
  void initErrorTrackingInternal();
}

/**
 * Report an error to Sentry. No-ops safely (and never throws) when tracking
 * isn't available — dev, tests, SSR, missing DSN, or init failure. Errors
 * fired before async initialization settles are queued (bounded) and flushed
 * once the SDK is ready, so boot-time crashes aren't lost.
 */
export function captureException(
  error: unknown,
  context?: Record<string, string>,
): void {
  if (!sentry) {
    if (!initSettled) {
      if (pendingErrors.length < MAX_PENDING_ERRORS) {
        pendingErrors.push([error, context]);
      }
      // The error may beat the eager init; kick it off again.
      void initErrorTrackingInternal();
    }
    return;
  }
  try {
    sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Swallow — error tracking must never break product code.
  }
}
