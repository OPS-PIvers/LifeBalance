import { describe, expect, it } from "vitest";
import { buildIcs } from "./calendarFeed";

describe("buildIcs — semi-monthly and weekend-shifted series", () => {
  const now = new Date("2026-10-15T12:00:00Z");

  it("lists each occurrence on its shifted date and skips paid ones", () => {
    const ics = buildIcs(
      [
        {
          id: "pay",
          title: "Daycare",
          amount: 400,
          date: "2026-01-01",
          type: "expense",
          isPaid: false,
          isRecurring: true,
          frequency: "semi-monthly",
          semiMonthlyDays: [1, 16],
          weekendShift: "before",
        },
        {
          id: "paid",
          title: "Daycare",
          amount: 400,
          date: "2026-10-16",
          type: "expense",
          isPaid: true,
          parentRecurringId: "pay",
        },
      ],
      "Ivers",
      now
    );
    expect(ics).not.toContain("RRULE");
    expect(ics).toContain("UID:pay-2026-10-01@lifebalance.app");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261030"); // Sun Nov 1 → Fri Oct 30
    expect(ics).not.toContain("DTSTART;VALUE=DATE:20261101");
    expect(ics).not.toContain("UID:pay-2026-10-16@lifebalance.app"); // paid
    expect(ics).toContain("UID:pay-2027-10-01@lifebalance.app"); // 12 months ahead
    expect(ics).not.toContain("UID:pay-2026-08-14@lifebalance.app"); // older than 1 month
  });
});
