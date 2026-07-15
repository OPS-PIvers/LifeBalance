/**
 * F-NOTIF-10 — per-notification-type vibration patterns.
 *
 * Reality check (do this before touching sw.js further): the Notification API's
 * `vibrate` option is part of the *Web Notifications* spec, not something all
 * platforms honor.
 *   - iOS Safari / iOS PWAs (any browser on iOS, since they're all WebKit)
 *     IGNORE `vibrate` entirely — Apple has never implemented the Vibration API
 *     or `vibrate` on notification options, full stop. There is no workaround;
 *     this is a platform limitation, not a bug in our service worker.
 *   - Desktop browsers (macOS/Windows/Linux) have no vibration hardware, so
 *     `vibrate` is a silent no-op there regardless of spec support.
 *   - Android Chrome/Edge (Chromium) is the ONLY realistic target that honors
 *     `ServiceWorkerRegistration.showNotification()`'s `vibrate` pattern, and
 *     only when the notification is actually shown by the OS (not suppressed
 *     by battery saver / notification channel settings the user configured).
 *
 * Net effect: this is a real but narrow win — Android Chrome/Edge users feel a
 * distinct pulse pattern per notification type; everyone else (iOS, desktop)
 * gets the exact same notification they always did, because passing an
 * unsupported `vibrate` array is a harmless no-op there. We ship it because
 * the win is real for a meaningful slice of users and the cost is a few lines
 * in an already-existing push handler — but this table is NOT a promise that
 * vibration will be felt on any given device.
 *
 * Keep this table in sync with public/sw.js's PUSH_VIBRATE_PATTERNS (a service
 * worker can't `import` from the app bundle, so the table is duplicated there
 * — see the frozen-date table precedent in CLAUDE.md for the same pattern).
 */

/** The `data.type` values the Cloud Functions notification jobs attach to a push payload. */
export type PushNotificationType =
  | 'habit_reminder'
  | 'action_queue_reminder'
  | 'streak_warning'
  | 'bill_reminder'
  | 'budget_alert'
  | 'weekly_recap'
  | 'monthly_money_recap'
  | 'test_notification';

/** Fallback pattern used for unknown/unmapped types (matches the prior single generic pattern). */
export const DEFAULT_VIBRATE_PATTERN: readonly number[] = [100, 50, 100];

/**
 * Per-type vibration patterns (ms on/off pairs), tuned so higher-urgency types
 * feel more insistent (longer pulses / more pulses) than routine reminders.
 */
const VIBRATE_PATTERNS: Record<PushNotificationType, readonly number[]> = {
  // Urgent money/streak-loss types: long-short-long, harder to miss.
  streak_warning: [200, 80, 200, 80, 200],
  budget_alert: [200, 80, 200, 80, 200],
  bill_reminder: [150, 60, 150],
  // Routine daily reminders: two short pulses.
  habit_reminder: [80, 60, 80],
  action_queue_reminder: [80, 60, 80],
  // Low-urgency/informational recaps: a single gentle pulse.
  weekly_recap: [100],
  monthly_money_recap: [100],
  test_notification: [100, 50, 100],
};

/**
 * Returns the vibration pattern for a push notification's `data.type`. Unknown
 * or missing types fall back to `DEFAULT_VIBRATE_PATTERN` so a new/unmapped
 * notification type never throws — it just gets the old generic buzz.
 */
export function getVibratePattern(type: string | undefined | null): readonly number[] {
  if (!type) return DEFAULT_VIBRATE_PATTERN;
  const pattern = VIBRATE_PATTERNS[type as PushNotificationType];
  return pattern ?? DEFAULT_VIBRATE_PATTERN;
}
