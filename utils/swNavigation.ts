/**
 * Service-worker → app navigation bridge.
 *
 * `public/sw.js` handles a notification tap in two ways. With no window open it
 * calls `clients.openWindow(...)` and the deep link arrives in the URL. With a
 * window ALREADY open it focuses that window and posts
 * `{ type: 'NAVIGATE', url }` — and until this module existed nothing listened,
 * so the focused app just stayed wherever it was. On iOS that was the common
 * case, not the edge case: an installed PWA nearly always still has a live
 * window client, which is why `nsrc` / `recap` / `nact` deep links looked like
 * they "didn't work" on device.
 *
 * The two halves here are pure/DOM-thin so they can be unit-tested; the
 * subscription itself lives in `useNotificationActionIntent`, which already owns
 * reading the deep-link params back off the URL.
 */

export const SW_NAVIGATE_MESSAGE = 'NAVIGATE';

/**
 * Validate a service-worker message and return the app path it asks for, or
 * null for anything else.
 *
 * A service worker is same-origin and can't be spoken to cross-origin, but the
 * value still ends up in `location`, so it is treated as untrusted input:
 * only a plain in-app absolute path is accepted. Protocol-relative (`//host`),
 * backslash variants (`/\host`) and anything carrying a scheme are rejected
 * rather than sanitized.
 */
export function readNavigateMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { type, url } = data as { type?: unknown; url?: unknown };
  if (type !== SW_NAVIGATE_MESSAGE) return null;
  if (typeof url !== 'string' || url.length === 0) return null;
  if (!url.startsWith('/')) return null;
  if (url.startsWith('//') || url.startsWith('/\\')) return null;
  return url;
}

/**
 * Route the already-open app to a service-worker-supplied path.
 *
 * Assigning `location.hash` does both halves of the job at once: HashRouter
 * navigates on the resulting `hashchange`, and the deep-link params ride along
 * inside the hash query where `consumeNotificationAction` and friends already
 * know to look. The hashchange is dispatched asynchronously, so callers that
 * want to read + strip those params must wait a task — see
 * `useNotificationActionIntent`.
 */
export function applyNavigateMessage(path: string): void {
  if (typeof window === 'undefined') return;
  window.location.hash = path;
}
