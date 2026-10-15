import { describe, expect, it } from "vitest";
import { parseISO } from "date-fns";

// The semi-monthly / weekend-shift schedule math exists twice: the client's
// utils/calendarRecurrence.ts and this package's shared/recurrenceSchedule.ts
// (functions SOURCE can't import `@/`; functions TESTS run under the root
// vitest config, so the alias resolves here). If they drift, the app shows a
// paycheck or bill on one date while reminders, the wall and the bank-sync
// matcher look for it on another. A failure here is a real defect.
import {
  scheduledOccurrences as clientOccurrences,
  semiMonthlyDaysFor as clientDays,
} from "@/utils/calendarRecurrence";
import { scheduledOccurrences, semiMonthlyDaysFor } from "./recurrenceSchedule";
import { findBillsDueOnDate } from "./bills";
import { expandCalendarItems } from "../quickAdd/billMatch";
import type { RecurrenceSchedule } from "./recurrenceSchedule";

interface Fixture {
  name: string;
  anchor: string;
  frequency: string;
  schedule: RecurrenceSchedule;
  start: string;
  end: string;
}

const FIXTURES: Fixture[] = [
  { name: "1st & 16th", anchor: "2026-01-01", frequency: "semi-monthly", schedule: { semiMonthlyDays: [1, 16] }, start: "2026-01-01", end: "2026-12-31" },
  { name: "1st & 16th, Friday before", anchor: "2026-01-01", frequency: "semi-monthly", schedule: { semiMonthlyDays: [1, 16], weekendShift: "before" }, start: "2026-01-01", end: "2027-06-30" },
  { name: "15th & last, Monday after", anchor: "2026-01-15", frequency: "semi-monthly", schedule: { semiMonthlyDays: [15, 31], weekendShift: "after" }, start: "2026-01-01", end: "2026-12-31" },
  { name: "derived pair from the 20th", anchor: "2026-03-20", frequency: "semi-monthly", schedule: {}, start: "2026-01-01", end: "2026-08-31" },
  { name: "monthly, Friday before", anchor: "2026-01-31", frequency: "monthly", schedule: { weekendShift: "before" }, start: "2026-01-01", end: "2026-12-31" },
  { name: "bi-weekly, shift is a no-op", anchor: "2026-01-02", frequency: "bi-weekly", schedule: { weekendShift: "before" }, start: "2026-02-01", end: "2026-05-31" },
  { name: "window opens mid-series", anchor: "2024-06-16", frequency: "semi-monthly", schedule: { semiMonthlyDays: [1, 16], weekendShift: "before" }, start: "2026-10-28", end: "2026-11-03" },
];

describe("recurrence schedule — client/server parity", () => {
  for (const f of FIXTURES) {
    it(f.name, () => {
      const server = scheduledOccurrences(f.anchor, f.frequency, f.schedule, parseISO(f.start), parseISO(f.end));
      const client = clientOccurrences(f.anchor, f.frequency, f.schedule, parseISO(f.start), parseISO(f.end));
      expect(server.length).toBeGreaterThan(0);
      expect(server).toEqual(client);
    });
  }

  it("derives the same day pair", () => {
    for (const anchor of ["2026-01-01", "2026-01-15", "2026-01-16", "2026-01-31"]) {
      expect(semiMonthlyDaysFor(anchor)).toEqual(clientDays({ date: anchor }));
    }
  });
});

describe("server consumers use the schedule", () => {
  const paycheck = {
    id: "pay",
    title: "Paycheck",
    amount: 100,
    date: "2026-01-01",
    type: "expense" as const,
    isPaid: false,
    isRecurring: true,
    frequency: "semi-monthly" as const,
    semiMonthlyDays: [1, 16],
    weekendShift: "before" as const,
  };

  it("finds a shifted occurrence due on its paid date only", () => {
    expect(findBillsDueOnDate([paycheck], "2026-10-30")).toHaveLength(1);
    expect(findBillsDueOnDate([paycheck], "2026-11-01")).toHaveLength(0);
    expect(findBillsDueOnDate([paycheck], "2026-11-16")).toHaveLength(1);
  });

  it("bank-sync expansion matches the client's dates", () => {
    const dates = expandCalendarItems([paycheck], parseISO("2026-10-01"), parseISO("2026-11-30")).map((i) => i.date);
    expect(dates).toEqual(["2026-10-01", "2026-10-16", "2026-10-30", "2026-11-16"]);
  });
});
