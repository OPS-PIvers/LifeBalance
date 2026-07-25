import { describe, it, expect } from "vitest";
import { computeAnyNotificationsEnabled, type NotificationPreferences } from "./notifications";

const basePrefs: NotificationPreferences = {
  habitReminders: { enabled: false, time: "08:00" },
  actionQueueReminders: { enabled: false, time: "08:00" },
  budgetAlerts: { enabled: false },
  streakWarnings: { enabled: false, time: "20:00" },
  billReminders: { enabled: false, daysBeforeDue: 3, time: "09:00" },
  weeklyRecap: { enabled: false },
  // F-TODO-14: todoReminders is also fail-open, so "everything off" baselines
  // must disable it explicitly too.
  todoReminders: { enabled: false },
  // bankEmailSync is also fail-open, so "everything off" baselines must
  // disable it explicitly too.
  bankEmailSync: { enabled: false },
};

describe("computeAnyNotificationsEnabled", () => {
  it("is true when todoReminders is absent (fail-open) even with everything else off", () => {
    const { todoReminders: _omitted, ...withoutTodoReminders } = basePrefs;
    expect(computeAnyNotificationsEnabled(withoutTodoReminders, ["token1"])).toBe(true);
  });

  it("is false with no tokens, regardless of prefs", () => {
    expect(
      computeAnyNotificationsEnabled(
        { ...basePrefs, habitReminders: { enabled: true, time: "08:00" } },
        []
      )
    ).toBe(false);
    expect(
      computeAnyNotificationsEnabled(
        { ...basePrefs, habitReminders: { enabled: true, time: "08:00" } },
        undefined
      )
    ).toBe(false);
  });

  it("is true with tokens but no prefs at all (weeklyRecap defaults to enabled)", () => {
    expect(computeAnyNotificationsEnabled(undefined, ["token1"])).toBe(true);
  });

  it("is false when tokens exist but every category is disabled (weeklyRecap explicitly off)", () => {
    expect(computeAnyNotificationsEnabled(basePrefs, ["token1"])).toBe(false);
  });

  it("is true when habitReminders is enabled and a token exists", () => {
    const prefs = { ...basePrefs, habitReminders: { enabled: true, time: "08:00" } };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("is true when actionQueueReminders is enabled and a token exists", () => {
    const prefs = { ...basePrefs, actionQueueReminders: { enabled: true, time: "08:00" } };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("is true when streakWarnings is enabled and a token exists", () => {
    const prefs = { ...basePrefs, streakWarnings: { enabled: true, time: "20:00" } };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("is true when billReminders is enabled and a token exists", () => {
    const prefs = {
      ...basePrefs,
      billReminders: { enabled: true, daysBeforeDue: 3, time: "09:00" },
    };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("budgetAlerts alone does not count (not one of the four scan categories)", () => {
    const prefs = { ...basePrefs, budgetAlerts: { enabled: true } };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(false);
  });

  // F-HABITS-03 — must stay in parity with utils/notificationFlags.test.ts.
  it("is true when a per-habit reminder is the only enabled category", () => {
    const prefs = {
      ...basePrefs,
      perHabitReminders: { h1: { enabled: true, time: "08:00", days: [1] } },
    };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("stays false for a per-habit reminder that could never fire", () => {
    const disabled = {
      ...basePrefs,
      perHabitReminders: { h1: { enabled: false, time: "08:00", days: [1] } },
    };
    const noDays = {
      ...basePrefs,
      perHabitReminders: { h1: { enabled: true, time: "08:00", days: [] } },
    };
    expect(computeAnyNotificationsEnabled(disabled, ["token1"])).toBe(false);
    expect(computeAnyNotificationsEnabled(noDays, ["token1"])).toBe(false);
  });

  // Parity guard: the client reaches this via normalizeHabitReminder, which
  // rejects a malformed time, so a corrupt entry must not count here either.
  it("stays false for a reminder whose stored time is unusable", () => {
    const prefs = {
      ...basePrefs,
      perHabitReminders: { h1: { enabled: true, time: "99:99", days: [1] } },
    };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(false);
  });

  it("treats weeklyRecap as enabled by default when absent, even if every other category is off", () => {
    const { weeklyRecap: _omit, ...rest } = basePrefs;
    expect(computeAnyNotificationsEnabled(rest, ["token1"])).toBe(true);
  });

  it("treats weeklyRecap as enabled when present without an explicit enabled field set to false", () => {
    const prefs = { ...basePrefs, weeklyRecap: { enabled: true } };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("is false when weeklyRecap is explicitly disabled and every other category is off", () => {
    expect(
      computeAnyNotificationsEnabled({ ...basePrefs, weeklyRecap: { enabled: false } }, ["token1"])
    ).toBe(false);
  });

  it("is true when digestMode is enabled even if every per-type category and weeklyRecap are off", () => {
    const prefs = {
      ...basePrefs,
      weeklyRecap: { enabled: false },
      digestMode: { enabled: true, time: "07:00" },
    };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("digestMode alone with enabled: false does not count", () => {
    const prefs = {
      ...basePrefs,
      weeklyRecap: { enabled: false },
      digestMode: { enabled: false, time: "07:00" },
    };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(false);
  });

  it("is true when bankEmailSync is the only enabled category (all others explicitly false) and tokens exist", () => {
    const prefs = { ...basePrefs, bankEmailSync: { enabled: true } };
    expect(computeAnyNotificationsEnabled(prefs, ["token1"])).toBe(true);
  });

  it("treats bankEmailSync as enabled by default when absent, even if every other category is off", () => {
    const { bankEmailSync: _omit, ...rest } = basePrefs;
    expect(computeAnyNotificationsEnabled(rest, ["token1"])).toBe(true);
  });

  it("is false when all categories including bankEmailSync are explicitly false", () => {
    expect(computeAnyNotificationsEnabled(basePrefs, ["token1"])).toBe(false);
  });
});
