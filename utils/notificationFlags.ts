import type { NotificationPreferences } from '@/types/schema';

/**
 * Plan 06 (notification fan-out cost) — pure helper computing the denormalized
 * `anyNotificationsEnabled` flag maintained on each HouseholdMember doc.
 *
 * True iff the member has at least one FCM token AND at least one notification
 * category that could fire is enabled:
 *   - habitReminders / actionQueueReminders / streakWarnings / billReminders:
 *     counted enabled only when `.enabled === true`.
 *   - weeklyRecap: this pref is fail-open (absent/undefined defaults to ON;
 *     only an explicit `enabled: false` opts out — see NotificationPreferences
 *     in types/schema.ts). For THIS flag's purpose ("could any push ever be
 *     sent to this member") we treat weeklyRecap as enabled unless explicitly
 *     disabled, matching that fail-open spirit. Note the weekly recap job
 *     additionally gates on premium status server-side — that's a separate
 *     check the recap job still performs; this flag only answers "is a push
 *     category live".
 *   - digestMode: counted enabled only when `.enabled === true`, same as the
 *     four per-type toggles — a member relying solely on the digest (all four
 *     per-type toggles off) must still match the collection-group query.
 *
 * Kept in perfect parity with the server copy in
 * functions/src/shared/notifications.ts — mirror any change there.
 */
export function computeAnyNotificationsEnabled(
  prefs: NotificationPreferences | undefined,
  fcmTokens: string[] | undefined
): boolean {
  if (!fcmTokens || fcmTokens.length === 0) return false;
  // No prefs object at all (legacy/new member): weeklyRecap's fail-open
  // default still applies, so a member with tokens remains reachable.
  if (!prefs) return true;

  const weeklyRecapEnabled = prefs.weeklyRecap?.enabled !== false;

  return (
    prefs.habitReminders?.enabled === true ||
    prefs.actionQueueReminders?.enabled === true ||
    prefs.digestMode?.enabled === true ||
    prefs.streakWarnings?.enabled === true ||
    prefs.billReminders?.enabled === true ||
    prefs.dailyBriefing?.enabled === true ||
    weeklyRecapEnabled
  );
}
