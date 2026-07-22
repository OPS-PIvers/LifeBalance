import { describe, it, expect } from "vitest";
import {
  computeReminderAtMs,
  shouldSendTodoReminder,
  buildTodoReminderBody,
  REMINDER_LATE_CUTOFF_MS,
  type ReminderTodo,
} from "./todoReminders";

// 2026-07-20 15:00 America/Chicago (CDT, UTC-5) === 20:00:00Z
const DUE_UTC_MS = Date.parse("2026-07-20T20:00:00.000Z");
const TZ = "America/Chicago";

const base: ReminderTodo = {
  text: "Call dentist",
  completeByDate: "2026-07-20",
  dueTime: "15:00",
  reminderMinutesBefore: 30,
  isCompleted: false,
};

describe("computeReminderAtMs", () => {
  it("computes due-time minus offset in the given timezone", () => {
    expect(computeReminderAtMs(base, TZ)).toBe(DUE_UTC_MS - 30 * 60 * 1000);
  });

  it("supports 0 offset (at due time) and day-long offsets", () => {
    expect(computeReminderAtMs({ ...base, reminderMinutesBefore: 0 }, TZ)).toBe(DUE_UTC_MS);
    expect(computeReminderAtMs({ ...base, reminderMinutesBefore: 1440 }, TZ)).toBe(
      DUE_UTC_MS - 1440 * 60 * 1000
    );
  });

  it("interprets the same wall time differently per timezone", () => {
    const chicago = computeReminderAtMs(base, "America/Chicago");
    const utc = computeReminderAtMs(base, "UTC");
    expect((chicago as number) - (utc as number)).toBe(5 * 60 * 60 * 1000);
  });

  it("falls back to UTC on an invalid timezone", () => {
    expect(computeReminderAtMs(base, "Not/AZone")).toBe(
      Date.parse("2026-07-20T15:00:00.000Z") - 30 * 60 * 1000
    );
  });

  it("returns null for missing or malformed fields", () => {
    expect(computeReminderAtMs({ ...base, dueTime: undefined }, TZ)).toBeNull();
    expect(computeReminderAtMs({ ...base, dueTime: "25:00" }, TZ)).toBeNull();
    expect(computeReminderAtMs({ ...base, reminderMinutesBefore: undefined }, TZ)).toBeNull();
    expect(computeReminderAtMs({ ...base, reminderMinutesBefore: -5 }, TZ)).toBeNull();
    expect(computeReminderAtMs({ ...base, completeByDate: "07/20/2026" }, TZ)).toBeNull();
  });
});

describe("shouldSendTodoReminder", () => {
  const reminderAt = DUE_UTC_MS - 30 * 60 * 1000;

  it("sends exactly at and shortly after the computed instant", () => {
    expect(shouldSendTodoReminder(base, reminderAt, TZ)).toBe(true);
    expect(shouldSendTodoReminder(base, reminderAt + 10 * 60 * 1000, TZ)).toBe(true);
  });

  it("does not send before the computed instant", () => {
    expect(shouldSendTodoReminder(base, reminderAt - 1, TZ)).toBe(false);
  });

  it("drops reminders past the late-catch-up cutoff", () => {
    expect(shouldSendTodoReminder(base, reminderAt + REMINDER_LATE_CUTOFF_MS, TZ)).toBe(true);
    expect(shouldSendTodoReminder(base, reminderAt + REMINDER_LATE_CUTOFF_MS + 1, TZ)).toBe(false);
  });

  it("skips completed todos and already-sent reminders", () => {
    expect(shouldSendTodoReminder({ ...base, isCompleted: true }, reminderAt, TZ)).toBe(false);
    expect(
      shouldSendTodoReminder({ ...base, reminderSentAt: "2026-07-20T19:30:00Z" }, reminderAt, TZ)
    ).toBe(false);
    // null means re-armed / not sent — eligible again
    expect(shouldSendTodoReminder({ ...base, reminderSentAt: null }, reminderAt, TZ)).toBe(true);
  });

  it("skips todos with no reminder configured", () => {
    expect(shouldSendTodoReminder({ ...base, reminderMinutesBefore: undefined }, reminderAt, TZ)).toBe(false);
    expect(shouldSendTodoReminder({ ...base, dueTime: undefined }, reminderAt, TZ)).toBe(false);
  });

  it("skips held-for-review todos (captureReview) until approved", () => {
    expect(shouldSendTodoReminder({ ...base, needsReview: true }, reminderAt, TZ)).toBe(false);
  });
});

describe("buildTodoReminderBody", () => {
  it("includes the task text and a 12-hour due time", () => {
    expect(buildTodoReminderBody(base, TZ, DUE_UTC_MS - 30 * 60 * 1000)).toBe(
      "Call dentist — due at 3:00 PM"
    );
  });

  it("renders the stored calendar date verbatim for UTC+13/+14 assignees", () => {
    // A day-before reminder for an Auckland (UTC+13 DST) assignee: any
    // Date-object round-trip of the date string would render Jul 21.
    const nowMs = DUE_UTC_MS - 2 * 1440 * 60 * 1000; // Kiritimati-local Jul 19
    expect(buildTodoReminderBody(base, "Pacific/Kiritimati", nowMs)).toContain("on Jul 20");
  });

  it("appends the due date when it is not the assignee-local today", () => {
    // 1-day-before reminder fires on 2026-07-19 local
    const nowMs = DUE_UTC_MS - 1440 * 60 * 1000;
    expect(buildTodoReminderBody(base, TZ, nowMs)).toBe(
      "Call dentist — due at 3:00 PM on Jul 20"
    );
  });

  it("falls back gracefully without a valid time", () => {
    expect(buildTodoReminderBody({ ...base, dueTime: undefined }, TZ, DUE_UTC_MS)).toBe("Call dentist");
    expect(buildTodoReminderBody({ ...base, text: "  " }, TZ, DUE_UTC_MS)).toBe("A task — due at 3:00 PM");
  });
});
