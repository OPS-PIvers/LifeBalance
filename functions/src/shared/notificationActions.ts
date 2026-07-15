/**
 * Notification action buttons (F-NOTIF-05) — server side.
 *
 * The scheduled jobs attach an `actions` JSON string to the FCM `data` payload;
 * the service worker (public/sw.js) renders it as OS action buttons and, when a
 * button is tapped, deep-links back into the app with `?nact=<action>` which the
 * client dispatches from an authenticated session.
 *
 * This is the deliberately-small server twin of the client source of truth
 * `utils/notificationActions.ts` — the action ids MUST stay in sync across the
 * three files (here, that util, and public/sw.js). Firestore/FCM data payloads
 * are string-only, so `actions` is serialized to a JSON string.
 */

/** Action ids — keep identical to utils/notificationActions.ts NOTIFICATION_ACTIONS. */
export const NOTIFICATION_ACTIONS = {
  payBill: "pay-bill",
  snoozeBill: "snooze-bill",
} as const;

export interface NotificationActionButton {
  action: string;
  title: string;
}

/**
 * Action buttons for a notification `type` (matches the `data.type` value the
 * job sets). Returns [] for types without actions.
 */
export function getNotificationActions(type: string): NotificationActionButton[] {
  switch (type) {
    case "bill_reminder":
      return [
        { action: NOTIFICATION_ACTIONS.payBill, title: "Pay bill" },
        { action: NOTIFICATION_ACTIONS.snoozeBill, title: "Snooze 1 day" },
      ];
    default:
      return [];
  }
}

/**
 * The `actions` value to fold into the FCM `data` payload for a notification
 * type — a JSON string (FCM data values must be strings), or undefined when the
 * type has no actions so callers can spread it conditionally.
 */
export function buildActionsDataField(type: string): string | undefined {
  const actions = getNotificationActions(type);
  return actions.length > 0 ? JSON.stringify(actions) : undefined;
}

/**
 * Whether bill reminders are currently snoozed for a member. `snoozedUntil` is a
 * yyyy-MM-dd local date; reminders are suppressed while `localToday <= snoozedUntil`.
 * Pure string comparison is correct for the zero-padded yyyy-MM-dd format.
 */
export function isBillReminderSnoozed(
  snoozedUntil: string | undefined,
  localToday: string
): boolean {
  if (!snoozedUntil) return false;
  return localToday <= snoozedUntil;
}
