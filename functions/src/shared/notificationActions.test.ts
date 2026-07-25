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

  // Temporary capability probe: two buttons on the test notification so a real
  // device can answer whether iOS renders web-push actions at all. The ids are
  // intentionally NOT in NOTIFICATION_ACTIONS, which is what makes a tap inert
  // (the client strips an unrecognized id and dispatches nothing).
  it("attaches inert probe buttons to the test notification", () => {
    const actions = getNotificationActions("test_notification");
    expect(actions).toHaveLength(2);
    const known = new Set<string>(Object.values(NOTIFICATION_ACTIONS));
    for (const action of actions) {
      expect(known.has(action.action)).toBe(false);
      expect(action.title.length).toBeGreaterThan(0);
    }
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
