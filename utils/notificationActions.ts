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
 * Query/hash param carrying the habit an action targets (F-HABITS-03).
 *
 * The action id alone can't express "log THIS habit" — the ids are a fixed,
 * validated set, so the target travels beside the action rather than being
 * encoded into it. Set by the sending job on the deep link, not by the SW.
 */
export const NOTIFICATION_HABIT_PARAM = 'nhabit';

/**
 * Known action ids. Kept deliberately small; the SW validates against these so a
 * malformed/foreign action can never drive an app-side mutation.
 *  - `pay-bill`   : bill reminder → jump to the budget/pay flow.
 *  - `snooze-bill`: bill reminder → snooze the reminder category for one day.
 *  - `log-habit`  : habit reminder → log the habit named by `nhabit` (one unit,
 *    today), exactly as a manual tap would. Undo comes from the points toast the
 *    toggle already raises, so there is no separate reverse action id.
 */
export const NOTIFICATION_ACTIONS = {
  payBill: 'pay-bill',
  snoozeBill: 'snooze-bill',
  logHabit: 'log-habit',
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
  return appendParam(path, NOTIFICATION_ACTION_PARAM, action);
}

/**
 * Append the habit target an action applies to (F-HABITS-03). Composes with
 * `appendNotificationAction` in either order — both use the same placement rules.
 */
export function appendNotificationHabit(path: string, habitId: string): string {
  return appendParam(path, NOTIFICATION_HABIT_PARAM, habitId);
}

function appendParam(path: string, param: string, value: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}${param}=${encodeURIComponent(value)}`;
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
  const { value, cleanedHref } = extractNotificationParam(href, NOTIFICATION_ACTION_PARAM);
  return { action: value, cleanedHref };
}

/**
 * The generic form of the above: read + strip `param` from either the real query
 * string or a HashRouter hash query. Pure — exported for tests and for the habit
 * target param.
 */
export function extractNotificationParam(
  href: string,
  param: string
): { value: string | null; cleanedHref: string } {
  try {
    const url = new URL(href);

    const fromSearch = url.searchParams.get(param);
    if (fromSearch !== null) {
      url.searchParams.delete(param);
      return { value: fromSearch, cleanedHref: url.toString() };
    }

    const queryStart = url.hash.indexOf('?');
    if (queryStart !== -1) {
      const params = new URLSearchParams(url.hash.slice(queryStart + 1));
      const fromHash = params.get(param);
      if (fromHash !== null) {
        params.delete(param);
        const rest = params.toString();
        url.hash = url.hash.slice(0, queryStart) + (rest ? `?${rest}` : '');
        return { value: fromHash, cleanedHref: url.toString() };
      }
    }

    return { value: null, cleanedHref: href };
  } catch {
    return { value: null, cleanedHref: href };
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
  stripFromAddressBar(cleanedHref);
  return isKnownNotificationAction(action) ? action : null;
}

/**
 * Consume the `nhabit` target param (F-HABITS-03). Returns the raw habit id or
 * null, and strips it from the address bar. The id is NOT validated here — the
 * caller resolves it against the household's live habits, and an id that doesn't
 * resolve simply does nothing. Safe to call unconditionally.
 */
export function consumeNotificationHabitId(): string | null {
  if (typeof window === 'undefined') return null;
  const { value, cleanedHref } = extractNotificationParam(
    window.location.href,
    NOTIFICATION_HABIT_PARAM
  );
  if (value === null || value === '') return null;
  stripFromAddressBar(cleanedHref);
  return value;
}

function stripFromAddressBar(cleanedHref: string): void {
  try {
    window.history.replaceState(window.history.state, '', cleanedHref);
  } catch {
    // Best-effort cleanup; the value has already been read.
  }
}
