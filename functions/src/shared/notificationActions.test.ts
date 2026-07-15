import { describe, it, expect } from "vitest";
import {
  getNotificationActions,
  buildActionsDataField,
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
