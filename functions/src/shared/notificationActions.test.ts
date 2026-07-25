import { describe, it, expect } from "vitest";
import {
  getNotificationActions,
  buildActionsDataField,
  buildHabitLogActionsDataField,
  isBillReminderSnoozed,
  NOTIFICATION_ACTIONS,
} from "./notificationActions";

describe("getNotificationActions", () => {
  it("returns pay + snooze for a bill reminder", () => {
    expect(getNotificationActions("bill_reminder").map((a) => a.action)).toEqual([
      NOTIFICATION_ACTIONS.payBill,
      NOTIFICATION_ACTIONS.snoozeBill,
    ]);
  });

  it("returns [] for an unknown type", () => {
    expect(getNotificationActions("habit_reminder")).toEqual([]);
  });

  // The capability probe that briefly rode along here has served its purpose:
  // an installed iOS PWA renders no action buttons at all (2026-07-24), so the
  // test notification is back to carrying none.
  it("returns [] for the test notification", () => {
    expect(getNotificationActions("test_notification")).toEqual([]);
  });
});

describe("buildHabitLogActionsDataField", () => {
  it("serializes a single log-habit button", () => {
    expect(JSON.parse(buildHabitLogActionsDataField())).toEqual([
      { action: NOTIFICATION_ACTIONS.logHabit, title: "Log it" },
    ]);
  });

  // The client only dispatches ids it recognizes, so drift here would silently
  // turn the button into a no-op.
  it("uses an id the client knows how to dispatch", () => {
    expect(NOTIFICATION_ACTIONS.logHabit).toBe("log-habit");
  });
});

describe("buildActionsDataField", () => {
  it("serializes the actions array to JSON for bill reminders", () => {
    const field = buildActionsDataField("bill_reminder");
    expect(field).toBeDefined();
    const parsed = JSON.parse(field as string);
    expect(parsed).toEqual([
      { action: NOTIFICATION_ACTIONS.payBill, title: "Pay bill" },
      { action: NOTIFICATION_ACTIONS.snoozeBill, title: "Snooze 1 day" },
    ]);
  });

  it("returns undefined for a type with no actions", () => {
    expect(buildActionsDataField("streak_warning")).toBeUndefined();
  });
});

describe("isBillReminderSnoozed", () => {
  it("is false when there is no snooze", () => {
    expect(isBillReminderSnoozed(undefined, "2026-07-14")).toBe(false);
  });

  it("is true on the snooze day itself (inclusive)", () => {
    expect(isBillReminderSnoozed("2026-07-14", "2026-07-14")).toBe(true);
  });

  it("is true before the snooze expires", () => {
    expect(isBillReminderSnoozed("2026-07-15", "2026-07-14")).toBe(true);
  });

  it("is false once the snooze day has passed", () => {
    expect(isBillReminderSnoozed("2026-07-13", "2026-07-14")).toBe(false);
  });
});
