import { describe, expect, it } from "vitest";
import { easterSunday, usHolidaysIcs, usHolidaysInWindow } from "./usHolidays";

const on = (start: string, end: string) => usHolidaysInWindow({ start, end }).map((h) => `${h.date} ${h.title}`);

describe("usHolidays", () => {
  it("dates Easter", () => {
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
    expect(easterSunday(2038)).toEqual({ month: 4, day: 25 });
  });

  it("dates the floating holidays", () => {
    expect(on("2026-01-01", "2026-12-31")).toEqual([
      "2026-01-01 New Year's Day",
      "2026-01-19 Martin Luther King Jr. Day",
      "2026-02-14 Valentine's Day",
      "2026-02-16 Presidents' Day",
      "2026-03-17 St. Patrick's Day",
      "2026-04-05 Easter Sunday",
      "2026-05-10 Mother's Day",
      "2026-05-25 Memorial Day",
      "2026-06-19 Juneteenth",
      "2026-06-21 Father's Day",
      "2026-07-03 Independence Day (observed)",
      "2026-07-04 Independence Day",
      "2026-09-07 Labor Day",
      "2026-10-12 Indigenous Peoples' Day",
      "2026-10-31 Halloween",
      "2026-11-11 Veterans Day",
      "2026-11-26 Thanksgiving",
      "2026-12-24 Christmas Eve",
      "2026-12-25 Christmas Day",
      "2026-12-31 New Year's Eve",
    ]);
  });

  it("observes weekend federal holidays on the nearest weekday, across a year end", () => {
    // Jan 1 2028 is a Saturday: observed Friday Dec 31 2027.
    expect(on("2027-12-30", "2028-01-02")).toEqual([
      "2027-12-31 New Year's Day (observed)",
      "2027-12-31 New Year's Eve",
      "2028-01-01 New Year's Day",
    ]);
    // Christmas 2027 is a Saturday, Juneteenth 2027 a Saturday, July 4 2027 a Sunday.
    expect(on("2027-12-24", "2027-12-25")).toContain("2027-12-24 Christmas Day (observed)");
    expect(on("2027-07-05", "2027-07-05")).toEqual(["2027-07-05 Independence Day (observed)"]);
  });

  it("writes an ICS body with stable ids", () => {
    const text = usHolidaysIcs({ start: "2026-11-01", end: "2026-11-30" });
    expect(text).toContain("UID:us-holiday-thanksgiving-2026");
    expect(text).toContain("DTSTART;VALUE=DATE:20261126");
    expect(text.startsWith("BEGIN:VCALENDAR")).toBe(true);
  });
});
