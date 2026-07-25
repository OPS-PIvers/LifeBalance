import type { Habit, HabitReminderConfig, NotificationPreferences } from '@/types/schema';

/**
 * F-HABITS-03 — per-habit reminder schedules.
 *
 * Pure config/display helpers shared by the habit form and (once the sending job
 * lands) mirrored server-side. Nothing here decides whether a reminder is *due* —
 * that's the scheduled job's business, and deliberately not half-defined here.
 *
 * Config lives on the member doc keyed by habit id; see
 * `NotificationPreferences.perHabitReminders` for why it isn't on the habit.
 */

/** Seeded when a reminder is first switched on — a plausible morning nudge. */
export const DEFAULT_REMINDER_TIME = '08:00';

/** Every weekday index, in `Date#getDay()` order. */
export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** Mon–Fri, for the "Weekdays" preset. */
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/** Display labels, indexed by `Date#getDay()`. */
export const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Single-letter labels for the compact day picker. Ambiguous by design (two
 *  T's, two S's) — always pair with the full label as an accessible name. */
export const DAY_LABELS_INITIAL = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/** Whether `time` is a well-formed 24-hour "HH:MM". */
export const isValidReminderTime = (time: string): boolean =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

/**
 * The config a habit gets when its reminder is first enabled. A daily habit
 * defaults to every day; a weekly habit defaults to Monday alone, since seeding
 * it to all seven would nag six times for one weekly completion. Monday is an
 * arbitrary but deterministic pick — deriving it from "today" would make the
 * default depend on when the user happened to open the form.
 */
export const defaultHabitReminder = (
  period: Habit['period'],
): HabitReminderConfig => ({
  enabled: true,
  time: DEFAULT_REMINDER_TIME,
  days: period === 'weekly' ? [1] : [...ALL_DAYS],
});

/**
 * Coerce a stored value into a usable config, or null when it's unusable.
 *
 * Tolerant on purpose: this reads whatever is on the member doc, which may
 * predate a schema change or have been written by an older client. An invalid
 * `time` is the one unrecoverable case (there's no safe guess), so it returns
 * null and the caller treats the habit as having no reminder. Out-of-range or
 * duplicate day values are dropped rather than rejecting the whole config.
 */
export const normalizeHabitReminder = (raw: unknown): HabitReminderConfig | null => {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { enabled?: unknown; time?: unknown; days?: unknown };

  if (typeof candidate.time !== 'string' || !isValidReminderTime(candidate.time)) {
    return null;
  }

  const days = Array.isArray(candidate.days)
    ? [
        ...new Set(
          (candidate.days as unknown[]).filter(
            (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
          ),
        ),
      ].sort((a, b) => a - b)
    : [];

  return { enabled: candidate.enabled === true, time: candidate.time, days };
};

/** Read one habit's reminder off a member's preferences, normalized. */
export const getHabitReminder = (
  prefs: NotificationPreferences | undefined,
  habitId: string,
): HabitReminderConfig | null => normalizeHabitReminder(prefs?.perHabitReminders?.[habitId]);

/** "08:00" → "8:00 AM". Returns the input unchanged when it isn't parseable. */
export const formatReminderTime = (time: string): string => {
  if (!isValidReminderTime(time)) return time;
  const [rawHour = '', minute = ''] = time.split(':');
  const hour = Number(rawHour);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
};

/** "Every day" / "Weekdays" / "Weekends" / "Mon, Wed, Fri" / "No days". */
export const formatReminderDays = (days: readonly number[]): string => {
  const unique = [...new Set(days)].sort((a, b) => a - b);
  if (unique.length === 0) return 'No days';
  if (unique.length === 7) return 'Every day';
  if (unique.length === 5 && WEEKDAYS.every(d => unique.includes(d))) return 'Weekdays';
  if (unique.length === 2 && unique[0] === 0 && unique[1] === 6) return 'Weekends';
  return unique.map(d => DAY_LABELS_SHORT[d] ?? '?').join(', ');
};

/** One-line summary for the habit form / card, e.g. "8:00 AM · Weekdays". */
export const formatReminderSummary = (config: HabitReminderConfig): string =>
  `${formatReminderTime(config.time)} · ${formatReminderDays(config.days)}`;

/**
 * Whether the member has at least one habit reminder that could ever fire.
 * A reminder with no days selected can't, so it doesn't count — this feeds the
 * denormalized `anyNotificationsEnabled` flag, which answers "is any push
 * category live for this member".
 */
export const hasEnabledHabitReminder = (
  prefs: NotificationPreferences | undefined,
): boolean => {
  const byHabitId = prefs?.perHabitReminders;
  if (!byHabitId) return false;
  return Object.values(byHabitId).some(config => {
    const normalized = normalizeHabitReminder(config);
    return normalized !== null && normalized.enabled && normalized.days.length > 0;
  });
};
