import { formatInTimeZone } from "date-fns-tz";
import { format, parseISO, startOfISOWeek } from "date-fns";

/**
 * F-HABITS-03 (per-habit timed reminders) — pure, unit-tested decision logic for
 * the 15-minute `sendperhabitreminders` scheduled job in index.ts.
 *
 * Config lives on the MEMBER doc under
 * `notificationPreferences.perHabitReminders[habitId]` (see the client source of
 * truth `utils/habitReminders.ts` for why it isn't on the shared habit doc), and
 * is a `{enabled, time, days}` triple where `time` is an arbitrary member-local
 * HH:MM and `days` are 0 (Sunday) … 6 (Saturday).
 *
 * Nothing here touches Firestore or the admin SDK — the job supplies the clock
 * and the docs, this module decides.
 */

/** Normalized config. Mirrors `HabitReminderConfig` in types/schema.ts. */
export interface HabitReminderConfig {
  enabled: boolean;
  time: string;
  days: number[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Late catch-up window, in member-local minutes. A reminder whose minute was
 * missed (a skipped or slow run) still fires up to this long afterwards, then
 * is dropped rather than arriving absurdly late — same bargain as
 * `REMINDER_LATE_CUTOFF_MS` in todoReminders.ts, and safe to keep generous
 * because the job claims a once-per-local-day stamp before sending.
 *
 * The window is measured within the local day, so it never spills across
 * midnight: a 23:50 reminder still pending at 00:05 is dropped, because an
 * alarm that arrives on the wrong calendar day is worse than one that doesn't
 * arrive at all (and the day-of-week gate would be reading the wrong day too).
 */
export const HABIT_REMINDER_LATE_CUTOFF_MINUTES = 60;

/**
 * Coerce a stored value into a usable config, or null when it's unusable.
 * Deliberately identical in effect to `normalizeHabitReminder` in
 * utils/habitReminders.ts — an invalid `time` is unrecoverable and voids the
 * whole config, while out-of-range/duplicate day entries are merely dropped.
 */
export function normalizeHabitReminder(raw: unknown): HabitReminderConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { enabled?: unknown; time?: unknown; days?: unknown };

  if (typeof candidate.time !== "string" || !TIME_RE.test(candidate.time)) {
    return null;
  }

  const days = Array.isArray(candidate.days)
    ? [
        ...new Set(
          (candidate.days as unknown[]).filter(
            (d): d is number =>
              typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 6
          )
        ),
      ].sort((a, b) => a - b)
    : [];

  return { enabled: candidate.enabled === true, time: candidate.time, days };
}

/** The member-local clock facts every reminder decision is made against. */
export interface LocalClock {
  /** yyyy-MM-dd in the member's timezone. */
  date: string;
  /** 0 = Sunday … 6 = Saturday, matching `HabitReminderConfig.days`. */
  dayOfWeek: number;
  /** Minutes since local midnight. */
  minutesOfDay: number;
}

/**
 * Resolve `nowMs` into the member's local date/day/minute. An unusable IANA
 * timezone falls back to UTC rather than dropping the member — matching
 * `isTimeToSend`'s behaviour in notifications.ts.
 */
export function localClock(nowMs: number, timezone: string): LocalClock {
  const now = new Date(nowMs);
  let stamp: string;
  try {
    // "i" is the ISO day of week (1 = Monday … 7 = Sunday) — locale-independent,
    // unlike "e"/"c", so it can't shift under a different default locale.
    stamp = formatInTimeZone(now, timezone, "yyyy-MM-dd i HH mm");
  } catch (_e) {
    stamp = formatInTimeZone(now, "UTC", "yyyy-MM-dd i HH mm");
  }
  const [date = "", isoDay = "1", hh = "0", mm = "0"] = stamp.split(" ");
  const iso = parseInt(isoDay, 10);
  return {
    date,
    dayOfWeek: iso === 7 ? 0 : iso,
    minutesOfDay: parseInt(hh, 10) * 60 + parseInt(mm, 10),
  };
}

/**
 * Whether an armed reminder's moment has arrived on this local day: the day of
 * week is selected, the local clock has reached the configured minute, and we
 * are still inside the catch-up window.
 */
export function isReminderDue(config: HabitReminderConfig, clock: LocalClock): boolean {
  if (!config.enabled) return false;
  if (!config.days.includes(clock.dayOfWeek)) return false;

  const [hh = "0", mm = "0"] = config.time.split(":");
  const dueMinutes = parseInt(hh, 10) * 60 + parseInt(mm, 10);
  const elapsed = clock.minutesOfDay - dueMinutes;
  return elapsed >= 0 && elapsed <= HABIT_REMINDER_LATE_CUTOFF_MINUTES;
}

/** The subset of a habit doc the reminder decision reads. */
export interface ReminderHabit {
  title?: unknown;
  period?: unknown;
  completedDates?: unknown;
  archivedAt?: unknown;
  pausedUntil?: unknown;
  ownerId?: unknown;
}

const completionDates = (habit: ReminderHabit): string[] =>
  Array.isArray(habit.completedDates)
    ? habit.completedDates.filter((d): d is string => typeof d === "string")
    : [];

/**
 * Period-aware "already done" check — the server twin of
 * `isHabitCompletedInCurrentPeriod` in utils/habitLogic.ts. A daily habit is
 * done iff `today` itself is a completion; a weekly one iff ANY completion
 * falls in `today`'s Monday-anchored ISO week, so a weekly chore finished on
 * Monday doesn't nag again on Thursday.
 */
export function isCompletedInPeriod(habit: ReminderHabit, today: string): boolean {
  const dates = completionDates(habit);
  if (habit.period !== "weekly") return dates.includes(today);

  const weekStartOf = (d: string): string => format(startOfISOWeek(parseISO(d)), "yyyy-MM-dd");
  let thisWeek: string;
  try {
    thisWeek = weekStartOf(today);
  } catch (_e) {
    return false;
  }
  return dates.some((d) => {
    try {
      return weekStartOf(d) === thisWeek;
    } catch (_e) {
      return false;
    }
  });
}

/**
 * Whether this habit is worth reminding `memberUid` about right now, ignoring
 * the schedule (that's `isReminderDue`) and the once-a-day stamp (that's the
 * job's transaction). Suppressed when the habit is:
 *   - archived (F-HABITS-05 — retired, but kept for history),
 *   - inside a planned pause (F-HABITS-01 — the whole point is not being nagged),
 *   - already complete for its current period, or
 *   - someone else's personal habit (a shared habit has no `ownerId`).
 *
 * NOTE: `digestMode` is deliberately NOT consulted by the caller. A per-habit
 * reminder is set for a specific habit at a specific minute — an alarm, not a
 * briefing — so it follows the `sendtodoreminders` precedent rather than the
 * four hourly summary jobs that fold into the digest.
 */
export function isRemindableHabit(
  habit: ReminderHabit,
  today: string,
  memberUid: string
): boolean {
  if (typeof habit.archivedAt === "string" && habit.archivedAt) return false;
  if (typeof habit.pausedUntil === "string" && habit.pausedUntil >= today) return false;
  if (typeof habit.ownerId === "string" && habit.ownerId !== memberUid) return false;
  return !isCompletedInPeriod(habit, today);
}

/** How many habit names the coalesced body spells out before summarizing. */
export const MAX_NAMED_HABITS = 3;

/**
 * Push copy for the habits due in one fire window. Returns null for an empty
 * list so the job can skip the send, matching every other scheduled job.
 *
 * Single-habit pushes name the habit and invite the log; multi-habit pushes
 * name up to `MAX_NAMED_HABITS` and count the rest. The title stays the generic
 * category label ("Habit Reminder") for consistency with "To-Do Reminder" —
 * the specifics belong in the body, which is the line iOS renders in full.
 */
export function buildHabitReminderMessage(
  titles: string[]
): { title: string; body: string } | null {
  const names = titles
    .map((t) => (typeof t === "string" ? t.trim() : ""))
    .filter((t) => t.length > 0);
  if (names.length === 0) return null;

  if (names.length === 1) {
    return { title: "Habit Reminder", body: `${names[0]} — time to log it.` };
  }

  const shown = names.slice(0, MAX_NAMED_HABITS);
  const hidden = names.length - shown.length;
  const list = hidden > 0 ? `${shown.join(", ")} and ${hidden} more` : shown.join(", ");
  return { title: "Habit Reminder", body: `${names.length} habits to log: ${list}` };
}
