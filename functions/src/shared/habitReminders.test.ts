import { describe, it, expect } from "vitest";
import {
  HABIT_REMINDER_LATE_CUTOFF_MINUTES,
  buildHabitReminderMessage,
  isCompletedInPeriod,
  isRemindableHabit,
  isReminderDue,
  localClock,
  normalizeHabitReminder,
  type HabitReminderConfig,
  type LocalClock,
} from "./habitReminders";

const config = (over: Partial<HabitReminderConfig> = {}): HabitReminderConfig => ({
  enabled: true,
  time: "08:00",
  days: [0, 1, 2, 3, 4, 5, 6],
  ...over,
});

const clock = (over: Partial<LocalClock> = {}): LocalClock => ({
  date: "2026-07-24",
  dayOfWeek: 5,
  minutesOfDay: 8 * 60,
  ...over,
});

describe("normalizeHabitReminder", () => {
  it("accepts a well-formed config and sorts/dedupes its days", () => {
    expect(normalizeHabitReminder({ enabled: true, time: "17:30", days: [3, 1, 3] })).toEqual({
      enabled: true,
      time: "17:30",
      days: [1, 3],
    });
  });

  it("rejects an unusable time outright — there is no safe guess", () => {
    expect(normalizeHabitReminder({ enabled: true, time: "99:99", days: [1] })).toBeNull();
    expect(normalizeHabitReminder({ enabled: true, time: "8:00", days: [1] })).toBeNull();
    expect(normalizeHabitReminder({ enabled: true, days: [1] })).toBeNull();
  });

  it("drops out-of-range and non-integer days rather than voiding the config", () => {
    expect(
      normalizeHabitReminder({ enabled: true, time: "08:00", days: [-1, 0, 7, 2.5, "3", 6] })
    ).toEqual({ enabled: true, time: "08:00", days: [0, 6] });
  });

  it("treats anything but a literal true as disabled, and a missing days array as empty", () => {
    expect(normalizeHabitReminder({ enabled: "yes", time: "08:00" })).toEqual({
      enabled: false,
      time: "08:00",
      days: [],
    });
  });

  it("returns null for non-objects", () => {
    expect(normalizeHabitReminder(null)).toBeNull();
    expect(normalizeHabitReminder("08:00")).toBeNull();
    expect(normalizeHabitReminder(undefined)).toBeNull();
  });

  // The server and client copies must agree, or `anyNotificationsEnabled` and
  // the send gate disagree about the same stored document.
  it("matches the client normalizer's verdicts on the shared edge cases", () => {
    expect(normalizeHabitReminder({ enabled: true, time: "00:00", days: [0] })).toEqual({
      enabled: true,
      time: "00:00",
      days: [0],
    });
    expect(normalizeHabitReminder({ enabled: true, time: "23:59", days: [] })).toEqual({
      enabled: true,
      time: "23:59",
      days: [],
    });
    expect(normalizeHabitReminder({ enabled: true, time: "24:00", days: [0] })).toBeNull();
  });
});

describe("localClock", () => {
  // 2026-07-24T13:05:00Z — a Friday. Chicago is UTC-5 in July, so 08:05 local.
  const nowMs = Date.parse("2026-07-24T13:05:00Z");

  it("resolves the member-local date, weekday and minute-of-day", () => {
    expect(localClock(nowMs, "America/Chicago")).toEqual({
      date: "2026-07-24",
      dayOfWeek: 5,
      minutesOfDay: 8 * 60 + 5,
    });
  });

  it("maps ISO Sunday (7) onto 0, matching HabitReminderConfig.days", () => {
    // 2026-07-26 is a Sunday.
    expect(localClock(Date.parse("2026-07-26T13:00:00Z"), "America/Chicago").dayOfWeek).toBe(0);
  });

  it("rolls the local date back for a member whose day hasn't started yet", () => {
    // 01:30 UTC on the 25th is still 20:30 on the 24th in Chicago.
    expect(localClock(Date.parse("2026-07-25T01:30:00Z"), "America/Chicago")).toEqual({
      date: "2026-07-24",
      dayOfWeek: 5,
      minutesOfDay: 20 * 60 + 30,
    });
  });

  it("falls back to UTC for an unusable timezone instead of dropping the member", () => {
    expect(localClock(nowMs, "Not/AZone")).toEqual({
      date: "2026-07-24",
      dayOfWeek: 5,
      minutesOfDay: 13 * 60 + 5,
    });
  });
});

describe("isReminderDue", () => {
  it("fires at the configured minute", () => {
    expect(isReminderDue(config({ time: "08:00" }), clock({ minutesOfDay: 8 * 60 }))).toBe(true);
  });

  it("fires on an arbitrary non-hour minute (the 15-minute job's whole point)", () => {
    expect(isReminderDue(config({ time: "08:07" }), clock({ minutesOfDay: 8 * 60 + 15 }))).toBe(
      true
    );
  });

  it("does not fire before the configured minute", () => {
    expect(isReminderDue(config({ time: "08:15" }), clock({ minutesOfDay: 8 * 60 + 14 }))).toBe(
      false
    );
  });

  it("still fires inside the late catch-up window", () => {
    expect(
      isReminderDue(
        config({ time: "08:00" }),
        clock({ minutesOfDay: 8 * 60 + HABIT_REMINDER_LATE_CUTOFF_MINUTES })
      )
    ).toBe(true);
  });

  it("drops a reminder that is later than the catch-up window", () => {
    expect(
      isReminderDue(
        config({ time: "08:00" }),
        clock({ minutesOfDay: 8 * 60 + HABIT_REMINDER_LATE_CUTOFF_MINUTES + 1 })
      )
    ).toBe(false);
  });

  // The window is measured within the local day, so a late-night reminder can
  // never resurface on the following morning as a wrong-day alarm.
  it("never spills across local midnight", () => {
    expect(isReminderDue(config({ time: "23:50" }), clock({ minutesOfDay: 5 }))).toBe(false);
  });

  it("respects the day-of-week selection", () => {
    const weekdaysOnly = config({ days: [1, 2, 3, 4, 5] });
    expect(isReminderDue(weekdaysOnly, clock({ dayOfWeek: 5 }))).toBe(true);
    expect(isReminderDue(weekdaysOnly, clock({ dayOfWeek: 6 }))).toBe(false);
  });

  it("never fires when disabled or when no day is selected", () => {
    expect(isReminderDue(config({ enabled: false }), clock())).toBe(false);
    expect(isReminderDue(config({ days: [] }), clock())).toBe(false);
  });
});

describe("isCompletedInPeriod", () => {
  it("is true for a daily habit completed today, false otherwise", () => {
    const habit = { period: "daily", completedDates: ["2026-07-23", "2026-07-24"] };
    expect(isCompletedInPeriod(habit, "2026-07-24")).toBe(true);
    expect(isCompletedInPeriod(habit, "2026-07-25")).toBe(false);
  });

  it("is true for a weekly habit completed anywhere in the same ISO week", () => {
    // 2026-07-20 is a Monday; 2026-07-24 is the Friday of the same ISO week.
    const habit = { period: "weekly", completedDates: ["2026-07-20"] };
    expect(isCompletedInPeriod(habit, "2026-07-24")).toBe(true);
    // The following Monday starts a fresh week.
    expect(isCompletedInPeriod(habit, "2026-07-27")).toBe(false);
  });

  it("treats a missing or malformed completedDates array as no completions", () => {
    expect(isCompletedInPeriod({ period: "daily" }, "2026-07-24")).toBe(false);
    expect(isCompletedInPeriod({ period: "daily", completedDates: "nope" }, "2026-07-24")).toBe(
      false
    );
  });

  it("ignores unparseable stored dates instead of throwing", () => {
    const habit = { period: "weekly", completedDates: ["not-a-date", "2026-07-22"] };
    expect(isCompletedInPeriod(habit, "2026-07-24")).toBe(true);
  });
});

describe("isRemindableHabit", () => {
  const today = "2026-07-24";
  const base = { title: "Morning run", period: "daily", completedDates: [] as string[] };

  it("reminds about an active, unfinished habit", () => {
    expect(isRemindableHabit(base, today, "u1")).toBe(true);
  });

  it("skips an archived habit", () => {
    expect(isRemindableHabit({ ...base, archivedAt: "2026-07-01T00:00:00Z" }, today, "u1")).toBe(
      false
    );
  });

  it("skips a habit inside a planned pause, and resumes the day after it ends", () => {
    expect(isRemindableHabit({ ...base, pausedUntil: "2026-07-24" }, today, "u1")).toBe(false);
    expect(isRemindableHabit({ ...base, pausedUntil: "2026-07-23" }, today, "u1")).toBe(true);
  });

  it("skips a habit already completed for its period", () => {
    expect(isRemindableHabit({ ...base, completedDates: [today] }, today, "u1")).toBe(false);
  });

  it("skips someone else's personal habit but keeps shared ones", () => {
    expect(isRemindableHabit({ ...base, ownerId: "u2" }, today, "u1")).toBe(false);
    expect(isRemindableHabit({ ...base, ownerId: "u1" }, today, "u1")).toBe(true);
    expect(isRemindableHabit(base, today, "u1")).toBe(true);
  });
});

describe("buildHabitReminderMessage", () => {
  it("returns null when there is nothing to send", () => {
    expect(buildHabitReminderMessage([])).toBeNull();
    expect(buildHabitReminderMessage(["", "   "])).toBeNull();
  });

  it("names the single habit", () => {
    expect(buildHabitReminderMessage(["Morning run"])).toEqual({
      title: "Habit Reminder",
      body: "Morning run — time to log it.",
    });
  });

  it("coalesces several habits into one push", () => {
    expect(buildHabitReminderMessage(["Morning run", "Vitamins"])).toEqual({
      title: "Habit Reminder",
      body: "2 habits to log: Morning run, Vitamins",
    });
  });

  it("names exactly the cap with no dangling summary", () => {
    expect(buildHabitReminderMessage(["A", "B", "C"])).toEqual({
      title: "Habit Reminder",
      body: "3 habits to log: A, B, C",
    });
  });

  // The only place the singular "1 more" appears.
  it("singularizes a one-habit tail", () => {
    expect(buildHabitReminderMessage(["A", "B", "C", "D"])).toEqual({
      title: "Habit Reminder",
      body: "4 habits to log: A, B, C and 1 more",
    });
  });

  it("summarizes the tail past the named cap", () => {
    expect(
      buildHabitReminderMessage(["A", "B", "C", "D", "E"])
    ).toEqual({
      title: "Habit Reminder",
      body: "5 habits to log: A, B, C and 2 more",
    });
  });
});
