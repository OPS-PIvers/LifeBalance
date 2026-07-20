import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

// F-TODO-14 (timed to-do reminders) — pure, unit-tested decision logic for the
// 15-minute `sendtodoreminders` scheduled job in index.ts. Mirrors the field
// semantics documented on `ToDo` in types/schema.ts:
//   - completeByDate: yyyy-MM-dd (assignee-local calendar date)
//   - dueTime:        HH:mm 24-hour wall-clock in the assignee's timezone
//   - reminderMinutesBefore: lead time in minutes (0 = at the due time)
//   - reminderSentAt: set once the push is sent; null/absent = not sent yet

/** The subset of a todo doc the reminder decision needs. */
export interface ReminderTodo {
  text?: unknown;
  completeByDate?: unknown;
  dueTime?: unknown;
  reminderMinutesBefore?: unknown;
  reminderSentAt?: unknown;
  isCompleted?: unknown;
  assignedTo?: unknown;
}

/**
 * Late catch-up window: a reminder whose computed time was missed (cold start,
 * delayed run) is still sent up to this long after it was due, then dropped
 * silently rather than arriving absurdly late.
 */
export const REMINDER_LATE_CUTOFF_MS = 60 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Computes the UTC instant (epoch ms) at which this todo's reminder should
 * fire: (completeByDate + dueTime in `timezone`) − reminderMinutesBefore.
 * Returns null when the todo has no valid time+reminder pair or the timezone
 * is unusable.
 */
export function computeReminderAtMs(
  todo: ReminderTodo,
  timezone: string
): number | null {
  const { completeByDate, dueTime, reminderMinutesBefore } = todo;
  if (typeof completeByDate !== "string" || !DATE_RE.test(completeByDate)) return null;
  if (typeof dueTime !== "string" || !TIME_RE.test(dueTime)) return null;
  if (
    typeof reminderMinutesBefore !== "number" ||
    !Number.isFinite(reminderMinutesBefore) ||
    reminderMinutesBefore < 0
  ) {
    return null;
  }

  // Invalid IANA timezones surface as either a throw or an Invalid Date
  // depending on the runtime — treat both as "fall back to UTC", matching
  // isTimeToSend's spirit.
  let dueMs = NaN;
  try {
    dueMs = fromZonedTime(`${completeByDate}T${dueTime}:00`, timezone).getTime();
  } catch (_e) {
    // fall through to the UTC fallback below
  }
  if (Number.isNaN(dueMs)) {
    dueMs = fromZonedTime(`${completeByDate}T${dueTime}:00`, "UTC").getTime();
  }
  if (Number.isNaN(dueMs)) return null;

  return dueMs - reminderMinutesBefore * 60 * 1000;
}

/**
 * Full send gate for one todo: has an armed, valid reminder; not completed;
 * its computed instant has arrived; and we are within the late-catch-up
 * window. The job additionally checks member prefs/tokens and writes
 * reminderSentAt after a send.
 */
export function shouldSendTodoReminder(
  todo: ReminderTodo,
  nowMs: number,
  timezone: string
): boolean {
  if (todo.isCompleted === true) return false;
  if (todo.reminderSentAt != null) return false;
  const reminderAtMs = computeReminderAtMs(todo, timezone);
  if (reminderAtMs === null) return false;
  return nowMs >= reminderAtMs && nowMs - reminderAtMs <= REMINDER_LATE_CUTOFF_MS;
}

/**
 * Push body helper: "<task text> — due at 3:00 PM". A 0-offset reminder is
 * phrased the same way — the assignee wants to know WHEN it's due, not when
 * we happened to send.
 */
export function buildTodoReminderBody(
  todo: ReminderTodo,
  timezone: string,
  nowMs: number
): string {
  const text = typeof todo.text === "string" && todo.text.trim() ? todo.text.trim() : "A task";
  const { completeByDate, dueTime } = todo;
  if (typeof completeByDate === "string" && typeof dueTime === "string" && TIME_RE.test(dueTime)) {
    let label: string;
    try {
      // Reuse the stored wall-clock time for display — it IS the assignee-local
      // time, so format it directly without a timezone round-trip.
      const [hStr = "0", mStr = "00"] = dueTime.split(":");
      const hour = parseInt(hStr, 10);
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour % 12 || 12;
      label = `${displayHour}:${mStr} ${period}`;
      // Append the due date only when it differs from the assignee-local
      // today (e.g. a "1 day before" reminder).
      const localToday = formatInTimeZone(new Date(nowMs), timezone, "yyyy-MM-dd");
      if (completeByDate !== localToday) {
        // Human-readable date ("Jul 20"), formatted straight from the stored
        // string — completeByDate IS the assignee-local calendar date, so any
        // Date/timezone round-trip can only shift the day (a noon-UTC anchor
        // already breaks for UTC+13/+14 assignees).
        const [, moStr = "", dayStr = ""] = completeByDate.split("-");
        const monthAbbr = MONTH_ABBREVIATIONS[parseInt(moStr, 10) - 1];
        if (monthAbbr) {
          label = `${label} on ${monthAbbr} ${parseInt(dayStr, 10)}`;
        }
      }
    } catch (_e) {
      label = dueTime;
    }
    return `${text} — due at ${label}`;
  }
  return text;
}
