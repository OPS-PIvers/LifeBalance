/**
 * Attribution for push-notification opens.
 *
 * The service worker cannot call the GA client SDK, so on notification click it
 * tags the URL it navigates to with `?nsrc=<notification type>` (see
 * `public/sw.js` — the tagging there must stay in sync with
 * `appendNotificationSource` below, which exists so the round-trip is
 * unit-testable). On boot the app reads + strips the param and fires a
 * `notification_opened` event. Dependency-free besides the analytics wrapper.
 */
import { track } from '@/services/analytics';

export const NOTIFICATION_SOURCE_PARAM = 'nsrc';

/**
 * Mirror of the URL tagging performed in `public/sw.js` (keep in sync). The
 * path may be a plain path (`/habits`), already carry a query, or be a hash
 * route — the param is appended to whatever segment the path ends in, and
 * `consumeNotificationSource` understands both placements.
 */
export function appendNotificationSource(path: string, type: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${NOTIFICATION_SOURCE_PARAM}=${encodeURIComponent(type)}`;
}

/**
 * Read + strip the `nsrc` param from a full href. Handles the param in the
 * real query string (`/habits?nsrc=x` — the SW `openWindow` path) and inside
 * the hash (`/#/habits?nsrc=x` — HashRouter navigations). Returns the
 * notification type (or null) and the href with the param removed.
 */
export function consumeNotificationSource(href: string): { type: string | null; cleanedHref: string } {
  try {
    const url = new URL(href);

    const fromSearch = url.searchParams.get(NOTIFICATION_SOURCE_PARAM);
    if (fromSearch !== null) {
      url.searchParams.delete(NOTIFICATION_SOURCE_PARAM);
      return { type: fromSearch, cleanedHref: url.toString() };
    }

    const queryStart = url.hash.indexOf('?');
    if (queryStart !== -1) {
      const params = new URLSearchParams(url.hash.slice(queryStart + 1));
      const fromHash = params.get(NOTIFICATION_SOURCE_PARAM);
      if (fromHash !== null) {
        params.delete(NOTIFICATION_SOURCE_PARAM);
        const rest = params.toString();
        url.hash = url.hash.slice(0, queryStart) + (rest ? `?${rest}` : '');
        return { type: fromHash, cleanedHref: url.toString() };
      }
    }

    return { type: null, cleanedHref: href };
  } catch {
    return { type: null, cleanedHref: href };
  }
}

/**
 * The last notification type this session was handed by the service worker, or
 * `null` if the app was opened normally.
 *
 * `nsrc` is a CONSUME-ONCE param: `trackNotificationOpenFromUrl` reads it and
 * strips it from the address bar at boot (`index.tsx`, before React mounts), so
 * by the time any component renders the URL no longer carries it. Remembering
 * the verdict here is purely additive — the param is still read and stripped
 * exactly once, by exactly one caller — and it is what lets a later consumer
 * ask "was this app open a deliberate deep-link arrival?" without racing the
 * boot-time strip or re-parsing a URL that has already been cleaned.
 */
let notificationOpenType: string | null = null;

/**
 * Was this app open handed to us by a notification tap, and if so which type?
 *
 * A plain module read, not a consume: callers may ask as often as they like and
 * nobody downstream loses the value. Today's only consumer is
 * `WeeklyRecapCard`'s auto-open, which must not hijack an arrival the user was
 * deliberately sent somewhere by.
 */
export function getNotificationOpenType(): string | null {
  return notificationOpenType;
}

/** Test-only: forget the recorded arrival so suites don't leak into each other. */
export function resetNotificationOpenTypeForTest(): void {
  notificationOpenType = null;
}

/**
 * Boot check: if the current URL carries an `nsrc` tag, fire
 * `notification_opened`, record the type (see `getNotificationOpenType`) and
 * strip the param from the address bar. Safe to call unconditionally — no-ops
 * without the param, and never throws.
 */
export function trackNotificationOpenFromUrl(): void {
  if (typeof window === 'undefined') return;
  const { type, cleanedHref } = consumeNotificationSource(window.location.href);
  if (type === null || type === '') return;
  notificationOpenType = type;
  track('notification_opened', { type });
  try {
    window.history.replaceState(window.history.state, '', cleanedHref);
  } catch {
    // Best-effort cleanup; the event has already been recorded.
  }
}
