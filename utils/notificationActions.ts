/**
 * Notification action buttons (F-NOTIF-05).
 *
 * Push notifications can carry inline action buttons ("Pay bill", "Snooze")
 * rendered by the OS. The service worker (public/sw.js) shows them from a JSON
 * string on the FCM `data` payload and, when the user taps one, appends
 * `?nact=<action>` to the deep link it opens — exactly mirroring the `nsrc`
 * attribution tagging in `utils/notificationSource.ts`. On boot the app reads +
 * strips the param and dispatches the action from within an authenticated
 * session (so no unauthenticated Cloud Function endpoint is needed).
 *
 * This module is the single source of truth for the action ids and the URL
 * round-trip. The service worker and the Cloud Functions notification builder
 * (`functions/src/shared/notificationActions.ts`) each carry a small, documented
 * copy of the id constants — keep the three in sync.
 */

/** Query/hash param the SW appends to the deep link when an action is tapped. */
export const NOTIFICATION_ACTION_PARAM = 'nact';

/**
 * Known action ids. Kept deliberately small; the SW validates against these so a
 * malformed/foreign action can never drive an app-side mutation.
 *  - `pay-bill`   : bill reminder → jump to the budget/pay flow.
 *  - `snooze-bill`: bill reminder → snooze the reminder category for one day.
 */
export const NOTIFICATION_ACTIONS = {
  payBill: 'pay-bill',
  snoozeBill: 'snooze-bill',
} as const;

export type NotificationActionId =
  (typeof NOTIFICATION_ACTIONS)[keyof typeof NOTIFICATION_ACTIONS];

const KNOWN_ACTION_IDS: ReadonlySet<string> = new Set(
  Object.values(NOTIFICATION_ACTIONS)
);

/** Whether `id` is an action this app knows how to dispatch. */
export function isKnownNotificationAction(
  id: string | null | undefined
): id is NotificationActionId {
  return typeof id === 'string' && KNOWN_ACTION_IDS.has(id);
}

/** OS-rendered button metadata for a notification type. */
export interface NotificationActionButton {
  action: NotificationActionId;
  title: string;
}

/**
 * The action buttons a given notification `type` should carry. Returns an empty
 * array for types with no actions, so callers can unconditionally spread the
 * result. `type` matches the `data.type` value set by the sending job
 * (e.g. `bill_reminder`).
 */
export function getNotificationActions(type: string): NotificationActionButton[] {
  switch (type) {
    case 'bill_reminder':
      return [
        { action: NOTIFICATION_ACTIONS.payBill, title: 'Pay bill' },
        { action: NOTIFICATION_ACTIONS.snoozeBill, title: 'Snooze 1 day' },
      ];
    default:
      return [];
  }
}

/**
 * Mirror of the URL tagging performed in `public/sw.js` (keep in sync). Appends
 * the action param to whatever segment the path ends in — plain path, existing
 * query, or hash route — matching `appendNotificationSource`'s placement rules.
 */
export function appendNotificationAction(path: string, action: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${NOTIFICATION_ACTION_PARAM}=${encodeURIComponent(action)}`;
}

/**
 * Read + strip the `nact` param from a full href. Handles the param in the real
 * query string (`/budget?nact=pay-bill` — the SW `openWindow` path) and inside
 * the hash (`/#/budget?nact=pay-bill` — HashRouter navigations). Returns the
 * action id (or null) and the href with the param removed. Pure — exported for
 * tests; app code should call `consumeNotificationAction()`.
 */
export function extractNotificationAction(
  href: string
): { action: string | null; cleanedHref: string } {
  try {
    const url = new URL(href);

    const fromSearch = url.searchParams.get(NOTIFICATION_ACTION_PARAM);
    if (fromSearch !== null) {
      url.searchParams.delete(NOTIFICATION_ACTION_PARAM);
      return { action: fromSearch, cleanedHref: url.toString() };
    }

    const queryStart = url.hash.indexOf('?');
    if (queryStart !== -1) {
      const params = new URLSearchParams(url.hash.slice(queryStart + 1));
      const fromHash = params.get(NOTIFICATION_ACTION_PARAM);
      if (fromHash !== null) {
        params.delete(NOTIFICATION_ACTION_PARAM);
        const rest = params.toString();
        url.hash = url.hash.slice(0, queryStart) + (rest ? `?${rest}` : '');
        return { action: fromHash, cleanedHref: url.toString() };
      }
    }

    return { action: null, cleanedHref: href };
  } catch {
    return { action: null, cleanedHref: href };
  }
}

/**
 * Consume the `nact` deep-link param from the current URL: returns the known
 * action id (or null when absent/empty/unrecognized) and strips the param from
 * the address bar. Safe to call unconditionally — no-ops without the param,
 * never throws. An unrecognized value is still stripped but returns null so a
 * foreign param can never drive a mutation.
 */
export function consumeNotificationAction(): NotificationActionId | null {
  if (typeof window === 'undefined') return null;
  const { action, cleanedHref } = extractNotificationAction(window.location.href);
  if (action === null || action === '') return null;
  try {
    window.history.replaceState(window.history.state, '', cleanedHref);
  } catch {
    // Best-effort cleanup; the value has already been read.
  }
  return isKnownNotificationAction(action) ? action : null;
}
